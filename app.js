// Goblox website: talks to the same Supabase functions as the game (gb_*), with the same login.
// Pages are picked by the address after # (#/games, #/game/11, #/user/Pester ...).
"use strict";

const SUPABASE_URL = "https://danpdfczedispfzqdjqz.supabase.co";
const SUPABASE_KEY = "sb_publishable_PSFCYMxKCXPuHDTPXLkuwg_sZc1w_gy";
const DOWNLOAD_URL = "download/Goblox.zip";

// Must match src/avatar.cpp.
const BODY_COLORS = [
  [245, 205, 48], [13, 105, 172], [164, 189, 71], [234, 184, 146], [204, 142, 105], [124, 92, 70],
  [196, 40, 28], [75, 151, 75], [27, 42, 53], [242, 243, 243], [163, 162, 165], [218, 133, 65],
  [107, 50, 124], [255, 102, 204], [18, 238, 212], [40, 127, 71],
];
const HATS = [
  { id: "cone", name: "Traffic Cone", price: 30 },
  { id: "tophat", name: "Top Hat", price: 50 },
  { id: "headphones", name: "Headphones", price: 75 },
  { id: "crown", name: "Gold Crown", price: 150 },
  { id: "halo", name: "Halo", price: 300 },
];
const DEFAULT_AVATAR = { colors: [1, 0, 0, 0, 2, 2], hat: "none", shirt: 0, tshirt: 0, pants: 0 };

// ------------------------------------------------------------------ server

let token = load("goblox_token");
let me = null;  // gb_me profile while logged in

function load(key) {
  try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
}
function store(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch (e) { /* private mode */ }
}

// Server errors come in capitals ("NOT ENOUGH GBUX"): show them as a sentence.
function niceError(msg) {
  msg = String(msg || "Something went wrong");
  if (msg === msg.toUpperCase()) msg = msg.charAt(0) + msg.slice(1).toLowerCase();
  return msg.replace(/\bgbux\b/gi, "Gbux").replace(/\bgoblox\b/gi, "Goblox");
}

async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw new Error("Can't reach Goblox. Check your internet connection.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    let msg = data && data.message ? data.message : `Server error ${res.status}`;
    if (/schema cache/i.test(msg)) msg = "This part of the website isn't switched on yet (the server needs the latest schema.sql).";
    if (/not logged in/i.test(msg)) logoutLocal();
    throw new Error(niceError(msg));
  }
  return data;
}
const authed = (fn, args = {}) => rpc(fn, { p_token: token, ...args });

// Uploaded images (game icons, shirts...) are base64 PNGs in gb_assets.
const assetCache = new Map();
function assetUrl(id) {
  id = Number(id) || 0;
  if (!id) return Promise.resolve("");
  if (!assetCache.has(id)) {
    assetCache.set(id, rpc("gb_get_asset", { p_id: id })
      .then((a) => (a && a.data ? `data:image/png;base64,${a.data}` : ""))
      .catch(() => ""));
  }
  return assetCache.get(id);
}
// Fills every <img data-asset="id"> on the page once its image arrives.
function fillAssets(root = document) {
  root.querySelectorAll("img[data-asset]").forEach((img) => {
    const id = img.dataset.asset;
    img.removeAttribute("data-asset");
    assetUrl(id).then((url) => {
      if (url) {
        img.src = url;
        img.hidden = false;
        if (img.previousElementSibling && img.previousElementSibling.classList.contains("tile")) img.previousElementSibling.remove();
      }
    });
  });
}

let gamesCache = null;
async function allGames(force) {
  if (!gamesCache || force) gamesCache = await rpc("gb_list_games");
  return gamesCache || [];
}

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const page = () => $("#page");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(n) { return Number(n || 0).toLocaleString(); }
function ago(when) {
  const s = (Date.now() - new Date(when).getTime()) / 1000;
  if (!isFinite(s)) return "";
  if (s < 60) return "just now";
  const units = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [secs, name] of units) {
    if (s >= secs) {
      const v = Math.floor(s / secs);
      return `${v} ${name}${v > 1 ? "s" : ""} ago`;
    }
  }
  return "";
}
function dateText(when) {
  const d = new Date(when);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function gbux(n) { return `<span class="price"><span class="coin"></span>${num(n)}</span>`; }
function verifiedMark(v) { return v ? `<span class="verified" title="Verified">&#10003;</span>` : ""; }

// Coloured square with the game's initials (like the game's own tiles), for games without an icon.
function initialsTile(id, name, cls = "tile") {
  const hue = (Number(id) * 67) % 360;
  const words = String(name || "?").trim().split(/\s+/);
  const letters = (words[0][0] + (words[1] ? words[1][0] : "")).toUpperCase();
  return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${hue} 60% 50%),hsl(${(hue + 40) % 360} 60% 35%))">${esc(letters)}</div>`;
}

function gameCard(g) {
  const icon = Number(g.icon_id) || 0;
  return `<a class="card" href="#/game/${g.id}">
    <div class="media">${initialsTile(g.id, g.name)}${icon ? `<img class="thumb" data-asset="${icon}" alt="" hidden>` : ""}
      ${g.featured ? `<span class="featured-tag">Featured</span>` : ""}</div>
    <div class="info"><div class="name">${esc(g.name)}</div>
      <div class="sub">by ${esc(g.creator)} &middot; ${num(g.plays)} plays</div></div></a>`;
}

// ------------------------------------------------------------------ avatar picture (SVG)

function rgb(i) {
  const c = BODY_COLORS[i] || BODY_COLORS[0];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function shade(i, k) {
  const c = BODY_COLORS[i] || BODY_COLORS[0];
  return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
}
function hatSvg(hat) {
  switch (hat) {
    case "cone": return `<polygon points="100,6 82,52 118,52" fill="#f07a1a" stroke="#a84f08" stroke-width="2"/>
      <rect x="88" y="28" width="24" height="7" fill="#fff"/><rect x="74" y="50" width="52" height="7" rx="2" fill="#f07a1a" stroke="#a84f08" stroke-width="2"/>`;
    case "tophat": return `<rect x="80" y="10" width="40" height="40" rx="3" fill="#22232a"/><rect x="80" y="38" width="40" height="7" fill="#c0262c"/>
      <rect x="68" y="47" width="64" height="8" rx="3" fill="#22232a"/>`;
    case "headphones": return `<path d="M68 62 Q68 22 100 22 Q132 22 132 62" fill="none" stroke="#2a2b33" stroke-width="7"/>
      <rect x="60" y="56" width="14" height="24" rx="5" fill="#d8232b"/><rect x="126" y="56" width="14" height="24" rx="5" fill="#d8232b"/>`;
    case "crown": return `<polygon points="74,52 74,22 87,36 100,16 113,36 126,22 126,52" fill="#f2c230" stroke="#a7800c" stroke-width="2"/>
      <circle cx="100" cy="40" r="4" fill="#d8232b"/>`;
    case "halo": return `<ellipse cx="100" cy="20" rx="26" ry="7" fill="none" stroke="#ffe066" stroke-width="5"/>`;
    default: return "";
  }
}
// Front view of a blocky character. `headOnly` crops to the head (friend lists).
function avatarSvg(av, headOnly) {
  av = av && Array.isArray(av.colors) && av.colors.length === 6 ? av : DEFAULT_AVATAR;
  const [torso, head, larm, rarm, lleg, rleg] = av.colors;
  const tshirt = Number(av.tshirt) || 0;
  const body = `
    <rect x="40" y="96" width="30" height="62" rx="4" fill="${rgb(larm)}" stroke="${shade(larm, 0.7)}" stroke-width="2"/>
    <rect x="130" y="96" width="30" height="62" rx="4" fill="${rgb(rarm)}" stroke="${shade(rarm, 0.7)}" stroke-width="2"/>
    <rect x="70" y="158" width="29" height="62" rx="3" fill="${rgb(lleg)}" stroke="${shade(lleg, 0.7)}" stroke-width="2"/>
    <rect x="101" y="158" width="29" height="62" rx="3" fill="${rgb(rleg)}" stroke="${shade(rleg, 0.7)}" stroke-width="2"/>
    <rect x="70" y="96" width="60" height="64" rx="3" fill="${rgb(torso)}" stroke="${shade(torso, 0.7)}" stroke-width="2"/>
    ${tshirt ? `<image data-asset-svg="${tshirt}" x="78" y="104" width="44" height="44" preserveAspectRatio="xMidYMid meet"/>` : ""}`;
  const headPart = `
    <rect x="86" y="84" width="28" height="14" fill="${shade(head, 0.85)}"/>
    <rect x="74" y="44" width="52" height="46" rx="12" fill="${rgb(head)}" stroke="${shade(head, 0.7)}" stroke-width="2"/>
    <image href="img/face.png" x="78" y="46" width="44" height="42"/>
    ${hatSvg(av.hat)}`;
  const view = headOnly ? "62 2 76 98" : "30 0 140 226";
  return `<svg viewBox="${view}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar">${headOnly ? "" : body}${headPart}</svg>`;
}
function fillAvatarImages(root = document) {
  root.querySelectorAll("image[data-asset-svg]").forEach((img) => {
    const id = img.getAttribute("data-asset-svg");
    img.removeAttribute("data-asset-svg");
    assetUrl(id).then((url) => url && img.setAttribute("href", url));
  });
}

// ------------------------------------------------------------------ header

function renderHeader() {
  const acc = $("#account");
  document.querySelectorAll(".auth-only").forEach((el) => (el.hidden = !me));
  if (me) {
    acc.innerHTML = `<span class="gbux-chip" title="Gbux"><span class="coin"></span>${num(me.gbux)}</span>
      <a href="#/user/${encodeURIComponent(me.username)}">${esc(me.username)}</a>
      <a href="#" id="logout" class="muted-link">Log out</a>`;
    $("#logout").onclick = async (e) => {
      e.preventDefault();
      authed("gb_logout").catch(() => {});
      logoutLocal();
      location.hash = "#/";
    };
  } else {
    acc.innerHTML = `<a href="#/login">Log in</a><a class="btn small red" href="#/signup">Sign up</a>`;
  }
  const ann = $("#announcement");
  ann.hidden = !(me && me.announcement);
  if (me && me.announcement) ann.textContent = me.announcement;
  const tab = (location.hash.split("/")[1] || "").toLowerCase();
  document.querySelectorAll(".links a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab || (tab === "game" && a.dataset.tab === "games")));
}

function logoutLocal() {
  token = "";
  me = null;
  store("goblox_token", "");
  renderHeader();
}
function setMe(profile) {
  me = profile;
  renderHeader();
}
async function refreshMe() {
  if (!token) return;
  try {
    setMe(await authed("gb_me"));
  } catch (e) {
    /* logged out by rpc() if the session expired */
  }
}
async function refreshFriendCount() {
  if (!me) return;
  try {
    const list = await authed("gb_friends");
    const n = list.filter((f) => f.status === "incoming").length;
    const pill = $("#friend-count");
    pill.hidden = !n;
    pill.textContent = n;
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ playing (opens the Goblox app)

// goblox://play/<id> opens the installed app (it registers that link the first time it runs).
function playGame(id, name) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="box modal"><div class="strip">Starting Goblox</div><div class="body center">
      <div class="spinner"></div>
      <p>Opening <b>${esc(name || "the game")}</b> in Goblox...</p>
      <p class="muted">Nothing happened? You need the Goblox app (and to have opened it once).</p>
      <p><a class="btn red" href="#/download" id="dl">Download Goblox</a> <button class="btn" id="close">Close</button></p>
    </div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  $("#close", back).onclick = close;
  $("#dl", back).onclick = close;
  back.onclick = (e) => e.target === back && close();
  location.href = `goblox://play/${id}`;
}

// ------------------------------------------------------------------ pages

const routes = {
  "": homePage,
  games: gamesPage,
  game: gamePage,
  catalog: catalogPage,
  user: userPage,
  friends: friendsPage,
  download: downloadPage,
  login: () => loginPage(false),
  signup: () => loginPage(true),
};

let routeId = 0;
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const fn = routes[parts[0].toLowerCase()] || notFound;
  const id = ++routeId;
  renderHeader();
  page().innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  window.scrollTo(0, 0);
  try {
    const html = await fn(parts.slice(1));
    if (id !== routeId) return;  // the user already went somewhere else
    if (typeof html === "string") page().innerHTML = html;
    fillAssets(page());
    fillAvatarImages(page());
    if (fn.after) fn.after(parts.slice(1));
  } catch (e) {
    if (id === routeId) page().innerHTML = `<div class="box"><div class="body empty">${esc(e.message)}</div></div>`;
  }
}

function notFound() {
  return `<div class="box"><div class="body empty"><h2>Page not found</h2><p><a href="#/">Go home</a></p></div></div>`;
}

// ---- home

async function homePage() {
  const [games, stats] = await Promise.all([allGames(true), rpc("gb_site_stats").catch(() => null)]);
  const top = games.slice(0, 12);
  const heroArt = `<svg viewBox="0 0 300 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="20" y="170" width="260" height="60" rx="6" fill="#2e8b3a"/><rect x="20" y="170" width="260" height="10" fill="#3fae4c"/>
      <rect x="40" y="120" width="60" height="50" fill="#d8232b"/><rect x="200" y="130" width="50" height="40" fill="#f2c230"/>
      <rect x="215" y="95" width="40" height="35" fill="#2d6fd2"/>
      <g transform="translate(110 30) scale(0.75)">${avatarSvg(me ? me.avatar : DEFAULT_AVATAR).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g></svg>`;
  return `
    <section class="hero">
      <div>
        <h1>${me ? `Welcome back, ${esc(me.username)}!` : "Build it. Play it. Share it."}</h1>
        <p>Goblox is a place to make your own 3D games in Goblox Studio, play what others built, and hang out with friends, with voice chat, avatars and Gbux.</p>
        <div class="actions">
          <a class="btn big red" href="#/download">Download Goblox</a>
          ${me ? `<a class="btn big" href="#/games">Browse games</a>` : `<a class="btn big" href="#/signup">Create an account</a>`}
        </div>
        ${me && me.daily_ready ? `<p style="margin-top:16px"><button class="btn green" id="daily">Claim your daily 50 Gbux</button></p>` : ""}
      </div>
      <div class="hero-art">${heroArt}</div>
    </section>
    ${stats ? `<div class="stats">
      <div class="stat"><b>${num(stats.users)}</b><span>players</span></div>
      <div class="stat"><b>${num(stats.games)}</b><span>games</span></div>
      <div class="stat"><b>${num(stats.plays)}</b><span>total plays</span></div>
      <div class="stat"><b>${num(stats.online)}</b><span>online now</span></div></div>` : ""}
    <div class="stack">
      ${me ? `<div class="box" id="home-friends" hidden><div class="strip">Friends<span class="spacer"></span><a href="#/friends">See all</a></div><div class="body"><div class="people"></div></div></div>` : ""}
      <div class="box"><div class="strip">Popular games<span class="spacer"></span><a href="#/games">See all</a></div>
        <div class="body">${top.length ? `<div class="grid">${top.map(gameCard).join("")}</div>` : `<div class="empty">No games yet.</div>`}</div></div>
      <div class="box"><div class="strip">What you can do</div><div class="body features">
        <div class="feature"><h3>Play together</h3><p>Join any game with friends. Chat, voice chat, and see everyone's avatars live.</p></div>
        <div class="feature"><h3>Build in Studio</h3><p>Parts, scripts in Lua, GUIs, effects and 140+ objects. Publish with one click.</p></div>
        <div class="feature"><h3>Earn and spend Gbux</h3><p>Daily rewards, wins, game passes, hats and clothes for your avatar.</p></div>
      </div></div>
    </div>`;
}
homePage.after = async () => {
  const daily = $("#daily");
  if (daily) daily.onclick = async () => {
    daily.disabled = true;
    try {
      const r = await authed("gb_claim_daily");
      setMe(r.user);
      toast(r.granted ? "You got 50 Gbux!" : "Already claimed today - come back tomorrow");
      daily.remove();
    } catch (e) { toast(e.message); daily.disabled = false; }
  };
  const box = $("#home-friends");
  if (box) {
    try {
      const friends = (await authed("gb_friends")).filter((f) => f.status === "friend").slice(0, 8);
      if (friends.length) {
        $(".people", box).innerHTML = friends.map(personCard).join("");
        box.hidden = false;
        bindJoinButtons(box);
      }
    } catch (e) { /* ignore */ }
  }
};

function personCard(f) {
  const status = f.game_id ? `<span class="dot ingame"></span>In ${esc(f.game_name || "a game")}` : f.online ? `<span class="dot online"></span>Online` : "";
  return `<div class="person"><a href="#/user/${encodeURIComponent(f.username)}" class="head" style="display:block">${avatarSvg(f.avatar, true)}</a>
    <div class="uname"><a href="#/user/${encodeURIComponent(f.username)}">${esc(f.username)}</a>${verifiedMark(f.verified)}</div>
    <div class="muted" style="font-size:12px">${status}</div>
    ${f.game_id ? `<button class="btn small green" data-join="${f.game_id}" data-name="${esc(f.game_name || "")}">Join</button>` : ""}</div>`;
}
function bindJoinButtons(root) {
  root.querySelectorAll("[data-join]").forEach((b) => (b.onclick = () => playGame(b.dataset.join, b.dataset.name)));
}

// ---- games

async function gamesPage() {
  const games = await allGames(true);
  return `<div class="toolbar"><h1 style="margin:0">Games</h1><span class="spacer"></span>
      <input type="search" id="game-search" placeholder="Search games" aria-label="Search games">
      <select id="game-sort" class="btn" aria-label="Sort"><option value="popular">Most played</option><option value="new">Recently updated</option><option value="name">A-Z</option></select></div>
    <div id="game-grid" class="grid">${games.map(gameCard).join("")}</div>
    <div id="game-empty" class="empty" hidden>No games match.</div>`;
}
gamesPage.after = async () => {
  const games = await allGames();
  const draw = () => {
    const q = $("#game-search").value.trim().toLowerCase();
    const sort = $("#game-sort").value;
    let list = games.filter((g) => !q || g.name.toLowerCase().includes(q) || String(g.creator).toLowerCase().includes(q));
    if (sort === "new") list = [...list].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    $("#game-grid").innerHTML = list.map(gameCard).join("");
    $("#game-empty").hidden = list.length > 0;
    fillAssets($("#game-grid"));
  };
  $("#game-search").oninput = draw;
  $("#game-sort").onchange = draw;
};

// ---- one game

async function gamePage([id]) {
  const games = await allGames();
  let g = games.find((x) => String(x.id) === String(id));
  if (!g) g = (await allGames(true)).find((x) => String(x.id) === String(id));
  if (!g) return `<div class="box"><div class="body empty"><h2>Game not found</h2><p>It may have been deleted. <a href="#/games">See all games</a></p></div></div>`;
  const thumb = Number(g.thumb_id) || 0, icon = Number(g.icon_id) || 0;
  const pic = thumb || icon;
  return `<p><a href="#/games">&larr; All games</a></p>
    <div class="game-top">
      <div>${initialsTile(g.id, g.name, "game-thumb tile")}${pic ? `<img class="game-thumb" data-asset="${pic}" alt="" hidden>` : ""}</div>
      <div class="box"><div class="body">
        <h1>${esc(g.name)}</h1>
        <div class="muted">By <a href="#/user/${encodeURIComponent(g.creator)}">${esc(g.creator)}</a></div>
        <button class="btn green play-btn" id="play">&#9654; Play</button>
        <div class="muted">${num(g.plays)} plays &middot; updated ${esc(ago(g.updated_at))}</div>
        <p class="muted" style="font-size:13px">Don't have Goblox yet? <a href="#/download">Download it</a>.</p>
      </div></div>
    </div>
    <div class="row" style="margin-top:18px">
      <div class="grow stack">
        <div class="box"><div class="strip">Description</div><div class="body desc">${esc(g.description || "No description yet.")}</div></div>
        <div class="box" id="passes-box" hidden><div class="strip">Game Passes</div><div class="body" id="passes"></div></div>
      </div>
      <div class="grow"><div class="box" id="badges-box" hidden><div class="strip">Badges</div><div class="body" id="badges"></div></div></div>
    </div>`;
}
gamePage.after = async ([id]) => {
  const g = (await allGames()).find((x) => String(x.id) === String(id));
  if (!g) return;
  $("#play").onclick = () => playGame(g.id, g.name);
  let extras;
  try {
    extras = me ? await authed("gb_game_extras", { p_game_id: Number(id) }) : await rpc("gb_public_extras", { p_game_id: Number(id) });
  } catch (e) { return; }
  const mine = me && me.username === g.creator;
  const passes = extras.passes || [], badges = extras.badges || [];
  if (passes.length) {
    $("#passes").innerHTML = passes.map((p) => `<div class="list-row"><div class="medal" style="border-radius:8px;background:linear-gradient(#3fb245,#23862a);border-color:#1b6b21"></div>
      <div class="grow"><div class="title">${esc(p.name)}</div><div class="muted">${esc(p.description)}</div></div>
      ${p.owned || mine ? `<span class="owned">Owned</span>` : `${gbux(p.price)} <button class="btn small green" data-pass="${p.id}" data-price="${p.price}" data-name="${esc(p.name)}">Buy</button>`}</div>`).join("");
    $("#passes-box").hidden = false;
    $("#passes").querySelectorAll("[data-pass]").forEach((b) => (b.onclick = () => buyPass(b)));
  }
  if (badges.length) {
    $("#badges").innerHTML = badges.map((b) => `<div class="list-row"><div class="medal ${b.owned ? "" : "locked"}"></div>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="muted">${esc(b.description)}</div></div>
      <div class="muted" style="font-size:13px;text-align:right">${b.owned ? `<span class="owned">You have it</span><br>` : ""}${num(b.awarded)} have it</div></div>`).join("");
    $("#badges-box").hidden = false;
  }
};

async function buyPass(btn) {
  if (!me) { location.hash = "#/login"; return; }
  if (!confirm(`Buy "${btn.dataset.name}" for ${btn.dataset.price} Gbux?`)) return;
  btn.disabled = true;
  try {
    const r = await authed("gb_buy_pass", { p_pass_id: Number(btn.dataset.pass) });
    setMe(r.user);
    toast(`You bought ${r.name}!`);
    btn.outerHTML = `<span class="owned">Owned</span>`;
  } catch (e) { toast(e.message); btn.disabled = false; }
}

// ---- catalog

const CATALOG_TABS = [["hats", "Hats"], ["shirt", "Shirts"], ["tshirt", "T-Shirts"], ["pants", "Pants"], ["decal", "Decals"]];

async function catalogPage([tab]) {
  tab = CATALOG_TABS.some((t) => t[0] === tab) ? tab : "hats";
  const tabs = `<div class="tabs">${CATALOG_TABS.map(([k, n]) => `<a href="#/catalog/${k}" class="${k === tab ? "active" : ""}">${n}</a>`).join("")}</div>`;
  let items;
  if (tab === "hats") {
    const owned = me ? me.items || [] : [];
    const wearing = me && me.avatar ? me.avatar.hat : "";
    items = HATS.map((h) => {
      const has = owned.includes(h.id);
      const action = !me ? `<a class="btn small green" href="#/login">Buy</a>`
        : wearing === h.id ? `<button class="btn small" data-wear-hat="none">Take off</button>`
        : has ? `<button class="btn small blue" data-wear-hat="${h.id}">Wear</button>`
        : `<button class="btn small green" data-buy-hat="${h.id}" data-price="${h.price}" data-name="${esc(h.name)}">Buy</button>`;
      return `<div class="card item"><div class="thumb-box"><svg viewBox="56 0 88 64">${hatSvg(h.id)}</svg></div>
        <div class="info"><div class="name">${esc(h.name)}</div><div class="actions">${has ? `<span class="owned">Owned</span>` : gbux(h.price)}${action}</div></div></div>`;
    }).join("");
  } else {
    const list = await rpc("gb_list_assets", { p_kind: tab });
    const wearable = tab !== "decal";
    const wearing = me && me.avatar ? Number(me.avatar[tab]) || 0 : 0;
    items = list.map((a) => `<div class="card item"><div class="thumb-box"><img data-asset="${a.id}" alt="" hidden></div>
      <div class="info"><div class="name">${esc(a.name)}</div><div class="sub">by <a href="#/user/${encodeURIComponent(a.creator)}">${esc(a.creator)}</a></div>
      ${wearable ? `<div class="actions"><span class="muted" style="font-size:13px">Free to wear</span>
        ${!me ? "" : wearing === a.id ? `<button class="btn small" data-wear="${tab}" data-id="0">Take off</button>` : `<button class="btn small blue" data-wear="${tab}" data-id="${a.id}">Wear</button>`}</div>` : ""}
      </div></div>`).join("");
    if (!list.length) items = "";
  }
  const note = tab === "hats" ? "" : `<p class="muted">Make your own in the Goblox app: Catalog &rarr; Create.${tab === "shirt" || tab === "pants" ? " Shirts and pants cost Gbux to upload; T-shirts are free." : ""}</p>`;
  return `<h1>Catalog</h1>${tabs}${note}${items ? `<div class="grid">${items}</div>` : `<div class="box"><div class="body empty">Nothing here yet.</div></div>`}`;
}
catalogPage.after = () => {
  page().querySelectorAll("[data-buy-hat]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Buy ${b.dataset.name} for ${b.dataset.price} Gbux?`)) return;
    b.disabled = true;
    try {
      setMe(await authed("gb_buy_item", { p_item: b.dataset.buyHat }));
      toast(`You bought ${b.dataset.name}!`);
      route();
    } catch (e) { toast(e.message); b.disabled = false; }
  }));
  const wear = async (changes) => {
    const av = { ...DEFAULT_AVATAR, ...(me.avatar || {}), ...changes };
    try {
      setMe(await authed("gb_save_avatar", { p_avatar: av }));
      toast("Avatar saved");
      route();
    } catch (e) { toast(e.message); }
  };
  page().querySelectorAll("[data-wear-hat]").forEach((b) => (b.onclick = () => wear({ hat: b.dataset.wearHat })));
  page().querySelectorAll("[data-wear]").forEach((b) => (b.onclick = () => wear({ [b.dataset.wear]: Number(b.dataset.id) })));
};

// ---- profiles

async function userPage([name]) {
  const p = await rpc("gb_public_profile", { p_username: name || "" });
  if (!p) return `<div class="box"><div class="body empty"><h2>Player not found</h2></div></div>`;
  const isMe = me && me.username.toLowerCase() === p.username.toLowerCase();
  const status = p.playing ? `<span class="dot ingame"></span>Playing <a href="#/game/${p.playing.id}">${esc(p.playing.name)}</a>`
    : p.online ? `<span class="dot online"></span>Online` : `<span class="dot"></span>Offline`;
  return `<div class="box"><div class="body profile-head">
      <div class="avatar-box">${avatarSvg(p.avatar)}</div>
      <div class="grow">
        <h1>${esc(p.username)}${verifiedMark(p.verified)}${p.admin ? `<span class="admin-tag">Admin</span>` : ""}</h1>
        <p>${status}</p>
        <p class="muted">Joined ${esc(dateText(p.joined))} &middot; ${num(p.friends)} friends &middot; ${num(p.games.length)} games &middot; ${num(p.badges.length)} badges</p>
        <p>${isMe ? `<a class="btn" href="#/catalog">Change avatar</a>` : me ? `<button class="btn blue" id="add-friend">Add friend</button>` : ""}
           ${p.playing && !isMe ? `<button class="btn green" data-join="${p.playing.id}" data-name="${esc(p.playing.name)}">Join game</button>` : ""}</p>
      </div></div></div>
    <div class="row" style="margin-top:18px">
      <div class="grow box"><div class="strip">Games</div><div class="body">${p.games.length ? `<div class="grid">${p.games.map((g) => gameCard({ ...g, creator: p.username })).join("")}</div>` : `<div class="empty">No games yet.</div>`}</div></div>
      <div class="grow box"><div class="strip">Badges</div><div class="body">${p.badges.length ? p.badges.map((b) => `<div class="list-row"><div class="medal"></div>
        <div class="grow"><div class="title">${esc(b.name)}</div><div class="muted" style="font-size:13px">from <a href="#/game/${b.game_id}">${esc(b.game_name)}</a> &middot; ${esc(ago(b.awarded_at))}</div></div></div>`).join("") : `<div class="empty">No badges yet.</div>`}</div></div>
    </div>`;
}
userPage.after = ([name]) => {
  bindJoinButtons(page());
  const add = $("#add-friend");
  if (add) add.onclick = async () => {
    add.disabled = true;
    try {
      const r = await authed("gb_friend_request", { p_username: name });
      toast(r.friends ? "You are now friends!" : "Friend request sent");
      add.textContent = r.friends ? "Friends" : "Request sent";
    } catch (e) { toast(e.message); add.disabled = false; }
  };
};

// ---- friends

async function friendsPage() {
  if (!me) return loginNeeded("see your friends");
  const list = await authed("gb_friends");
  const friends = list.filter((f) => f.status === "friend");
  const incoming = list.filter((f) => f.status === "incoming");
  const outgoing = list.filter((f) => f.status === "outgoing");
  const row = (f, buttons) => `<div class="list-row"><div style="width:48px">${avatarSvg(f.avatar, true)}</div>
    <div class="grow"><a class="title" href="#/user/${encodeURIComponent(f.username)}">${esc(f.username)}</a>${verifiedMark(f.verified)}</div>${buttons}</div>`;
  return `<h1>Friends</h1>
    <div class="row">
      <div class="grow stack">
        ${incoming.length ? `<div class="box"><div class="strip">Friend requests (${incoming.length})</div><div class="body">${incoming.map((f) => row(f,
          `<button class="btn small green" data-accept="${f.id}">Accept</button><button class="btn small" data-decline="${f.id}">Decline</button>`)).join("")}</div></div>` : ""}
        <div class="box"><div class="strip">My friends (${friends.length})</div><div class="body">${friends.length ? `<div class="people">${friends.map(personCard).join("")}</div>` : `<div class="empty">No friends yet - search for players to add them.</div>`}</div></div>
      </div>
      <div class="grow stack" style="max-width:380px">
        <div class="box"><div class="strip">Find players</div><div class="body">
          <form id="search-form" style="display:flex;gap:8px"><input type="search" id="user-search" placeholder="Username" aria-label="Username"><button class="btn blue">Search</button></form>
          <div id="search-results" style="margin-top:10px"></div></div></div>
        ${outgoing.length ? `<div class="box"><div class="strip">Sent requests</div><div class="body">${outgoing.map((f) => row(f, `<button class="btn small" data-cancel="${f.id}">Cancel</button>`)).join("")}</div></div>` : ""}
      </div>
    </div>`;
}
friendsPage.after = () => {
  bindJoinButtons(page());
  const act = (sel, fn, args) => page().querySelectorAll(sel).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await authed(fn, args(b)); route(); refreshFriendCount(); } catch (e) { toast(e.message); b.disabled = false; }
  }));
  act("[data-accept]", "gb_friend_respond", (b) => ({ p_user_id: Number(b.dataset.accept), p_accept: true }));
  act("[data-decline]", "gb_friend_respond", (b) => ({ p_user_id: Number(b.dataset.decline), p_accept: false }));
  act("[data-cancel]", "gb_friend_remove", (b) => ({ p_user_id: Number(b.dataset.cancel) }));
  const form = $("#search-form");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#search-results");
    try {
      const users = await authed("gb_search_users", { p_query: $("#user-search").value });
      out.innerHTML = users.length ? users.map((u) => `<div class="list-row"><div style="width:40px">${avatarSvg(u.avatar, true)}</div>
        <div class="grow"><a class="title" href="#/user/${encodeURIComponent(u.username)}">${esc(u.username)}</a>${verifiedMark(u.verified)}</div>
        <button class="btn small blue" data-add="${esc(u.username)}">Add</button></div>`).join("") : `<div class="empty">Nobody found.</div>`;
      out.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await authed("gb_friend_request", { p_username: b.dataset.add });
          b.textContent = r.friends ? "Friends" : "Sent";
        } catch (err) { toast(err.message); b.disabled = false; }
      }));
    } catch (err) { out.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
  };
};

function loginNeeded(what) {
  return `<div class="box form-box"><div class="strip">Log in</div><div class="body center">
    <p>Log in to ${esc(what)}.</p><p><a class="btn blue" href="#/login">Log in</a> <a class="btn" href="#/signup">Sign up</a></p></div></div>`;
}

// ---- download

function downloadPage() {
  return `<section class="hero">
      <div>
        <h1>Download Goblox</h1>
        <p>The Goblox app has everything: play every game, chat and voice chat with friends, change your avatar, and build your own games in Goblox Studio.</p>
        <div class="actions"><a class="btn big red" href="${DOWNLOAD_URL}" download>&#11015; Download for Windows</a></div>
        <p style="font-size:13px;margin-top:10px">Free &middot; Windows 10 or 11 &middot; 1.3 MB download</p>
      </div>
      <div class="hero-art"><img src="img/icon.png" alt="" width="220" height="220"></div>
    </section>
    <div class="row">
      <div class="grow box"><div class="strip">How to install</div><div class="body"><ol class="steps">
        <li>Download <b>Goblox.zip</b> with the button above.</li>
        <li>Right-click it and choose <b>Extract All</b>, then open the new folder.</li>
        <li>Double-click <b>Goblox.exe</b>. If Windows shows "Windows protected your PC", click <b>More info</b> then <b>Run anyway</b> (the app isn't signed yet).</li>
        <li>Log in or create an account - the same account works on this website.</li>
        <li>From now on, <b>Play</b> buttons on this website open the game straight in the app.</li>
      </ol></div></div>
      <div class="grow box"><div class="strip">System requirements</div><div class="body"><table class="req">
        <tr><td>System</td><td>Windows 10 or 11 (64-bit)</td></tr>
        <tr><td>Graphics</td><td>Any card with OpenGL 3.3 (almost every PC since 2012)</td></tr>
        <tr><td>Internet</td><td>Needed to log in and play online</td></tr>
        <tr><td>Voice chat</td><td>Optional microphone; unlocks when your account is 1 day old</td></tr>
        <tr><td>Disk</td><td>About 10 MB</td></tr></table></div></div>
    </div>
    <div class="box" style="margin-top:18px"><div class="strip">What's new</div><div class="body"><ul class="steps">
      <li><b>New look:</b> the red G logo.</li>
      <li><b>Saving, leaderboards, badges and game passes</b> for game makers (DataStoreService, leaderstats, BadgeService, MarketplaceService).</li>
      <li><b>Friends:</b> add people and join the game they're in.</li>
      <li><b>Element Battle:</b> PvP spells with Fire, Water, Earth, Lightning and Ice.</li>
      <li><b>Studio:</b> Insert Object with every classic object, effects, sounds and GUIs.</li>
      <li><b>Voice chat</b> with mute bubbles, and verified badges.</li>
    </ul></div></div>`;
}

// ---- log in / sign up

function loginPage(signup) {
  if (me) { location.hash = "#/"; return ""; }
  return `<div class="box form-box"><div class="strip">${signup ? "Create your Goblox account" : "Log in to Goblox"}</div><div class="body">
    <form id="auth-form">
      <label for="u">Username</label><input type="text" id="u" autocomplete="username" maxlength="20" required>
      <label for="p">Password</label><input type="password" id="p" autocomplete="${signup ? "new-password" : "current-password"}" required>
      ${signup ? `<p class="muted" style="font-size:13px">3-20 letters, numbers or _. Password at least 6 characters. You start with 100 Gbux.</p>` : ""}
      <div class="error" id="auth-error"></div>
      <button class="btn ${signup ? "red" : "blue"} wide" style="margin-top:6px">${signup ? "Sign up" : "Log in"}</button>
    </form>
    <p class="center muted" style="margin-bottom:0">${signup ? `Already have an account? <a href="#/login">Log in</a>` : `New to Goblox? <a href="#/signup">Create an account</a>`}</p>
  </div></div>`;
}
const authAfter = (signup) => () => {
  const form = $("#auth-form");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", form);
    btn.disabled = true;
    $("#auth-error").textContent = "";
    try {
      const r = await rpc(signup ? "gb_signup" : "gb_login", { p_username: $("#u").value.trim(), p_password: $("#p").value });
      token = r.token;
      store("goblox_token", token);
      setMe(r.user);
      toast(signup ? "Welcome to Goblox! You got 100 Gbux" : "Welcome back!");
      location.hash = "#/";
      refreshFriendCount();
    } catch (err) {
      $("#auth-error").textContent = err.message;
      btn.disabled = false;
    }
  };
};
routes.login.after = authAfter(false);
routes.signup.after = authAfter(true);

// ------------------------------------------------------------------ start

window.addEventListener("hashchange", route);
(async () => {
  renderHeader();
  await refreshMe();
  route();
  refreshFriendCount();
  setInterval(refreshFriendCount, 60000);
})();

// Goblox website: talks to the same Supabase functions as the game (gb_*), with the same login.
// Pages are picked by the address after # (#/games, #/game/11, #/user/Pester ...).
"use strict";

const SUPABASE_URL = "https://danpdfczedispfzqdjqz.supabase.co";
const SUPABASE_KEY = "sb_publishable_PSFCYMxKCXPuHDTPXLkuwg_sZc1w_gy";
const DOWNLOAD_URL = "download/Goblox.zip";
const ANDROID_URL = "download/Goblox.apk";

// Must match src/avatar.cpp (and the prices in gb_buy_item).
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
const MANNEQUIN = [10, 10, 10, 10, 10, 10];  // grey body that shows off catalog clothing

const ICON = {
  play: "M8 5v14l11-7z",
  people: "M16 11a3 3 0 1 0-.01-6.01A3 3 0 0 0 16 11zm-8 0a3 3 0 1 0-.01-6.01A3 3 0 0 0 8 11zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  prev: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  next: "M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z",
  addPerson: "M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  ticket: "M22 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4z",
  download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
};
const icon = (name, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
const VERIFIED = (cls = "verified") => `<svg class="${cls}" viewBox="0 0 24 24" role="img" aria-label="Verified"><title>Verified</title><circle cx="12" cy="12" r="11" fill="#2f8cf0"/><path d="M7 12.5l3.2 3.2L17.5 8.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MEDAL = (owned) => `<svg class="badge-icon" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="${owned ? "#f2b705" : "#c3c7ce"}" stroke="${owned ? "#b07f00" : "#8d939d"}" stroke-width="3"/><path d="M27 13l4.1 8.6 9.4 1.2-6.9 6.5 1.8 9.3L27 34.1l-8.4 4.5 1.8-9.3-6.9-6.5 9.4-1.2z" fill="${owned ? "#fff6d0" : "#eef0f3"}"/></svg>`;

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
    if (/schema cache/i.test(msg)) msg = "This part of the website isn't switched on yet.";
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
if (window.Avatar3D) Avatar3D.setAssetLoader(assetUrl);

let gamesCache = null;
async function allGames(force) {
  if (!gamesCache || force) gamesCache = await rpc("gb_list_games");
  return gamesCache || [];
}

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const page = () => $("#page");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(n) { return Number(n || 0).toLocaleString(); }
function compact(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}
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
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
const userLink = (name) => `#/user/${encodeURIComponent(name)}`;

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
function gbux(n) { return `<span class="price"><span class="coin"></span>${num(n)}</span>`; }

// ------------------------------------------------------------------ pictures

// Coloured square with the game's initials, for games without an icon.
function initialsTile(id, name) {
  const hue = (Number(id) * 67) % 360;
  const words = String(name || "?").trim().split(/\s+/);
  const letters = (words[0][0] + (words[1] ? words[1][0] : "")).toUpperCase();
  return `<div class="tile" style="background:linear-gradient(135deg,hsl(${hue} 55% 48%),hsl(${(hue + 40) % 360} 55% 32%))">${esc(letters)}</div>`;
}
// <img data-asset="id"> placeholders get their picture once it arrives (replacing the tile before them).
function fillAssets(root) {
  $$("img[data-asset]", root).forEach((img) => {
    const id = img.dataset.asset;
    img.removeAttribute("data-asset");
    assetUrl(id).then((url) => {
      if (!url) return;
      img.src = url;
      img.hidden = false;
      const prev = img.previousElementSibling;
      if (prev && prev.classList.contains("tile")) prev.remove();
    });
  });
}

// Flat picture of an avatar, used when the browser can't do 3D.
function flatAvatar(av, kind) {
  av = av && Array.isArray(av.colors) && av.colors.length === 6 ? av : DEFAULT_AVATAR;
  const c = (i) => { const k = BODY_COLORS[av.colors[i]] || BODY_COLORS[0]; return `rgb(${k[0]},${k[1]},${k[2]})`; };
  // (An SVG shown as an image can't load face.png, so the face is drawn.)
  const head = `<rect x="74" y="44" width="52" height="46" rx="12" fill="${c(1)}"/>
    <ellipse cx="92" cy="60" rx="2.6" ry="5" fill="#111"/><ellipse cx="108" cy="60" rx="2.6" ry="5" fill="#111"/>
    <path d="M88 73 Q100 86 112 73" fill="none" stroke="#111" stroke-width="3.2" stroke-linecap="round"/>`;
  const body = `<rect x="40" y="96" width="30" height="62" rx="3" fill="${c(2)}"/><rect x="130" y="96" width="30" height="62" rx="3" fill="${c(3)}"/>
    <rect x="70" y="158" width="29" height="62" rx="2" fill="${c(4)}"/><rect x="101" y="158" width="29" height="62" rx="2" fill="${c(5)}"/>
    <rect x="70" y="96" width="60" height="64" rx="2" fill="${c(0)}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${kind === "head" ? "56 30 88 88" : "20 30 160 200"}">${kind === "head" ? "" : body}${head}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function avatarImg(av, kind = "head", cls = "", size) {
  const data = esc(JSON.stringify(av || DEFAULT_AVATAR));
  return `<img class="${cls}" data-avatar="${kind}" data-av="${data}"${size ? ` data-size="${size}"` : ""} alt="">`;
}
// Renders every <img data-avatar> in 3D (cached), or the flat picture without WebGL.
function fillAvatars(root) {
  $$("img[data-avatar]", root).forEach((img) => {
    const kind = img.dataset.avatar;
    let av;
    try { av = JSON.parse(img.dataset.av); } catch (e) { av = DEFAULT_AVATAR; }
    const size = Number(img.dataset.size) || (kind === "body" ? 360 : 200);
    img.removeAttribute("data-avatar");
    const flat = () => { img.src = flatAvatar(av, kind); };
    if (!window.Avatar3D || !Avatar3D.hasWebGL()) return flat();
    Avatar3D.thumbnail(av, kind, size).then((url) => (url ? (img.src = url) : flat()));
  });
}
function fillPictures(root = page()) {
  fillAssets(root);
  fillAvatars(root);
}

function gameCard(g) {
  const pic = Number(g.icon_id) || 0;
  return `<a class="gcard" href="#/game/${g.id}">
    <div class="media">${initialsTile(g.id, g.name)}${pic ? `<img data-asset="${pic}" alt="" hidden>` : ""}${g.featured ? `<span class="tag">Featured</span>` : ""}</div>
    <div class="title">${esc(g.name)}</div>
    <div class="meta">${icon("people")}${compact(g.plays)} ${Number(g.plays) === 1 ? "visit" : "visits"}</div></a>`;
}
function gameRow(title, games, more) {
  if (!games.length) return "";
  return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><span class="spacer"></span>${more ? `<a class="more" href="${more}">See all</a>` : ""}</div>
    <div class="row-scroll"><button class="row-arrow prev" aria-label="Scroll left" hidden>${icon("prev", "")}</button>
      <div class="row-track">${games.map(gameCard).join("")}</div>
      <button class="row-arrow next" aria-label="Scroll right" hidden>${icon("next", "")}</button></div></section>`;
}
function bindRows(root = page()) {
  $$(".row-scroll", root).forEach((row) => {
    const track = $(".row-track", row), prev = $(".prev", row), next = $(".next", row);
    const update = () => {
      prev.hidden = track.scrollLeft < 4;
      next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    prev.onclick = () => (track.scrollLeft -= track.clientWidth * 0.8);
    next.onclick = () => (track.scrollLeft += track.clientWidth * 0.8);
    track.addEventListener("scroll", update, { passive: true });
    update();
  });
}

// ------------------------------------------------------------------ header

function renderHeader() {
  const acc = $("#account");
  if (me) {
    acc.innerHTML = `
      <span class="gbux-chip" title="Your Gbux"><span class="coin"></span>${num(me.gbux)}</span>
      <a class="icon-btn" href="#/friends" title="Friends" aria-label="Friends">${icon("people", "")}<span class="count" id="friend-count" hidden></span></a>
      <button class="me-btn" id="me-btn" aria-haspopup="true" aria-expanded="false">${avatarImg(me.avatar, "head", "", 96)}<span>${esc(me.username)}</span></button>`;
    fillAvatars(acc);
    $("#me-btn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  } else {
    acc.innerHTML = `<a class="link" href="#/login">Log in</a><a class="btn btn-primary btn-sm" href="#/signup">Sign up</a>`;
  }
  const ann = $("#announcement");
  ann.hidden = !(me && me.announcement);
  if (me && me.announcement) ann.textContent = me.announcement;
  const tab = (location.hash.split("/")[1] || "").toLowerCase();
  $$(".mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab || (tab === "game" && a.dataset.tab === "games")));
}

function toggleMenu(force) {
  let menu = $("#menu");
  const open = force !== undefined ? force : !menu;
  if (menu) menu.remove();
  $("#me-btn") && $("#me-btn").setAttribute("aria-expanded", String(open));
  if (!open || !me) return;
  menu = document.createElement("div");
  menu.id = "menu";
  menu.className = "menu";
  menu.innerHTML = `<a href="${userLink(me.username)}">Profile</a><a href="#/friends">Friends</a><a href="#/catalog">Catalog</a>
    <a href="#/download">Download Goblox</a><hr><button id="logout">Log out</button>`;
  document.body.appendChild(menu);
  $("#logout").onclick = () => {
    authed("gb_logout").catch(() => {});
    logoutLocal();
    toggleMenu(false);
    location.hash = "#/";
    route();
  };
}
document.addEventListener("click", (e) => { if ($("#menu") && !e.target.closest("#menu")) toggleMenu(false); });

function logoutLocal() {
  token = "";
  me = null;
  store("goblox_token", "");
  renderHeader();
}
function setMe(profile) {
  me = profile;
  renderHeader();
  refreshFriendCount();
}
async function refreshMe() {
  if (!token) return;
  try { me = await authed("gb_me"); } catch (e) { /* logged out by rpc() if the session expired */ }
  renderHeader();
}
let friendCount = 0;
async function refreshFriendCount() {
  if (!me) return;
  try {
    const list = await authed("gb_friends");
    friendCount = list.filter((f) => f.status === "incoming").length;
  } catch (e) { /* ignore */ }
  const pill = $("#friend-count");
  if (pill) {
    pill.hidden = !friendCount;
    pill.textContent = friendCount;
  }
}

$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

// ------------------------------------------------------------------ playing (opens the Goblox app)

// goblox://play/<id> opens the installed app (it registers that link the first time it runs).
function playGame(id, name) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Starting Goblox">
      <div class="spinner"></div>
      <h2>Starting Goblox</h2>
      <p class="muted">Opening <b>${esc(name || "the game")}</b> in the Goblox app.</p>
      <p class="hint">Nothing happening? Install Goblox and open it once, then press Play again.</p>
      <div class="actions"><a class="btn btn-primary" href="#/download" data-close>${icon("download")}Download Goblox</a><button class="btn" data-close>Close</button></div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  $$("[data-close]", back).forEach((b) => b.addEventListener("click", close));
  back.onclick = (e) => e.target === back && close();
  location.href = `goblox://play/${id}`;
}
function bindJoinButtons(root = page()) {
  $$("[data-join]", root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); playGame(b.dataset.join, b.dataset.name); }));
}

// ------------------------------------------------------------------ pages

const routes = {
  "": homePage,
  games: gamesPage,
  game: gamePage,
  search: searchPage,
  catalog: catalogPage,
  user: userPage,
  friends: friendsPage,
  download: downloadPage,
  login: () => authPage(false),
  signup: () => authPage(true),
};

let routeId = 0;
let liveViewer = null;  // the profile page's 3D view, stopped when leaving the page
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const fn = routes[parts[0].toLowerCase()] || notFound;
  const id = ++routeId;
  if (liveViewer) { liveViewer.destroy(); liveViewer = null; }
  toggleMenu(false);
  renderHeader();
  page().innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  window.scrollTo(0, 0);
  try {
    const html = await fn(parts.slice(1));
    if (id !== routeId) return;  // the user already went somewhere else
    if (typeof html === "string") page().innerHTML = html;
    fillPictures();
    bindRows();
    bindJoinButtons();
    if (fn.after) fn.after(parts.slice(1));
  } catch (e) {
    if (id === routeId) page().innerHTML = `<div class="wrap"><div class="panel empty">${esc(e.message)}</div></div>`;
  }
}

function notFound() {
  return `<div class="wrap"><div class="panel empty"><h2>Page not found</h2><p><a href="#/">Back to the home page</a></p></div></div>`;
}

// ---- home

async function homePage() {
  const [games, stats] = await Promise.all([allGames(true), rpc("gb_site_stats").catch(() => null)]);
  const popular = [...games].sort((a, b) => b.plays - a.plays);
  const featured = games.filter((g) => g.featured);
  const recent = [...games].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const rows = gameRow("Featured", featured, "#/games") + gameRow("Popular", popular, "#/games") +
    (games.length > 8 ? gameRow("Recently updated", recent, "#/games") : "");
  if (me) {
    return `<div class="wrap">
      <div class="hello">${avatarImg(me.avatar, "head", "headshot", 240)}<div><h1>Hello, ${esc(me.username)}!</h1>
        <div class="muted">${gbux(me.gbux)} Gbux</div></div><span class="spacer"></span>
        ${me.daily_ready ? `<button class="btn btn-green" id="daily">Claim daily 50 Gbux</button>` : ""}</div>
      <section class="section" id="home-friends"><div class="section-head"><h2>Friends</h2><span class="spacer"></span><a class="more" href="#/friends">See all</a></div>
        <div class="friend-strip"><a class="friend" href="#/friends"><div class="add-friend-tile">${icon("addPerson", "")}</div><div class="name">Add friends</div></a></div></section>
      ${rows || `<div class="panel empty">No games yet.</div>`}
    </div>`;
  }
  // Logged out: what Goblox is, with the sign-up form, over a wall of real game pictures.
  const pics = games.map((g) => Number(g.thumb_id) || Number(g.icon_id)).filter(Boolean);
  const tiles = pics.length ? Array.from({ length: 48 }, (_, i) => `<div data-bg="${pics[i % pics.length]}"></div>`).join("") : "";
  return `<section class="landing">
      <div class="mosaic" aria-hidden="true">${tiles}</div>
      <div class="landing-inner">
        <div>
          <h1>Play games made by players.<br>Then make your own.</h1>
          <p class="lead">Obbies, battles, hangouts and whatever people build next. Join with friends, chat, and make your own in Goblox Studio.</p>
          <div class="actions"><a class="btn btn-primary btn-lg" href="#/download">${icon("download")}Download for Windows</a>
            <a class="btn btn-dark btn-lg" href="#/games">Browse games</a></div>
          ${stats && stats.users >= 25 ? `<div class="stats-strip"><div><b>${num(stats.games)}</b><span>games</span></div><div><b>${num(stats.users)}</b><span>players</span></div>
            <div><b>${num(stats.plays)}</b><span>visits</span></div><div><b>${num(stats.online)}</b><span>online now</span></div></div>` : ""}
        </div>
        <div class="signup-card">
          <h2>Create your account</h2>
          <p class="hint">Free. No email needed. You start with 100 Gbux.</p>
          <form id="auth-form">
            <label class="field"><span>Username</span><input id="u" autocomplete="username" maxlength="20" required></label>
            <label class="field"><span>Password</span><input id="p" type="password" autocomplete="new-password" required></label>
            <div class="error" id="auth-error"></div>
            <button class="btn btn-primary btn-block btn-lg">Sign up</button>
          </form>
          <p class="hint" style="margin:14px 0 0;text-align:center">Already have an account? <a href="#/login">Log in</a></p>
        </div>
      </div>
    </section>
    <div class="wrap">${rows || `<div class="panel empty">No games yet.</div>`}</div>`;
}
homePage.after = async () => {
  $$(".mosaic [data-bg]").forEach((tile) => assetUrl(tile.dataset.bg).then((url) => url && (tile.style.backgroundImage = `url("${url}")`)));
  if (!me) bindAuthForm(true);
  const daily = $("#daily");
  if (daily) daily.onclick = async () => {
    daily.disabled = true;
    try {
      const r = await authed("gb_claim_daily");
      setMe(r.user);
      toast(r.granted ? "You got 50 Gbux!" : "Already claimed today. Come back tomorrow.");
      daily.remove();
    } catch (e) { toast(e.message); daily.disabled = false; }
  };
  const strip = $("#home-friends .friend-strip");
  if (strip) {
    try {
      const friends = (await authed("gb_friends")).filter((f) => f.status === "friend");
      strip.insertAdjacentHTML("afterbegin", friends.map(friendBubble).join(""));
      fillAvatars(strip);
      bindJoinButtons(strip);
    } catch (e) { /* ignore */ }
  }
};

function presenceOf(f) {
  if (f.game_id) return { cls: "ingame", text: f.game_name || "In a game" };
  if (f.online) return { cls: "online", text: "Online" };
  return { cls: "", text: "Offline" };
}
function friendBubble(f) {
  const p = presenceOf(f);
  return `<a class="friend" href="${userLink(f.username)}"><div class="pic">${avatarImg(f.avatar, "head")}${p.cls ? `<span class="presence ${p.cls}"></span>` : ""}</div>
    <div class="name">${esc(f.username)}</div><div class="status">${esc(p.text)}</div></a>`;
}

// ---- discover / search

let gameSort = "popular";
function sortGames(games, sort) {
  if (sort === "new") return [...games].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (sort === "name") return [...games].sort((a, b) => a.name.localeCompare(b.name));
  return [...games].sort((a, b) => b.plays - a.plays);
}
async function gamesPage() {
  const games = await allGames(true);
  return `<div class="wrap"><div class="toolbar"><h1>Discover</h1>
      <div class="chips" role="group" aria-label="Sort games">
        <button class="chip" data-sort="popular">Popular</button><button class="chip" data-sort="new">Recently updated</button><button class="chip" data-sort="name">A to Z</button>
      </div></div>
    <div class="grid" id="game-grid">${sortGames(games, gameSort).map(gameCard).join("")}</div></div>`;
}
gamesPage.after = async () => {
  const games = await allGames();
  const draw = () => {
    $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.sort === gameSort));
    $("#game-grid").innerHTML = sortGames(games, gameSort).map(gameCard).join("");
    fillAssets($("#game-grid"));
  };
  $$(".chip").forEach((c) => (c.onclick = () => { gameSort = c.dataset.sort; draw(); }));
  draw();
};

async function searchPage([q = ""]) {
  $("#search-input").value = q;
  const needle = q.toLowerCase();
  const games = (await allGames()).filter((g) => g.name.toLowerCase().includes(needle) || String(g.creator).toLowerCase().includes(needle));
  let people = [];
  try {
    if (me) people = await authed("gb_search_users", { p_query: q });
    else {
      const p = await rpc("gb_public_profile", { p_username: q });
      if (p) people = [p];
    }
  } catch (e) { /* players need the newer server functions */ }
  return `<div class="wrap"><h1 style="margin-bottom:22px">Results for “${esc(q)}”</h1>
    ${people.length ? `<section class="section"><div class="section-head"><h2>Players</h2></div><div class="people">${people.map((u) => `
      <a class="person" href="${userLink(u.username)}"><div class="pic">${avatarImg(u.avatar, "head")}</div><div class="name">${esc(u.username)}${u.verified ? VERIFIED("verified sm") : ""}</div></a>`).join("")}</div></section>` : ""}
    <section class="section"><div class="section-head"><h2>Games</h2></div>
      ${games.length ? `<div class="grid">${games.map(gameCard).join("")}</div>` : `<div class="panel empty">No games match “${esc(q)}”.</div>`}</section></div>`;
}

// ---- one game

async function gamePage([id]) {
  let g = (await allGames()).find((x) => String(x.id) === String(id));
  if (!g) g = (await allGames(true)).find((x) => String(x.id) === String(id));
  if (!g) return `<div class="wrap"><div class="panel empty"><h2>Game not found</h2><p>It may have been deleted. <a href="#/games">See all games</a></p></div></div>`;
  const pic = Number(g.thumb_id) || Number(g.icon_id) || 0;
  return `<div class="wrap">
    <div class="game-top">
      <div class="game-media">${initialsTile(g.id, g.name)}${pic ? `<img data-asset="${pic}" alt="" hidden>` : ""}</div>
      <div class="game-side">
        <h1>${esc(g.name)}</h1>
        <div class="by">By <a href="${userLink(g.creator)}">${esc(g.creator)}</a></div>
        <button class="play-btn" data-join="${g.id}" data-name="${esc(g.name)}" aria-label="Play ${esc(g.name)}">${icon("play", "")}</button>
        <dl class="game-stats">
          <div><dt>Visits</dt><dd>${compact(g.plays)}</dd></div>
          <div><dt>Updated</dt><dd>${esc(ago(g.updated_at).replace(" ago", "") || "-")}</dd></div>
          <div><dt>Badges</dt><dd id="badge-count">-</dd></div>
        </dl>
      </div>
    </div>
    <nav class="tabs" style="margin-top:32px" aria-label="Game sections">
      <button class="active" data-tab="about">About</button><button data-tab="store">Store</button><button data-tab="badges">Badges</button>
    </nav>
    <section data-pane="about"><div class="panel panel-pad"><h3 style="margin-bottom:10px">Description</h3><div class="desc">${esc(g.description || "No description yet.")}</div></div></section>
    <section data-pane="store" hidden><div class="panel panel-pad" id="passes"><div class="empty">Loading...</div></div></section>
    <section data-pane="badges" hidden><div class="panel panel-pad" id="badges"><div class="empty">Loading...</div></div></section>
  </div>`;
}
gamePage.after = async ([id]) => {
  $$(".tabs button").forEach((b) => (b.onclick = () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
  const g = (await allGames()).find((x) => String(x.id) === String(id));
  if (!g) return;
  let extras = { passes: [], badges: [] };
  try {
    extras = me ? await authed("gb_game_extras", { p_game_id: Number(id) }) : await rpc("gb_public_extras", { p_game_id: Number(id) });
  } catch (e) { /* not available yet */ }
  const mine = me && me.username === g.creator;
  const passes = extras.passes || [], badges = extras.badges || [];
  $("#badge-count").textContent = badges.length;
  $("#passes").innerHTML = passes.length ? passes.map((p) => `<div class="list-item"><div class="pass-icon">${icon("ticket", "")}</div>
      <div class="grow"><div class="title">${esc(p.name)}</div><div class="muted">${esc(p.description)}</div></div>
      ${p.owned || mine ? `<span class="owned">Owned</span>` : `${gbux(p.price)}<button class="btn btn-green btn-sm" data-pass="${p.id}" data-price="${p.price}" data-name="${esc(p.name)}">Buy</button>`}</div>`).join("")
    : `<div class="empty">This game has no passes for sale.</div>`;
  $$("[data-pass]").forEach((b) => (b.onclick = () => buyPass(b)));
  $("#badges").innerHTML = badges.length ? badges.map((b) => `<div class="list-item">${MEDAL(b.owned)}
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="muted">${esc(b.description)}</div></div>
      <div style="text-align:right">${b.owned ? `<div class="owned">Earned</div>` : ""}<div class="faint" style="font-size:14px">${num(b.awarded)} earned</div></div></div>`).join("")
    : `<div class="empty">This game has no badges yet.</div>`;
};

async function buyPass(btn) {
  if (!me) { location.hash = "#/login"; return; }
  if (!confirm(`Buy "${btn.dataset.name}" for ${btn.dataset.price} Gbux?`)) return;
  btn.disabled = true;
  try {
    const r = await authed("gb_buy_pass", { p_pass_id: Number(btn.dataset.pass) });
    setMe(r.user);
    toast(`You bought ${r.name}!`);
    btn.previousElementSibling && btn.previousElementSibling.remove();
    btn.outerHTML = `<span class="owned">Owned</span>`;
  } catch (e) { toast(e.message); btn.disabled = false; }
}

// ---- catalog

const CATALOG_TABS = [["hats", "Hats"], ["shirt", "Shirts"], ["tshirt", "T-Shirts"], ["pants", "Pants"], ["decal", "Decals"]];

async function catalogPage([tab]) {
  tab = CATALOG_TABS.some((t) => t[0] === tab) ? tab : "hats";
  const nav = `<nav class="side-nav" aria-label="Categories">${CATALOG_TABS.map(([k, n]) => `<a href="#/catalog/${k}" class="${k === tab ? "active" : ""}">${n}</a>`).join("")}</nav>`;
  let items = "", note = "";
  if (tab === "hats") {
    const owned = me ? me.items || [] : [];
    const wearing = me && me.avatar ? me.avatar.hat : "";
    items = HATS.map((h) => {
      const has = owned.includes(h.id);
      const action = !me ? `<a class="btn btn-green btn-sm" href="#/login">Buy</a>`
        : wearing === h.id ? `<button class="btn btn-sm" data-wear-hat="none">Take off</button>`
        : has ? `<button class="btn btn-sm" data-wear-hat="${h.id}">Wear</button>`
        : `<button class="btn btn-green btn-sm" data-buy-hat="${h.id}" data-price="${h.price}" data-name="${esc(h.name)}">Buy</button>`;
      return `<div class="item"><div class="media">${avatarImg({ hat: h.id }, "hat", "", 320)}</div>
        <div class="title">${esc(h.name)}</div><div class="buy">${has ? `<span class="owned">Owned</span>` : gbux(h.price)}${action}</div></div>`;
    }).join("");
  } else {
    const list = await rpc("gb_list_assets", { p_kind: tab });
    const wearable = tab !== "decal";
    const wearing = me && me.avatar ? Number(me.avatar[tab]) || 0 : 0;
    items = list.map((a) => {
      const pic = wearable ? avatarImg({ colors: MANNEQUIN, [tab]: a.id }, "body", "", 360) : `<img class="decal" data-asset="${a.id}" alt="" hidden>`;
      const action = !wearable || !me ? "" : wearing === a.id ? `<button class="btn btn-sm" data-wear="${tab}" data-id="0">Take off</button>`
        : `<button class="btn btn-sm" data-wear="${tab}" data-id="${a.id}">Wear</button>`;
      return `<div class="item"><div class="media">${pic}</div><div class="title">${esc(a.name)}</div>
        <div class="meta">By <a href="${userLink(a.creator)}">${esc(a.creator)}</a></div>
        ${wearable ? `<div class="buy"><span class="faint" style="font-size:14px">Free</span>${action}</div>` : ""}</div>`;
    }).join("");
    note = `<p class="hint" style="margin-bottom:18px">Make your own in the Goblox app (Catalog, then Create).${tab === "shirt" || tab === "pants" ? " Shirts and pants cost Gbux to upload; T-shirts are free." : ""}</p>`;
  }
  const title = CATALOG_TABS.find((t) => t[0] === tab)[1];
  return `<div class="wrap"><h1 style="margin-bottom:22px">Catalog</h1><div class="catalog">${nav}<div>
    <h2 style="margin-bottom:6px">${title}</h2>${note}
    ${items ? `<div class="grid">${items}</div>` : `<div class="panel empty">Nothing here yet.</div>`}</div></div></div>`;
}
catalogPage.after = () => {
  $$("[data-buy-hat]").forEach((b) => (b.onclick = async () => {
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
  $$("[data-wear-hat]").forEach((b) => (b.onclick = () => wear({ hat: b.dataset.wearHat })));
  $$("[data-wear]").forEach((b) => (b.onclick = () => wear({ [b.dataset.wear]: Number(b.dataset.id) })));
};

// ---- profiles

let profileData = null;
async function userPage([name]) {
  const p = await rpc("gb_public_profile", { p_username: name || "" });
  if (!p) return `<div class="wrap"><div class="panel empty"><h2>Player not found</h2><p>Check the spelling, or <a href="#/games">browse games</a>.</p></div></div>`;
  profileData = p;
  const isMe = me && me.username.toLowerCase() === p.username.toLowerCase();
  const status = p.playing ? `<span class="dot ingame"></span>Playing <a href="#/game/${p.playing.id}">${esc(p.playing.name)}</a>`
    : p.online ? `<span class="dot online"></span>Online` : `<span class="dot"></span>Offline`;
  return `<div class="wrap">
    <div class="profile-top">
      <div class="stage" id="stage">${window.Avatar3D && Avatar3D.hasWebGL() ? `<span class="hint-drag">Drag to turn</span>` : `<img class="flat" src="${flatAvatar(p.avatar, "body")}" alt="">`}</div>
      <div class="profile-info">
        <h1>${esc(p.username)}${p.verified ? VERIFIED() : ""}${p.admin ? `<span class="role">Admin</span>` : ""}</h1>
        <div class="status-line">${status}</div>
        <div class="profile-stats">
          <div><b>${num(p.friends)}</b><span>Friends</span></div>
          <div><b>${num(p.games.length)}</b><span>Games</span></div>
          <div><b>${num(p.badges.length)}</b><span>Badges</span></div>
          <div><b>${esc(dateText(p.joined))}</b><span>Joined</span></div>
        </div>
        <div class="profile-actions">
          ${isMe ? `<a class="btn" href="#/catalog">Change avatar</a>` : me ? `<button class="btn btn-primary" id="add-friend">${icon("addPerson")}Add friend</button>` : `<a class="btn btn-primary" href="#/signup">Sign up to add friends</a>`}
          ${p.playing && !isMe ? `<button class="btn btn-green" data-join="${p.playing.id}" data-name="${esc(p.playing.name)}">${icon("play")}Join game</button>` : ""}
        </div>
      </div>
    </div>
    ${(p.goblox_badges || []).length ? `<section class="section"><div class="section-head"><h2>Goblox Badges</h2><span class="spacer"></span><a class="more" href="#/badges">All Goblox Badges</a></div>
      <div class="gb-badges">${p.goblox_badges.map(gobloxBadgeTile).join("")}</div></section>` : ""}
    <nav class="tabs" style="margin-top:34px" aria-label="Profile sections"><button class="active" data-tab="games">Creations</button><button data-tab="badges">Game badges</button></nav>
    <section data-pane="games">${p.games.length ? `<div class="grid">${p.games.map((g) => gameCard({ ...g, creator: p.username })).join("")}</div>` : `<div class="panel empty">No games yet.</div>`}</section>
    <section data-pane="badges" hidden><div class="panel panel-pad">${p.badges.length ? p.badges.map((b) => `<div class="list-item">${MEDAL(true)}
        <div class="grow"><div class="title">${esc(b.name)}</div><div class="muted" style="font-size:14px">From <a href="#/game/${b.game_id}">${esc(b.game_name)}</a> · ${esc(ago(b.awarded_at))}</div></div></div>`).join("")
      : `<div class="empty">No badges yet.</div>`}</div></section>
  </div>`;
}
userPage.after = ([name]) => {
  if (window.Avatar3D && Avatar3D.hasWebGL() && profileData) liveViewer = Avatar3D.viewer($("#stage"), profileData.avatar);
  $$(".tabs button").forEach((b) => (b.onclick = () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));
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

// ---- Goblox Badges

function gobloxBadgeTile(b) {
  return `<div class="gb-badge" title="${esc(b.description)}"><img src="img/badges/${esc(b.id)}.png" alt="">
    <div class="name">${esc(b.name)}</div>${b.awarded_at ? `<div class="when">${esc(dateText(b.awarded_at))}</div>` : ""}</div>`;
}

async function badgesPage() {
  const list = await rpc("gb_goblox_badge_list");
  const mine = new Set(me && Array.isArray(me.goblox_badges) ? me.goblox_badges.map((b) => b.id) : []);
  return `<div class="wrap"><h1 style="margin-bottom:6px">Goblox Badges</h1>
    <p class="muted" style="margin-bottom:24px">Badges for what you do on Goblox itself. They show on your profile.</p>
    <div class="panel panel-pad">${list.map((b) => `<div class="list-item"><img class="gb-big" src="img/badges/${esc(b.id)}.png" alt="">
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="muted">${esc(b.description)}</div></div>
      <div style="text-align:right">${mine.has(b.id) ? `<div class="owned">You have it</div>` : ""}<div class="faint" style="font-size:14px">${num(b.holders)} ${Number(b.holders) === 1 ? "player has" : "players have"} it</div></div></div>`).join("")}</div></div>`;
}
routes.badges = badgesPage;

// ---- friends

async function friendsPage() {
  if (!me) return loginNeeded("see your friends");
  const list = await authed("gb_friends");
  const friends = list.filter((f) => f.status === "friend");
  const incoming = list.filter((f) => f.status === "incoming");
  const outgoing = list.filter((f) => f.status === "outgoing");
  const row = (f, buttons) => `<div class="person-row">${avatarImg(f.avatar, "head")}
    <a class="grow" href="${userLink(f.username)}">${esc(f.username)}${f.verified ? VERIFIED("verified sm") : ""}</a><div class="actions">${buttons}</div></div>`;
  const card = (f) => {
    const p = presenceOf(f);
    return `<div class="person"><a class="pic" href="${userLink(f.username)}" style="display:block">${avatarImg(f.avatar, "head")}${p.cls ? `<span class="presence ${p.cls}"></span>` : ""}</a>
      <a class="name" href="${userLink(f.username)}" style="display:block;color:inherit">${esc(f.username)}${f.verified ? VERIFIED("verified sm") : ""}</a>
      <div class="status">${esc(p.text)}</div>${f.game_id ? `<button class="btn btn-green btn-sm" data-join="${f.game_id}" data-name="${esc(f.game_name || "")}">Join</button>` : ""}</div>`;
  };
  return `<div class="wrap"><h1 style="margin-bottom:22px">Friends</h1><div class="split">
      <div>
        ${incoming.length ? `<section class="section"><div class="section-head"><h2>Requests</h2><span class="faint">${incoming.length}</span></div><div class="panel panel-pad">${incoming.map((f) => row(f,
          `<button class="btn btn-green btn-sm" data-accept="${f.id}">Accept</button><button class="btn btn-sm" data-decline="${f.id}">Ignore</button>`)).join("")}</div></section>` : ""}
        <section class="section"><div class="section-head"><h2>Your friends</h2><span class="faint">${friends.length}</span></div>
          ${friends.length ? `<div class="people">${friends.map(card).join("")}</div>` : `<div class="panel empty">No friends yet. Find players on the right to add them.</div>`}</section>
      </div>
      <div>
        <section class="section"><div class="section-head"><h2>Find players</h2></div><div class="panel panel-pad">
          <form id="find" style="display:flex;gap:8px"><input class="input" id="find-input" placeholder="Username" aria-label="Username"><button class="btn btn-primary">Search</button></form>
          <div id="find-results" style="margin-top:8px"></div></div></section>
        ${outgoing.length ? `<section class="section"><div class="section-head"><h2>Sent requests</h2></div><div class="panel panel-pad">${outgoing.map((f) => row(f, `<button class="btn btn-sm" data-cancel="${f.id}">Cancel</button>`)).join("")}</div></section>` : ""}
      </div></div></div>`;
}
friendsPage.after = () => {
  const act = (sel, fn, args) => $$(sel).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await authed(fn, args(b)); route(); refreshFriendCount(); } catch (e) { toast(e.message); b.disabled = false; }
  }));
  act("[data-accept]", "gb_friend_respond", (b) => ({ p_user_id: Number(b.dataset.accept), p_accept: true }));
  act("[data-decline]", "gb_friend_respond", (b) => ({ p_user_id: Number(b.dataset.decline), p_accept: false }));
  act("[data-cancel]", "gb_friend_remove", (b) => ({ p_user_id: Number(b.dataset.cancel) }));
  const form = $("#find");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#find-results");
    try {
      const users = await authed("gb_search_users", { p_query: $("#find-input").value });
      out.innerHTML = users.length ? users.map((u) => `<div class="person-row">${avatarImg(u.avatar, "head")}
        <a class="grow" href="${userLink(u.username)}">${esc(u.username)}${u.verified ? VERIFIED("verified sm") : ""}</a>
        <div class="actions"><button class="btn btn-primary btn-sm" data-add="${esc(u.username)}">Add</button></div></div>`).join("") : `<div class="empty">Nobody found.</div>`;
      fillAvatars(out);
      $$("[data-add]", out).forEach((b) => (b.onclick = async () => {
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
  return `<div class="wrap"><div class="auth"><div class="panel" style="text-align:center"><h1>Log in</h1>
    <p class="muted">Log in to ${esc(what)}.</p><div style="display:flex;gap:10px;justify-content:center"><a class="btn btn-primary" href="#/login">Log in</a><a class="btn" href="#/signup">Sign up</a></div></div></div></div>`;
}

// ---- download

function downloadPage() {
  const onAndroid = /Android/i.test(navigator.userAgent);
  const windowsBtn = `<a class="btn ${onAndroid ? "btn-dark" : "btn-primary"} btn-lg" href="${DOWNLOAD_URL}" download>${icon("download")}Windows</a>`;
  const androidBtn = `<a class="btn ${onAndroid ? "btn-primary" : "btn-dark"} btn-lg" href="${ANDROID_URL}" download>${icon("download")}Android</a>`;
  return `<section class="dl-hero"><div class="dl-hero-inner">
      <div>
        <h1>Get Goblox</h1>
        <p>Play every game and chat with friends on your PC or Android phone. Dress up your avatar, and build your own games in Goblox Studio on PC.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">${onAndroid ? androidBtn + windowsBtn : windowsBtn + androidBtn}</div>
        <div class="dl-meta">Free · Windows 10 and 11 (1.7 MB) · Android 8 and newer (2.1 MB)</div>
      </div>
      <img class="app-icon" src="img/icon.png" alt="">
    </div></section>
    <div class="wrap">
      <section class="section"><div class="section-head"><h2>Install on Windows</h2></div><div class="cols-3">
        <div class="panel panel-pad"><div class="step-num">1</div><h3>Unzip</h3><p class="muted">Right-click <b>Goblox.zip</b>, choose <b>Extract All</b>, and open the folder.</p></div>
        <div class="panel panel-pad"><div class="step-num">2</div><h3>Open Goblox.exe</h3><p class="muted">If Windows says it protected your PC, click <b>More info</b>, then <b>Run anyway</b>. The app isn't signed yet.</p></div>
        <div class="panel panel-pad"><div class="step-num">3</div><h3>Log in and play</h3><p class="muted">Use the same account as this website. After that, <b>Play</b> buttons here open games right in the app.</p></div>
      </div></section>
      <section class="section"><div class="section-head"><h2>Install on Android</h2></div><div class="cols-3">
        <div class="panel panel-pad"><div class="step-num">1</div><h3>Download</h3><p class="muted">Tap <b>Android</b> above on your phone. Goblox.apk downloads like any other file.</p></div>
        <div class="panel panel-pad"><div class="step-num">2</div><h3>Open Goblox.apk</h3><p class="muted">Android asks if your browser may install apps: tap <b>Settings</b>, turn on <b>Allow from this source</b>, then go back and tap <b>Install</b>.</p></div>
        <div class="panel panel-pad"><div class="step-num">3</div><h3>Play</h3><p class="muted">Hold your phone sideways. Left thumb moves, right thumb looks around, the arrow jumps. Studio and voice chat are on PC for now.</p></div>
      </div></section>
      <section class="section"><div class="cols-2">
        <div class="panel panel-pad"><h2 style="margin-bottom:12px">Requirements</h2><table class="spec">
          <tr><td>Windows</td><td>Windows 10 or 11, 64-bit, OpenGL 3.3 (nearly any PC from the last ten years)</td></tr>
          <tr><td>Android</td><td>Android 8.0 or newer, 64-bit (nearly every phone from the last six years)</td></tr>
          <tr><td>Internet</td><td>Needed to log in and play online</td></tr>
          <tr><td>Microphone</td><td>Optional, for voice chat on PC. It unlocks once your account is a day old.</td></tr>
        </table></div>
        <div class="panel panel-pad"><h2 style="margin-bottom:12px">What's new</h2><ul class="changes">
          <li><b>Goblox for Android</b>: play on your phone with a thumbstick, a jump button and the on-screen keyboard for chat.</li>
          <li><a href="#/badges">Goblox Badges</a>: earn badges like 1K Club and Game Creator. They pop up in the app and show on your profile.</li>
          <li>New red G logo.</li>
          <li>Play buttons on this website open games in the app.</li>
          <li>Saving, leaderboards, badges and game passes for game makers.</li>
          <li>Friends: add people and join the game they're in.</li>
          <li>Element Battle: fight with Fire, Water, Earth, Lightning and Ice.</li>
          <li>Studio: every classic object in Insert Object.</li>
        </ul></div>
      </div></section>
    </div>`;
}

// ---- log in / sign up

function authPage(signup) {
  if (me) { location.hash = "#/"; return ""; }
  return `<div class="wrap"><div class="auth"><div class="panel">
    <h1>${signup ? "Create your account" : "Log in to Goblox"}</h1>
    <form id="auth-form">
      <label class="field"><span>Username</span><input id="u" autocomplete="username" maxlength="20" required></label>
      <label class="field"><span>Password</span><input id="p" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required></label>
      ${signup ? `<p class="hint">3 to 20 letters, numbers or _. Password at least 6 characters. You start with 100 Gbux.</p>` : ""}
      <div class="error" id="auth-error"></div>
      <button class="btn btn-primary btn-block btn-lg">${signup ? "Sign up" : "Log in"}</button>
    </form>
    <p class="switch">${signup ? `Have an account? <a href="#/login">Log in</a>` : `New to Goblox? <a href="#/signup">Create an account</a>`}</p>
  </div></div></div>`;
}
function bindAuthForm(signup) {
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
      toast(signup ? "Welcome to Goblox! You got 100 Gbux." : "Welcome back!");
      if (location.hash === "#/" || location.hash === "") route();
      else location.hash = "#/";
    } catch (err) {
      $("#auth-error").textContent = err.message;
      btn.disabled = false;
    }
  };
}
routes.login.after = () => bindAuthForm(false);
routes.signup.after = () => bindAuthForm(true);

// ------------------------------------------------------------------ start

window.addEventListener("hashchange", route);
(async () => {
  renderHeader();
  await refreshMe();
  route();
  refreshFriendCount();
  setInterval(refreshFriendCount, 60000);
})();

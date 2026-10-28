// 3D avatars for the website, built like the game draws them (src/character.cpp, src/avatar.cpp,
// src/renderer.cpp): R6 body parts, the rounded head with its face, shirts / pants on the 585x559
// template, T-shirts on the torso front, and the hats.
//
//   Avatar3D.thumbnail(avatar, "body" | "head" | "hat", size) -> Promise<image URL>  (cached)
//   Avatar3D.viewer(element, avatar) -> a live, drag-to-turn view; returns { play(name), onAnimation(fn), destroy() }
//   Avatar3D.animations() -> [{ id, name, loop }] for the viewer's play()
//
// Needs three.js (global THREE). Without WebGL, thumbnail() resolves to "" and the site falls back
// to its flat pictures.
"use strict";

const Avatar3D = (() => {
  const BODY_COLORS = [
    [245, 205, 48], [13, 105, 172], [164, 189, 71], [234, 184, 146], [204, 142, 105], [124, 92, 70],
    [196, 40, 28], [75, 151, 75], [27, 42, 53], [242, 243, 243], [163, 162, 165], [218, 133, 65],
    [107, 50, 124], [255, 102, 204], [18, 238, 212], [40, 127, 71],
  ];
  const PX = 64;  // texture pixels per stud

  // Where each face of the torso / left arm / right arm sits in the shirt template, in the
  // game's face order: front, back, right (-X), left (+X), top, bottom.
  const CLOTH_LAYOUT = [
    [[231, 74, 128, 128], [427, 74, 128, 128], [165, 74, 64, 128], [361, 74, 64, 128], [231, 8, 128, 64], [231, 204, 128, 64]],
    [[308, 355, 64, 128], [440, 355, 64, 128], [506, 355, 64, 128], [374, 355, 64, 128], [308, 289, 64, 64], [308, 485, 64, 64]],
    [[217, 355, 64, 128], [85, 355, 64, 128], [151, 355, 64, 128], [19, 355, 64, 128], [217, 289, 64, 64], [217, 485, 64, 64]],
  ];
  // three.js box material order (+X, -X, +Y, -Y, +Z, -Z) as game face numbers.
  const THREE_FACES = [3, 2, 4, 5, 0, 1];

  // Body parts: colour slot, centre, size, and which template area its clothes use.
  // Slots follow the avatar's colours: torso, head, left arm, right arm, left leg, right leg.
  // `pivot` is the joint (shoulder / hip) and `offset` the part's centre from it, as in the game.
  const PARTS = [
    { slot: 0, pivot: [0, 0, 0], offset: [0, 0, 0], size: [2, 2, 1], cloth: 0, shirt: true, pants: true, tshirt: true },
    { slot: 2, pivot: [1.5, 0.5, 0], offset: [0, -0.5, 0], size: [1, 2, 1], cloth: 1, shirt: true },
    { slot: 3, pivot: [-1.5, 0.5, 0], offset: [0, -0.5, 0], size: [1, 2, 1], cloth: 2, shirt: true },
    { slot: 4, pivot: [0.5, -1, 0], offset: [0, -1, 0], size: [1, 2, 1], cloth: 1, pants: true },
    { slot: 5, pivot: [-0.5, -1, 0], offset: [0, -1, 0], size: [1, 2, 1], cloth: 2, pants: true },
  ];

  let supported = null;
  function hasWebGL() {
    if (supported === null) {
      try {
        const c = document.createElement("canvas");
        supported = !!(window.THREE && (c.getContext("webgl") || c.getContext("experimental-webgl")));
      } catch (e) {
        supported = false;
      }
    }
    return supported;
  }

  // ------------------------------------------------------------------ images

  const imageCache = new Map();
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  // `assetUrl(id)` is supplied by the site (uploaded images are fetched from the server).
  let assetUrl = () => Promise.resolve("");
  function setAssetLoader(fn) { assetUrl = fn; }

  async function loadClothes(av) {
    const [face, shirt, pants, tshirt] = await Promise.all([
      loadImage("img/face.png"),
      assetUrl(av.shirt).then(loadImage),
      assetUrl(av.pants).then(loadImage),
      assetUrl(av.tshirt).then(loadImage),
    ]);
    return { face, shirt, pants, tshirt };
  }

  // ------------------------------------------------------------------ building the character

  function rgb(slot, colors) {
    const c = BODY_COLORS[colors[slot]] || BODY_COLORS[0];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // One face of a body part: body colour, pants then shirt from the template, T-shirt, and the
  // darker edges the game gives blocky parts.
  function faceTexture(color, w, h, part, face, img) {
    const cw = Math.round(w * PX), ch = Math.round(h * PX);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const g = canvas.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.fillStyle = color;
    g.fillRect(0, 0, cw, ch);
    const r = CLOTH_LAYOUT[part.cloth][face];
    // Templates are 585x559; scale the area if an image was uploaded at another size.
    const layer = (pic) => {
      const sx = pic.width / 585, sy = pic.height / 559;
      g.drawImage(pic, r[0] * sx, r[1] * sy, r[2] * sx, r[3] * sy, 0, 0, cw, ch);
    };
    if (part.pants && img.pants) layer(img.pants);  // pants go under the shirt
    if (part.shirt && img.shirt) layer(img.shirt);
    if (part.tshirt && face === 0 && img.tshirt) g.drawImage(img.tshirt, 0, 0, cw, ch);
    // Edges: 20% darker, fading out over 0.07 studs.
    const e = 0.07 * PX;
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, "rgba(0,0,0,0.2)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(rx, ry, rw, rh);
    };
    edge(0, 0, e, 0, 0, 0, e, ch);
    edge(cw, 0, cw - e, 0, cw - e, 0, e, ch);
    edge(0, 0, 0, e, 0, 0, cw, e);
    edge(0, ch, 0, ch - e, 0, ch - e, cw, e);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  function boxPart(part, colors, img) {
    const [w, h, d] = part.size;
    const color = rgb(part.slot, colors);
    const faceSize = { 0: [w, h], 1: [w, h], 2: [d, h], 3: [d, h], 4: [w, d], 5: [w, d] };
    const materials = THREE_FACES.map((f) => new THREE.MeshLambertMaterial({ map: faceTexture(color, faceSize[f][0], faceSize[f][1], part, f, img) }));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
    mesh.position.set(...part.offset);
    const joint = new THREE.Group();  // rotating the joint swings the part like the game's Motor6D
    joint.position.set(...part.pivot);
    joint.add(mesh);
    return joint;
  }

  // The game's head: a cylinder with rounded top and bottom edges (unit size, scaled later).
  let headGeometry = null;
  function headShape() {
    if (headGeometry) return headGeometry;
    const pts = [new THREE.Vector2(0, -0.5)];
    const R = 0.5, c = 0.16, arc = 6;
    for (let i = 0; i <= arc; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * i / arc;
      pts.push(new THREE.Vector2(R - c + c * Math.cos(a), -0.5 + c + c * Math.sin(a)));
    }
    for (let i = 0; i <= arc; i++) {
      const a = (Math.PI / 2) * i / arc;
      pts.push(new THREE.Vector2(R - c + c * Math.cos(a), 0.5 - c + c * Math.sin(a)));
    }
    pts.push(new THREE.Vector2(0, 0.5));
    headGeometry = new THREE.LatheGeometry(pts, 40);
    headGeometry.computeVertexNormals();
    return headGeometry;
  }

  // The face is projected straight onto the front of the head, like the game's shader does.
  function faceMesh(faceImg) {
    const r = 0.6 + 0.004, half = Math.asin(0.48 / 0.6);
    const geo = new THREE.CylinderGeometry(r, r, 0.84, 24, 1, true, -half, half * 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / 0.96, 0.5 + pos.getY(i) / 0.96);
    uv.needsUpdate = true;
    const tex = new THREE.Texture(faceImg);
    tex.needsUpdate = true;
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  function hatGroup(hat) {
    const group = new THREE.Group();
    const add = (p, s, color, opts = {}) => {
      const geo = opts.head ? headShape() : new THREE.BoxGeometry(1, 1, 1);
      const mat = opts.neon ? new THREE.MeshBasicMaterial({ color: brighten(color) }) : new THREE.MeshLambertMaterial({ color: css(color) });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p[0] * 1.2, p[1] * 1.2, p[2] * 1.2);  // hat offsets are in head units (head is 1.2)
      m.scale.set(s[0] * 1.2, s[1] * 1.2, s[2] * 1.2);
      group.add(m);
    };
    const black = [27, 27, 30], orange = [255, 120, 20], white = [242, 243, 243], gold = [255, 200, 40];
    if (hat === "tophat") {
      add([0, 0.62, 0], [1.6, 0.1, 1.6], black, { head: true });
      add([0, 1.1, 0], [1.0, 0.9, 1.0], black, { head: true });
      add([0, 0.78, 0], [1.04, 0.16, 1.04], [196, 40, 28], { head: true });
    } else if (hat === "cone") {
      add([0, 0.65, 0], [1.3, 0.1, 1.3], orange);
      add([0, 0.9, 0], [0.9, 0.4, 0.9], orange);
      add([0, 1.22, 0], [0.66, 0.25, 0.66], white);
      add([0, 1.47, 0], [0.44, 0.25, 0.44], orange);
      add([0, 1.66, 0], [0.22, 0.14, 0.22], orange);
    } else if (hat === "headphones") {
      add([0, 0.72, 0], [1.36, 0.14, 0.3], black);
      add([0.64, 0.38, 0], [0.1, 0.6, 0.3], black);
      add([-0.64, 0.38, 0], [0.1, 0.6, 0.3], black);
      add([0.68, 0, 0], [0.26, 0.55, 0.55], [60, 60, 66]);
      add([-0.68, 0, 0], [0.26, 0.55, 0.55], [60, 60, 66]);
      add([0.82, 0, 0], [0.04, 0.3, 0.3], [255, 40, 60], { neon: true });
      add([-0.82, 0, 0], [0.04, 0.3, 0.3], [255, 40, 60], { neon: true });
    } else if (hat === "crown") {
      add([0, 0.75, 0.55], [1.2, 0.3, 0.1], gold);
      add([0, 0.75, -0.55], [1.2, 0.3, 0.1], gold);
      add([0.55, 0.75, 0], [0.1, 0.3, 1.2], gold);
      add([-0.55, 0.75, 0], [0.1, 0.3, 1.2], gold);
      for (const x of [-1, 1]) for (const z of [-1, 1]) add([x * 0.55, 0.98, z * 0.55], [0.16, 0.2, 0.16], gold);
      add([0, 0.98, 0.55], [0.16, 0.2, 0.12], gold);
      add([0, 0.78, 0.62], [0.2, 0.18, 0.05], [255, 30, 60], { neon: true });
    } else if (hat === "halo") {
      const glow = [255, 235, 120];
      add([0, 1.15, 0.45], [1.0, 0.08, 0.1], glow, { neon: true });
      add([0, 1.15, -0.45], [1.0, 0.08, 0.1], glow, { neon: true });
      add([0.45, 1.15, 0], [0.1, 0.08, 1.0], glow, { neon: true });
      add([-0.45, 1.15, 0], [0.1, 0.08, 1.0], glow, { neon: true });
    }
    return group;
  }
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const brighten = (c) => css(c.map((v) => Math.min(255, Math.round(v * 1.3))));

  // The whole character, torso centre at the origin, facing +Z. `only` = "hat" leaves out the body.
  function buildCharacter(av, img, only) {
    const colors = Array.isArray(av.colors) && av.colors.length === 6 ? av.colors : [1, 0, 0, 0, 2, 2];
    const root = new THREE.Group();
    const head = new THREE.Group();
    head.position.set(0, 1.5, 0);
    if (only !== "hat") {
      for (const part of PARTS) root.add(boxPart(part, colors, img));
      const skull = new THREE.Mesh(headShape(), new THREE.MeshLambertMaterial({ color: rgb(1, colors) }));
      skull.scale.set(1.2, 1.2, 1.2);
      head.add(skull);
      if (img.face) head.add(faceMesh(img.face));
    }
    head.add(hatGroup(av.hat));
    root.add(head);
    return root;
  }

  function lights(scene) {
    scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x7a736b, 0.72));
    const sun = new THREE.DirectionalLight(0xfff6e6, 0.62);
    sun.position.set(-3, 6, 8);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xc8d8ff, 0.22);
    rim.position.set(5, 2, -6);
    scene.add(rim);
  }

  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry && o.geometry !== headGeometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }

  // Points the camera so the picture fits: the whole body, the head (with a bit of shoulder), or the hat.
  function frame(camera, kind, character) {
    character.updateMatrixWorld(true);
    const head = character.children[character.children.length - 1];
    const box = new THREE.Box3().setFromObject(kind === "body" ? character : head);
    if (kind === "head") box.min.y = Math.min(box.min.y, 0.55);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (kind === "head") center.x = 0;
    camera.fov = kind === "body" ? 30 : 24;
    const half = Math.max(size.y / 2, size.x / 2 / camera.aspect, kind === "hat" ? 0.6 : 0);
    const dist = half / Math.tan((camera.fov * Math.PI) / 360) * (kind === "head" ? 1.12 : 1.1) + size.z / 2;
    const dir = new THREE.Vector3(-0.2, kind === "hat" ? 0.45 : 0.14, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ thumbnails

  let shared = null;  // one off-screen renderer for every thumbnail
  let queue = Promise.resolve();
  const thumbs = new Map();

  function normal(av) {
    av = av || {};
    return {
      colors: Array.isArray(av.colors) && av.colors.length === 6 ? av.colors.map(Number) : [1, 0, 0, 0, 2, 2],
      hat: av.hat || "none", shirt: Number(av.shirt) || 0, tshirt: Number(av.tshirt) || 0, pants: Number(av.pants) || 0,
    };
  }

  function thumbnail(avatar, kind = "body", size = 300) {
    if (!hasWebGL()) return Promise.resolve("");
    const av = normal(avatar);
    const key = `${kind}:${size}:${JSON.stringify(av)}`;
    if (thumbs.has(key)) return thumbs.get(key);
    const job = queue.then(async () => {
      try {
        const img = await loadClothes(av);
        if (!shared) {
          shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
          shared.setClearColor(0x000000, 0);
        }
        shared.setPixelRatio(1);
        shared.setSize(size, size, false);
        const scene = new THREE.Scene();
        lights(scene);
        const character = buildCharacter(av, img, kind === "hat" ? "hat" : null);
        character.rotation.y = kind === "hat" ? 0.35 : 0.3;
        scene.add(character);
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
        frame(camera, kind, character);
        shared.render(scene, camera);
        const url = shared.domElement.toDataURL("image/png");
        dispose(character);
        return url;
      } catch (e) {
        return "";
      }
    });
    queue = job;
    thumbs.set(key, job);
    return job;
  }

  // ------------------------------------------------------------------ animations (live viewer)

  // Each animation turns time t (seconds since it started) into a pose: joint angles in radians
  // for the arms, legs and head as [x, y, z], plus `y` (lift) and `turn` for the whole body.
  // The character faces +Z, so a negative x swings a limb forward; z swings arms out sideways
  // (positive for the left arm, negative for the right).
  const S = Math.sin, PI = Math.PI;
  const ANIMATIONS = {
    idle: { name: "Idle", loop: true, pose: (t) => {
      const s = S(t * 1.5) * 0.05;
      return { la: [s, 0, 0.02], ra: [-s, 0, -0.02], head: [S(t * 0.7) * 0.03, S(t * 0.4) * 0.08, 0] };
    } },
    walk: { name: "Walk", loop: true, pose: (t) => {
      const s = S(t * 6) * 0.7;
      return { la: [s, 0, 0], ra: [-s, 0, 0], ll: [-s, 0, 0], rl: [s, 0, 0], y: Math.abs(S(t * 6)) * 0.08 };
    } },
    run: { name: "Run", loop: true, pose: (t) => {
      const s = S(t * 10) * 1.1;
      return { la: [s, 0, 0.05], ra: [-s, 0, -0.05], ll: [-s * 0.9, 0, 0], rl: [s * 0.9, 0, 0],
        y: Math.abs(S(t * 10)) * 0.2, head: [0.1, 0, 0] };
    } },
    jump: { name: "Jump", length: 1.1, pose: (t) => {
      const air = t > 0.25 && t < 0.95 ? S((t - 0.25) / 0.7 * PI) : 0;  // 0 on the ground, 1 at the top
      const crouch = t < 0.25 ? S(t / 0.25 * PI) : t > 0.95 ? S((t - 0.95) / 0.15 * PI) : 0;
      return { la: [0, 0, PI * 0.75 * air], ra: [0, 0, -PI * 0.75 * air],
        ll: [-0.3 * air + 0.5 * crouch, 0, 0], rl: [0.2 * air + 0.5 * crouch, 0, 0],
        y: air * 0.6 - crouch * 0.15 };
    } },
    climb: { name: "Climb", loop: true, pose: (t) => {
      const s = S(t * 5);
      return { la: [-PI * 0.8 + s * 0.4, 0, 0], ra: [-PI * 0.8 - s * 0.4, 0, 0],
        ll: [-0.6 - s * 0.5, 0, 0], rl: [-0.6 + s * 0.5, 0, 0], y: s * 0.1 };
    } },
    sit: { name: "Sit", loop: true, pose: (t) => (
      { la: [-0.5, 0, 0.05], ra: [-0.5, 0, -0.05], ll: [-PI / 2, 0, 0.05], rl: [-PI / 2, 0, -0.05],
        y: -1, head: [S(t * 0.8) * 0.04, 0, 0] }) },
    wave: { name: "Wave", length: 2.4, pose: (t) => (
      { ra: [0, 0, -PI * 0.85 + S(t * 9) * 0.3], la: [0, 0, 0.05], head: [0, 0, S(t * 9) * 0.05] }) },
    point: { name: "Point", length: 2, pose: () => ({ ra: [-PI / 2, 0, -0.1], head: [0, -0.15, 0] }) },
    cheer: { name: "Cheer", length: 2, pose: (t) => {
      const b = Math.abs(S(t * 8));
      return { la: [0, 0, PI * 0.9 - b * 0.2], ra: [0, 0, -PI * 0.9 + b * 0.2], y: b * 0.2, head: [-0.2, 0, 0] };
    } },
    laugh: { name: "Laugh", length: 2, pose: (t) => {
      const b = S(t * 18) * 0.12;
      return { la: [-0.4, 0, 0.3], ra: [-0.4, 0, -0.3], head: [-0.3 + b, 0, 0], y: b * 0.4 };
    } },
    dance: { name: "Dance", loop: true, pose: (t) => {
      const s = S(t * 5);
      return { la: [0, 0, 1.2 + s * 0.8], ra: [0, 0, -1.2 + s * 0.8], ll: [0, 0, 0.15 + s * 0.15], rl: [0, 0, -0.15 + s * 0.15],
        head: [0, 0, s * 0.2], turn: s * 0.3, y: Math.abs(s) * 0.15 };
    } },
    dance2: { name: "Dance 2", loop: true, pose: (t) => {
      const s = S(t * 7), c = Math.cos(t * 7);
      return { la: [-PI / 2 + c * 0.6, 0, 0.3], ra: [-PI / 2 - c * 0.6, 0, -0.3], ll: [s * 0.5, 0, 0], rl: [-s * 0.5, 0, 0],
        head: [s * 0.15, 0, 0], y: Math.abs(s) * 0.25 };
    } },
    dance3: { name: "Dance 3", loop: true, pose: (t) => {
      const s = S(t * 4);
      return { la: [0, 0, PI * 0.9], ra: [0, 0, -PI * 0.9 + Math.abs(s) * 0.4], ll: [-Math.max(0, s) * 1.2, 0, 0],
        rl: [Math.min(0, s) * 1.2, 0, 0], turn: t * 3, y: Math.abs(s) * 0.2 };
    } },
  };
  const JOINTS = ["la", "ra", "ll", "rl"];  // character.children 1..4, in PARTS order

  function samplePose(name, t) {
    const a = ANIMATIONS[name];
    const p = a.pose(t);
    const out = { y: p.y || 0, turn: p.turn || 0, head: p.head || [0, 0, 0] };
    for (const j of JOINTS) out[j] = p[j] || [0, 0, 0];
    return out;
  }
  function mixPose(a, b, k) {
    const lerp = (x, y) => x + (y - x) * k;
    const out = { y: lerp(a.y, b.y), turn: lerp(a.turn, b.turn), head: a.head.map((v, i) => lerp(v, b.head[i])) };
    for (const j of JOINTS) out[j] = a[j].map((v, i) => lerp(v, b[j][i]));
    return out;
  }
  function applyPose(character, p, yaw) {
    JOINTS.forEach((j, i) => character.children[i + 1].rotation.set(...p[j]));
    character.children[5].rotation.set(...p.head);
    character.position.y = p.y;
    character.rotation.y = yaw + p.turn;
  }

  // ------------------------------------------------------------------ live viewer (profile page)

  function viewer(el, avatar) {
    if (!hasWebGL()) return { destroy() {} };
    const av = normal(avatar);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    lights(scene);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    // Soft round shadow under the feet.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 64;
    const sg = shadowCanvas.getContext("2d");
    const grad = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -3.01;
    scene.add(shadow);

    let character = null, yaw = 0.3, spin = 0, dragging = false, lastX = 0, alive = true, idle = 0;
    let anim = "idle", animTime = 0, from = null, blend = 1, current = null, onChange = null;
    const play = (name) => {
      if (!ANIMATIONS[name]) return;
      from = current;
      blend = 0;
      anim = name;
      animTime = 0;
      if (onChange) onChange(name);
    };
    loadClothes(av).then((img) => {
      if (!alive) return;
      character = buildCharacter(av, img);
      scene.add(character);
      resize();
    });

    const resize = () => {
      const w = el.clientWidth || 300, h = el.clientHeight || 300;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      if (character) {  // frame the character facing forward, so turning it doesn't move the camera
        const turn = character.rotation.y;
        character.rotation.y = 0;
        frame(camera, "body", character);
        camera.zoom = 0.8;  // room for arms raised overhead and jumps
        character.rotation.y = turn;
      }
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(el);

    const down = (e) => { dragging = true; lastX = e.clientX; idle = 0; el.setPointerCapture && el.setPointerCapture(e.pointerId); };
    const move = (e) => {
      if (!dragging) return;
      spin = (e.clientX - lastX) * 0.012;
      yaw += spin;
      lastX = e.clientX;
    };
    const up = () => { dragging = false; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.style.touchAction = "pan-y";
    el.style.cursor = "grab";

    let last = performance.now();
    const loop = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!dragging) {
        spin *= Math.pow(0.04, dt);  // a flick keeps turning a little, then settles
        yaw += spin;
        idle += dt;
        if (idle > 3) yaw += dt * 0.35;  // slow turn when left alone
      }
      if (character) {
        animTime += dt;
        const a = ANIMATIONS[anim];
        if (!a.loop && animTime > a.length) play("idle");  // one-shot emotes go back to standing
        let pose = samplePose(anim, animTime);
        if (from) {  // ease out of the last pose over a fifth of a second
          blend = Math.min(1, blend + dt * 5);
          pose = mixPose(from, pose, blend);
          if (blend >= 1) from = null;
        }
        current = pose;
        applyPose(character, pose, yaw);
      }
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return {
      play,
      // fn(name) runs whenever the animation changes, including the return to idle.
      onAnimation(fn) { onChange = fn; },
      destroy() {
        alive = false;
        if (ro) ro.disconnect();
        if (character) dispose(character);
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
  }

  const animations = () => Object.entries(ANIMATIONS).map(([id, a]) => ({ id, name: a.name, loop: !!a.loop }));
  return { thumbnail, viewer, setAssetLoader, hasWebGL, animations };
})();
window.Avatar3D = Avatar3D;  // app.js checks window.Avatar3D (a top-level const isn't on window)

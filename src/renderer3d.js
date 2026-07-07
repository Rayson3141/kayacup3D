// renderer3d.js — a 2.5D third-person view built on Three.js.
//
// The simulation stays 2D; only the rendering is 3D. Notable behaviors:
//   - Every fighter carries a billboarded HP bar above their head, so the
//     whole field's health is readable at a glance.
//   - Kaya renders as the actual cat photo on a large sprite hovering above
//     everyone — visibly dominant. Butter stays a modest emoji billboard.
//   - Play-mode camera is at fighter eye level, slightly behind the player,
//     and follows a low-pass-filtered anchor rather than the raw position —
//     the Brownian jitter shakes the fighter, not the camera.

import * as THREE from "three";
import { LOW_HP, MAX_HP, MODE } from "./config.js";

const S = 10;          // arena radius in world units (disk radius 1 -> S)
const BODY_R = 0.42;
const BODY_LEN = 0.85;
const HEAD_Y = BODY_LEN + BODY_R * 2;   // top of a capsule fighter (~1.69)

export class Renderer3D {
  constructor(container) {
    this.container = container;
    this.meshes = new Map();   // contestant id -> { group, body, mat, label, bar }
    this.npcSprites = new Map();
    this.floaterPool = [];
    this.ripplePool = [];
    this.textureCache = new Map();
    this.yaw = 0;              // legacy: used by main's world/camera mapping
    this.orbitYaw = 0;         // user-controlled camera orbit angle (arrows ← →)
    this.orbitPitch = 0.32;    // user-controlled camera tilt (arrows ↑ ↓), radians
    this.ready = false;
    this._initScene();
  }

  // Camera forward / right unit vectors projected onto the arena floor, in
  // engine coordinates (x, y) where world z = engine y. Derived analytically
  // from the orbit azimuth. Used for camera-relative WASD and the minimap cone.
  //   forward = ( sin θ,  cos θ )   (the "into the screen" direction)
  //   right   = (-cos θ,  sin θ )   (screen-right)
  groundBasis() {
    const y = this.orbitYaw;
    return {
      fwd:   { x: Math.sin(y), y: Math.cos(y) },
      right: { x: -Math.cos(y), y: Math.sin(y) },
    };
  }

  // Horizontal half-FOV (radians) for the minimap viewing cone.
  halfFovH() {
    const fovV = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    return Math.atan(Math.tan(fovV / 2) * aspect);
  }

  // Integrate arrow-key camera intent (rates in [-1,1]) over dtFrames (~1 per
  // 60fps frame). Called by main each frame while playing.
  orbit(yawInput, pitchInput, dtFrames = 1) {
    const YAW_RATE = 0.045, PITCH_RATE = 0.03;
    this.orbitYaw += (yawInput || 0) * YAW_RATE * dtFrames;
    this.orbitPitch += (pitchInput || 0) * PITCH_RATE * dtFrames;
    // Keep tilt between near-eye-level and near-overhead.
    if (this.orbitPitch < 0.06) this.orbitPitch = 0.06;
    if (this.orbitPitch > 1.35) this.orbitPitch = 1.35;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0d14");
    scene.fog = new THREE.Fog("#0a0d14", S * 1.6, S * 3.6);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(0, S * 1.1, S * 1.3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    scene.add(new THREE.HemisphereLight("#cfe8ff", "#10131a", 0.9));
    const dir = new THREE.DirectionalLight("#ffffff", 1.0);
    dir.position.set(S, S * 1.5, S * 0.6);
    scene.add(dir);

    // Arena floor.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(S, 96),
      new THREE.MeshStandardMaterial({ color: "#11161f", roughness: 0.95, metalness: 0.0 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Boundary ring.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(S * 0.985, S, 96),
      new THREE.MeshBasicMaterial({ color: "#00d4ff", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
    this.recoveryRing = new THREE.Mesh(
      new THREE.RingGeometry(S * 0.84, S * 0.85, 96),
      new THREE.MeshBasicMaterial({ color: "#00ff88", transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.recoveryRing.rotation.x = -Math.PI / 2;
    this.recoveryRing.position.y = 0.02;
    scene.add(this.recoveryRing);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.ready = true;
    this._resize();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this._resize()).observe(this.container);
    }
    window.addEventListener("resize", () => this._resize());
  }

  show(on) {
    this.renderer.domElement.style.display = on ? "block" : "none";
    if (on) this._resize();
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height || rect.width);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _texture(text, color) {
    const key = `${text}|${color}`;
    if (this.textureCache.has(key)) return this.textureCache.get(key);
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const g = c.getContext("2d");
    g.font = "bold 64px ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(text, 128, 64);
    g.fillStyle = color;
    g.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    this.textureCache.set(key, tex);
    return tex;
  }

  _nameSprite(name, color) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.font = "bold 30px ui-monospace, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(name, 128, 32);
    g.fillStyle = color; g.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(4, 1, 1);
    return spr;
  }

  // A billboarded HP bar: dark backing plane + colored fill plane whose x
  // scale tracks HP. No texture churn — just cheap transforms.
  _makeHpBar() {
    const group = new THREE.Group();
    const W = 1.5, H = 0.16;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: "#1a202c", transparent: true, opacity: 0.9 })
    );
    const fg = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: "#00e07f" })
    );
    fg.position.z = 0.005;
    group.add(bg); group.add(fg);
    group.userData = { W, fg };
    return group;
  }

  _setHpBar(bar, hp) {
    const frac = Math.max(0.001, Math.min(1, hp / MAX_HP));
    const { W, fg } = bar.userData;
    fg.scale.x = frac;
    fg.position.x = -(1 - frac) * W / 2;
    fg.material.color.copy(this._hpColor(hp));
    bar.visible = hp > 0;
  }

  // (Re)build all meshes for a fresh tournament.
  build(sim) {
    for (const { group } of this.meshes.values()) this.scene.remove(group);
    this.meshes.clear();
    for (const spr of this.npcSprites.values()) this.scene.remove(spr);
    this.npcSprites.clear();

    for (const c of sim.contestants) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: "#00d4ff", roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_R, BODY_LEN, 6, 12), mat);
      body.position.y = BODY_R + BODY_LEN / 2;
      group.add(body);
      if (c.controlled) {
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(BODY_R * 1.6, BODY_R * 2.0, 32),
          new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, side: THREE.DoubleSide })
        );
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.04;
        group.add(halo);
      }
      const bar = this._makeHpBar();
      bar.position.y = HEAD_Y + 0.45;
      group.add(bar);
      const label = this._nameSprite(c.controlled ? `${c.name} (you)` : c.name, "#ffffff");
      label.position.y = HEAD_Y + 1.05;
      group.add(label);
      this.scene.add(group);
      this.meshes.set(c.id, { group, body, mat, label, bar });
    }

    for (const npc of sim.npcs) {
      let material;
      if (npc.image) {
        // The real Kaya, loaded from the repo's assets.
        const tex = new THREE.TextureLoader().load(npc.image);
        tex.colorSpace = THREE.SRGBColorSpace;
        material = new THREE.SpriteMaterial({ map: tex, transparent: true });
      } else {
        material = new THREE.SpriteMaterial({ map: this._emojiTexture(npc.emoji), transparent: true });
      }
      const spr = new THREE.Sprite(material);
      // Kaya looms — much larger than a fighter, hovering above the field.
      if (npc.type === "demon") spr.scale.set(4.2, 4.2, 1);
      else spr.scale.set(2, 2, 1);
      this.scene.add(spr);
      this.npcSprites.set(npc.id, spr);
    }
  }

  _emojiTexture(emoji) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    g.font = "96px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, 64, 72);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  _hpColor(hp) {
    if (hp <= 0) return new THREE.Color("#3a3f4b");
    if (hp <= LOW_HP) return new THREE.Color("#ff4560");
    if (hp <= 60) return new THREE.Color("#ffb020");
    return new THREE.Color("#00e07f");
  }

  render(sim, fx, opts = {}) {
    if (!this.ready) return;
    if (this.meshes.size !== sim.contestants.length) this.build(sim);

    // Sync fighters.
    let leader = null;
    for (const c of sim.contestants) if (c.hp > 0 && (!leader || c.hp > leader.hp)) leader = c;

    for (const c of sim.contestants) {
      const m = this.meshes.get(c.id);
      if (!m) continue;
      m.group.position.set(c.x * S, 0, c.y * S);
      m.mat.color.copy(this._hpColor(c.hp));
      const dead = c.hp <= 0;
      m.body.scale.setScalar(dead ? 0.5 : 1);
      m.body.material.opacity = dead ? 0.5 : 1;
      m.body.material.transparent = dead;
      m.label.visible = !dead;
      this._setHpBar(m.bar, c.hp);
      m.bar.quaternion.copy(this.camera.quaternion); // billboard the bar
      m.mat.emissive = c === leader ? new THREE.Color("#332a00") : new THREE.Color("#000000");
    }

    // Sync NPCs. Kaya hovers well above head height, asserting dominance;
    // Butter floats politely near the ground.
    for (const npc of sim.npcs) {
      const spr = this.npcSprites.get(npc.id);
      if (!spr) continue;
      const bob = Math.sin(Date.now() / 300);
      if (npc.type === "demon") {
        spr.position.set(npc.x * S, HEAD_Y + 2.2 + 0.3 * bob, npc.y * S);
      } else {
        spr.position.set(npc.x * S, 1.4 + 0.15 * bob, npc.y * S);
      }
    }

    this._syncFloaters(fx);
    this._syncRipples(fx, sim);
    this._updateCamera(sim, fx, opts);

    this.recoveryRing.material.opacity = 0.3 + 0.2 * Math.abs(Math.sin(Date.now() / 600));
    this.renderer.render(this.scene, this.camera);
  }

  _syncFloaters(fx) {
    for (let i = 0; i < fx.floaters.length; i++) {
      const f = fx.floaters[i];
      let spr = this.floaterPool[i];
      if (!spr) {
        spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
        spr.scale.set(1.6, 0.8, 1);
        this.scene.add(spr);
        this.floaterPool[i] = spr;
      }
      spr.material.map = this._texture(f.text, f.color);
      spr.material.opacity = Math.max(0, f.life);
      spr.position.set(f.x * S, HEAD_Y + 1.6 + (1 - f.life) * 1.5, f.y * S);
      spr.visible = true;
    }
    for (let i = fx.floaters.length; i < this.floaterPool.length; i++) this.floaterPool[i].visible = false;
  }

  _syncRipples(fx, sim) {
    for (let i = 0; i < fx.ripples.length; i++) {
      const r = fx.ripples[i];
      let mesh = this.ripplePool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.85, 1.0, 32),
          new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
        );
        mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);
        this.ripplePool[i] = mesh;
      }
      const rad = r.radius * S;
      mesh.scale.setScalar(Math.max(0.01, rad));
      mesh.position.set(r.x * S, 0.05, r.y * S);
      mesh.material.color.set(r.color);
      mesh.material.opacity = r.alpha;
      mesh.visible = true;
    }
    for (let i = fx.ripples.length; i < this.ripplePool.length; i++) this.ripplePool[i].visible = false;
  }

  _updateCamera(sim, fx, opts) {
    const player = sim.player;
    let target = null;
    if (opts.mode === MODE.PLAY && player && player.hp > 0) target = player;
    else {
      for (const c of sim.contestants) if (c.hp > 0 && (!target || c.hp > target.hp)) target = c;
    }
    if (!target) target = sim.contestants[0];

    const raw = new THREE.Vector3(target.x * S, 0, target.y * S);

    if (opts.mode === MODE.PLAY && player && player.hp > 0) {
      // Third-person boom camera orbiting the fighter. Position (orbit angle +
      // tilt) is driven by the arrow keys via orbit(); it does NOT auto-follow
      // movement, so WASD and the camera are independent. The camera tracks a
      // heavily low-pass-filtered anchor, not the raw position, so Brownian
      // jitter shakes the fighter inside the frame, not the frame itself.
      if (!this._anchor) this._anchor = raw.clone();
      this._anchor.lerp(raw, 0.05);

      // Spherical boom: yaw orbits, pitch raises the camera from eye level
      // toward overhead. this.yaw mirrors orbitYaw so any code consulting it
      // stays consistent.
      this.yaw = this.orbitYaw;
      const boom = 5.0;
      const horiz = boom * Math.cos(this.orbitPitch);
      const eye = 1.0 + boom * Math.sin(this.orbitPitch); // eye level → up high
      const fwdX = Math.sin(this.orbitYaw), fwdZ = Math.cos(this.orbitYaw);
      const desired = new THREE.Vector3(
        this._anchor.x - fwdX * horiz,
        eye,
        this._anchor.z - fwdZ * horiz,
      );
      this.camera.position.lerp(desired, 0.15);
      const look = new THREE.Vector3(this._anchor.x, 1.1, this._anchor.z);
      this._lookAt = this._lookAt || look.clone();
      this._lookAt.lerp(look, 0.15);
      this.camera.lookAt(this._lookAt);
    } else {
      // Broadcast view: elevated, gently tracking the leader.
      this._anchor = null;
      const desired = new THREE.Vector3(0, S * 1.25, S * 1.45);
      this.camera.position.lerp(desired, 0.05);
      this._look = this._look || new THREE.Vector3(0, 0, 0);
      this._look.lerp(new THREE.Vector3(raw.x, 1, raw.z), 0.06);
      this.camera.lookAt(this._look);
    }

    if (fx.shake > 0) {
      const m = fx.shake * 0.03;
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
    }
  }
}

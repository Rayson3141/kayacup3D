// renderer2d.js — the top-down arena view.
//
// Resolution fix: the canvas buffer now always matches the element's actual
// on-screen rectangle (times devicePixelRatio) instead of being a fixed
// square scaled by CSS — that was what made the old view look stretched and
// blurry. The disk is drawn centered using the smaller dimension, so any
// container shape renders crisp and undistorted.
//
// Every fighter gets a small HP bar above their dot so the whole field's
// health is readable at a glance. Kaya renders as the real cat photo.

import { LOW_HP, MAX_HP } from "./config.js";

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.images = new Map(); // src -> HTMLImageElement (may not be loaded yet)
    this._resize();
    // ResizeObserver keeps the buffer in sync with layout changes, not just
    // window resizes (e.g. the sidebar collapsing).
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this._resize()).observe(canvas);
    }
    window.addEventListener("resize", () => this._resize());
  }

  show(on) {
    this.canvas.style.display = on ? "block" : "none";
    if (on) this._resize();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.dpr = dpr;
    this.cssW = rect.width;
    this.cssH = rect.height;
  }

  _image(src) {
    if (!src) return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  hpColor(hp) {
    if (hp <= 0) return "#3a3f4b";
    if (hp <= LOW_HP) return "#ff4560";
    if (hp <= 60) return "#ffb020";
    return "#00e07f";
  }

  _hpBar(ctx, x, y, hp, w = 24, h = 4) {
    const frac = Math.max(0, Math.min(1, hp / MAX_HP));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#2a3140";
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = this.hpColor(hp);
    ctx.fillRect(x - w / 2, y, w * frac, h);
  }

  render(sim, fx, opts = {}) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.cssW, H = this.cssH;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (fx.shake > 0) {
      const m = fx.shake * 0.18;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.45;
    const toX = (x) => cx + x * R;
    const toY = (y) => cy + y * R;

    // Recovery band glow near the rim.
    const band = R * (1 - sim.params.rPrime);
    const pulse = 0.06 + 0.04 * Math.sin(Date.now() / 350);
    const g = ctx.createRadialGradient(cx, cy, band, cx, cy, R);
    g.addColorStop(0, "rgba(0,255,136,0)");
    g.addColorStop(1, `rgba(0,255,136,${pulse})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Arena boundary + recovery ring.
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 3; ctx.strokeStyle = "#00d4ff";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#00ff88"; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(cx, cy, band, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Ripples.
    for (const r of fx.ripples) {
      ctx.globalAlpha = r.alpha;
      ctx.lineWidth = 2; ctx.strokeStyle = r.color;
      ctx.beginPath(); ctx.arc(toX(r.x), toY(r.y), r.radius * R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Leader (highest living HP).
    let leader = null;
    for (const c of sim.contestants) if (c.hp > 0 && (!leader || c.hp > leader.hp)) leader = c;

    // Fighters.
    for (const c of sim.contestants) {
      const x = toX(c.x), y = toY(c.y);
      const isPlayer = c.controlled;
      if (c.hp > 0 && c.hp <= LOW_HP) {
        const rp = 9 + 5 * Math.sin(Date.now() / 120);
        ctx.fillStyle = "rgba(255,69,96,0.22)";
        ctx.beginPath(); ctx.arc(x, y, rp, 0, Math.PI * 2); ctx.fill();
      }
      if (c === leader) {
        ctx.strokeStyle = "#ffd700"; ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8; ctx.shadowColor = "#ffd700";
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (isPlayer && c.hp > 0) {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, isPlayer ? 8 : 7, 0, Math.PI * 2);
      ctx.fillStyle = this.hpColor(c.hp); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = isPlayer ? "#ffffff" : "rgba(255,255,255,0.5)"; ctx.stroke();

      // Strategy indicator (small cyan dot) for AI fighters with a brain.
      if (c.hasStrategy && c.hp > 0) {
        ctx.beginPath(); ctx.arc(x - 9, y - 9, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#00d4ff"; ctx.fill();
      }

      // HP bar above everyone still standing.
      if (c.hp > 0) this._hpBar(ctx, x, y - 20, c.hp);

      ctx.fillStyle = c.hp > 0 ? "#fff" : "#555";
      ctx.font = `${isPlayer ? "bold " : ""}11px ui-monospace, monospace`;
      ctx.fillText(isPlayer ? `${c.name} (you)` : c.name, x + 11, y + 4);
      if (c === leader && c.hp > 0) ctx.fillText("👑", x - 24, y + 4);
    }

    // NPCs — Kaya as the actual cat photo (normal size in 2D), Butter emoji.
    for (const npc of sim.npcs) {
      const x = toX(npc.x), y = toY(npc.y);
      const img = this._image(npc.image);
      if (img) {
        const s = 34;
        ctx.save();
        ctx.shadowBlur = 10; ctx.shadowColor = "rgba(255,170,102,0.7)";
        ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
        ctx.restore();
      } else {
        ctx.font = "26px sans-serif";
        ctx.fillText(npc.emoji, x - 13, y + 9);
      }
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.fillStyle = npc.color;
      ctx.fillText(npc.name, x - 12, y - 20);
    }

    // Floating damage / heal numbers.
    for (const f of fx.floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillText(f.text, toX(f.x) - 8, toY(f.y) - 12);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}

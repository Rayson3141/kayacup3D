// input.js — player movement (WASD / joystick) + camera control (arrow keys).
//
// Controls, as requested:
//   W A S D            move the fighter up / left / down / right (world-absolute
//                      drift — the same fixed screen directions regardless of
//                      where the camera is pointing)
//   ← →  (arrows)      orbit the 3D camera left / right around the fighter
//   ↑ ↓  (arrows)      tilt the 3D camera up / down
//
// Movement is reported as fwd/strafe in [-1, 1]; camera intent as camYaw/camPitch
// in [-1, 1] (rate inputs the renderer integrates over time). Arrows no longer
// move the fighter, and WASD no longer touches the camera.

export class Input {
  constructor() {
    this.fwd = 0;      // +1 = up (world -y), -1 = down
    this.strafe = 0;   // +1 = right (world +x), -1 = left
    this.camYaw = 0;   // +1 = orbit right, -1 = orbit left
    this.camPitch = 0; // +1 = tilt up,     -1 = tilt down
    this.enabled = false;
    this.keys = new Set();
    this._bindKeyboard();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.keys.clear(); this._fromKeys(); }
  }

  _bindKeyboard() {
    const handled = ["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (handled.includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this._fromKeys();
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      this._fromKeys();
    });
    window.addEventListener("blur", () => { this.keys.clear(); this._fromKeys(); });
  }

  _fromKeys() {
    const k = this.keys;

    // --- movement: WASD only ---
    let f = 0, s = 0;
    if (k.has("KeyW")) f += 1;
    if (k.has("KeyS")) f -= 1;
    if (k.has("KeyD")) s += 1;
    if (k.has("KeyA")) s -= 1;
    if (f || s) { this.fwd = f; this.strafe = s; }
    else if (!this._joyActive) { this.fwd = 0; this.strafe = 0; }

    // --- camera: arrow keys only ---
    let cy = 0, cp = 0;
    if (k.has("ArrowRight")) cy += 1;
    if (k.has("ArrowLeft"))  cy -= 1;
    if (k.has("ArrowUp"))    cp += 1;
    if (k.has("ArrowDown"))  cp -= 1;
    this.camYaw = cy;
    this.camPitch = cp;
  }

  // Wire an on-screen joystick (base + knob) for touch devices — movement only.
  attachJoystick(base, knob) {
    let pid = null, cx = 0, cy = 0;
    const R = 46;
    const set = (dx, dy) => {
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      const x = dx * k, y = dy * k;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this._joyActive = true;
      this.strafe = x / R;
      this.fwd = -y / R; // up on screen = forward
    };
    const reset = () => {
      pid = null; this._joyActive = false;
      knob.style.transform = "translate(0,0)";
      this._fromKeys();
    };
    base.addEventListener("pointerdown", (e) => {
      pid = e.pointerId; base.setPointerCapture(pid);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pid) return;
      set(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener("pointerup", reset);
    base.addEventListener("pointercancel", reset);
  }
}

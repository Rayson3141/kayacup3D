# 🏆 Kaya Cup 2026

A browser-based **battle-royale simulator** dressed as a live esports broadcast.
Twenty contestants drift around a circular arena, fight, get hurt by a demon
cat and healed by a good dog, and slowly whittle down to a single champion —
rendered either as a **3D third-person follow-cam** or a **2D top-down**
dashboard. Watch it play itself (Spectate) or **drop in and steer a fighter**
(Play).

It's a single static site: HTML, CSS, and ES modules. No build step, no
backend — it deploys to GitHub Pages as-is.

---

## The model

The arena is the unit disk. Every fighter obeys one law of motion:

```
position += drift · dt  +  σ · dW        (controlled part + Brownian part)
```

- **Drift** is a velocity capped at **1.2 units/s**. AI fighters get theirs
  from a strategy file (see below); the human player gets theirs from
  WASD / arrows / joystick. Drift is the *only* thing anyone controls.
- **Diffusion** (σ · dW) is identical Gaussian noise for everyone — the
  player included. Nobody escapes the randomness.

Each fixed timestep (`DT = 0.05s`) the engine runs:

1. **Movement** — drift + diffusion, with steps reflected back off the rim.
2. **Fights** — every living pair within radius **r** fights at Poisson rate
   **λ**; the winner is drawn by HP ratio, the loser takes 1 HP. All combat
   is automatic — there is no attack button.
3. **NPCs** — 🐱 **Kaya** (demon cat, the photo hovering over the arena)
   claws fighters within **r** about **2×/s** for 1 HP. 🐶 **Butter**
   (healer dog) mends fighters within **r** about **1×/s** — but only up to
   **50 HP**.
4. **Boundary recovery** — fighters at ≤ 25 HP inside the outer band (**r′**)
   recover at rate **β**, capped at 25 HP.
5. **Resolution** — first blood, final three, champion / draw.

Fighters start equi-angled on a circle of radius 0.8; NPCs start at the
center.

### Sliders

| Control | Symbol | Meaning |
|---|---|---|
| Contestants | — | How many fighters drop in (2–20). |
| Speed | — | Simulation speed vs real time (0.25×–3×). |
| σ | sigma | Diffusion strength — the arena's jitter. |
| r | — | Fight radius (also NPC reach). |
| λ | lambda | How often in-range pairs clash. |
| r′ | — | Width of the outer recovery ring. |
| β | beta | Recovery rate near the rim. |

The coefficient sliders live in a collapsible **Coefficients** panel.

---

## Strategy files (`strategies/<Name>.js`)

Fighters whose name matches a file in `strategies/` run that file's default
export every step to choose their drift — these fighters show a 🧠 badge.
The interface is unchanged from the repo's `SampleStrategy.js`:

```js
export default function(context) {
  // context = { me, others, npcs, params, dt, maxSpeed }
  return { dx, dy };  // velocity in units/s, capped at maxSpeed (1.2)
}
```

`context.params` uses the documented names (`r_limit`, `r_prime`, …), so
existing strategies work unmodified. A strategy that throws is benched for
the rest of the match (the fighter falls back to pure Brownian motion).

## Playing

Switch **Mode** to **Play** and pick your fighter. You steer your **drift**
with `W A S D` / arrows (or the on-screen joystick on touch) — that's it.
You still take the same Brownian jitter as everyone, fights happen to you
automatically, Kaya still hurts and Butter still heals, and the rim still
restores you when you're low. A faint hint on the arena shows the controls.

Your HUD: a health bar top-left, and the screen bleeds progressively red as
your HP falls below 70. Everyone else's health is visible too — HP bars float
above every fighter in both views, and the leaderboard has inline HP bars.

**Views.** 3D is a third-person camera at fighter eye level, slightly behind
you; it follows a smoothed anchor so the Brownian jitter shakes your fighter,
not your view. A 2D minimap sits top-right whenever you're not in the 2D
view. The 2D view renders at native resolution with no stretching.

### Seeds & reproducibility

Spectate runs are driven by a seeded RNG: same seed + settings replays the
same match — *provided loaded strategies are deterministic* (a strategy that
calls `Math.random()` breaks replay). Play mode adds live input, so it isn't
reproducible.

---

## Project structure

```
index.html            Entry point: layout, styles, import map, module bootstrap
assets/kaya.png       The real Kaya
strategies/           Per-fighter strategy files (SampleStrategy.js = template)
src/
  config.js           Constants, params, roster, enums
  rng.js              Seeded PRNG (mulberry32 + Gaussian)
  engine.js           Pure, headless simulation — drift+diffusion, events
  fx.js               Shared ephemeral effects
  renderer2d.js       Top-down Canvas2D renderer (native-res, HP bars)
  renderer3d.js       Third-person Three.js renderer (HP bars, hovering Kaya)
  minimap.js          Corner map for the 3D view
  chartPanel.js       HP-over-time chart (Chart.js)
  input.js            Keyboard + joystick → drift intent
  ui.js               DOM: controls, leaderboard, ticker, HUD, vignette
  main.js             Orchestrator: loop, strategy loading, modes, views
test_engine.mjs       Headless engine tests (node test_engine.mjs)
```

## Running locally

ES modules need `http://`, not `file://`:

```bash
cd kayacup
python3 -m http.server 8000   # Windows: python -m http.server 8000
# open http://localhost:8000
```

Three.js and Chart.js load from a CDN on first visit.

## Deploying to GitHub Pages

Commit `index.html`, `assets/`, `strategies/`, and `src/` to the repo root,
set Pages to serve the branch root, and the arena is live at
`https://<user>.github.io/<repo>/`. The existing `strategies/` folder in the
repo is picked up as-is.

## Roadmap

- [x] Engine/renderer split, seeded RNG, 3D view, play mode (drift-only)
- [x] Strategy system compatible with the repo's interface
- [ ] Multiplayer via an external realtime service (the deterministic engine
  is built for lockstep sync)

## License

MIT — see [`LICENSE`](./LICENSE).

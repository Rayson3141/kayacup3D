import { Simulation } from "./src/engine.js";
import { DEFAULT_PARAMS, BUTTER_HEAL_CAP, MAX_DRIFT_SPEED } from "./src/config.js";

function runToEnd(seed, controlled=null, strategies=null, maxSteps=300000) {
  const sim = new Simulation(DEFAULT_PARAMS, seed);
  if (controlled !== null) sim.reset(DEFAULT_PARAMS, seed, controlled);
  if (strategies) sim.setStrategies(strategies);
  let steps = 0, evCounts = {};
  while (!sim.over && steps < maxSteps) {
    let input = null;
    if (controlled !== null) {
      const me = sim.player;
      // autopilot: drift toward the rim to camp the recovery band
      input = { move: me ? { x: me.x * 0.9, y: me.y * 0.9 } : { x: 0, y: 0 } };
    }
    const evs = sim.step(input);
    for (const e of evs) evCounts[e.type] = (evCounts[e.type]||0)+1;
    steps++;
  }
  const champ = sim.champion ? sim.champion.name : "(draw)";
  return { steps, time: +sim.time.toFixed(2), champ, over: sim.over, alive: sim.survivors().length, evCounts, sim };
}

let pass = 0, fail = 0;
const check = (label, ok, extra="") => { ok ? pass++ : fail++; console.log(`${ok?"PASS":"FAIL"}  ${label} ${extra}`); };

// 1. Determinism (no strategies): same seed -> identical outcome
const a = runToEnd("kaya"), b = runToEnd("kaya");
check("determinism", JSON.stringify({s:a.steps,c:a.champ}) === JSON.stringify({s:b.steps,c:b.champ}),
      `(champ=${a.champ}, steps=${a.steps}, t=${a.time}s)`);

// 2. Terminates with <=1 survivor; first blood exactly once
check("terminates", a.over && a.alive <= 1);
check("first blood once", a.evCounts.first_blood === 1);

// 3. Single-player (drift only) runs and terminates; no attack events exist
const p = runToEnd("kaya", 0);
check("single-player terminates", p.over, `(champ=${p.champ})`);
check("no player_hit events", !("player_hit" in p.evCounts));

// 4. Strategy support: a chaser strategy moves its fighter and caps speed
let called = 0;
const strategies = new Map([["JAC", (ctx) => { called++; return { dx: 99, dy: 0 }; }]]);
const s = new Simulation(DEFAULT_PARAMS, "strat");
s.setStrategies(strategies);
const jac = s.contestants.find(c => c.name === "JAC");
const x0 = jac.x;
for (let i=0;i<100;i++) s.step();
check("strategy invoked", called > 0, `(${called} calls)`);
check("strategy hasStrategy flag", jac.hasStrategy === true);
// displacement should be ~ capped drift * time, not 99*time
const drifted = jac.x - x0;
check("drift speed capped", drifted < MAX_DRIFT_SPEED * 0.05 * 100 * 1.2 + 0.5, `(dx=${drifted.toFixed(2)})`);

// 5. Broken strategy gets benched, sim continues
const bad = new Map([["ZSSS", () => { throw new Error("boom"); }]]);
const s2 = new Simulation(DEFAULT_PARAMS, "bad");
s2.setStrategies(bad);
for (let i=0;i<10;i++) s2.step();
const zsss = s2.contestants.find(c => c.name === "ZSSS");
check("broken strategy benched", zsss.strategyDisabled === true && zsss.hasStrategy === false);

// 6. Butter never heals anyone past the 50 HP cap (probe: damage someone low, park them on Butter)
const s3 = new Simulation({...DEFAULT_PARAMS, qty: 2, sigma: 0, lam: 0}, "butter");
const target = s3.contestants[0];
target.hp = 30;
const butter = s3.npcs.find(n => n.type === "healer");
let maxSeen = 0;
for (let i=0;i<4000;i++) {
  target.x = butter.x; target.y = butter.y; // stay glued to Butter
  s3.step();
  maxSeen = Math.max(maxSeen, target.hp);
}
check("Butter heal cap respected", maxSeen <= BUTTER_HEAL_CAP, `(max hp seen=${maxSeen})`);

// 7. Reflecting boundary keeps everyone inside the disk
const s4 = new Simulation({...DEFAULT_PARAMS, sigma: 1.0}, "edge");
let maxR = 0;
for (let i=0;i<2000;i++){ s4.step(); for(const c of s4.contestants) maxR=Math.max(maxR, Math.hypot(c.x,c.y)); }
check("boundary holds", maxR <= 1.0001, `(maxR=${maxR.toFixed(4)})`);

// 8. Equi-angle start at r=0.8, NPCs at center
const s5 = new Simulation(DEFAULT_PARAMS, "init");
const r0 = Math.hypot(s5.contestants[0].x, s5.contestants[0].y);
check("start layout", Math.abs(r0 - 0.8) < 1e-9 && s5.npcs.every(n => n.x === 0 && n.y === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

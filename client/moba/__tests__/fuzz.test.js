/**
 * Full Court fuzz — no framework, plain Node:
 *   node client/moba/__tests__/fuzz.test.js              ~300 games (CI)
 *   FUZZ_GAMES=10000 node client/moba/__tests__/fuzz.test.js
 *   FUZZ_SEED=1234 FUZZ_GAMES=1 ...                      re-run one failing game
 *
 * Random command streams (valid commands with wild coordinates, and
 * garbage) at random frame times, over many seeds and every kind of kit.
 * After every frame the state must hold:
 *   - no NaN or Infinity anywhere a number lives
 *   - all ten players on the court
 *   - exactly one ball, in exactly one state, with the fields that state needs
 *   - each team's score equals its box-score points
 *   - the game clock never goes up within a period
 * and every game reaches the final buzzer.
 */
import assert from 'node:assert/strict';
import { createMatch, boxScore, COURT_W, COURT_H } from '../match.js';
import { roster, driverRng, randomCommand, standInDecide } from './helpers.js';

const GAMES = Number(process.env.FUZZ_GAMES || 300);
const FIRST_SEED = Number(process.env.FUZZ_SEED || 1);
const active = roster.filter((p) => p.is_active !== false);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function checkInvariants(mt, ctx) {
  const m = mt._m;
  const where = () => `seed ${ctx.seed}, tick ${m.tick}, phase ${m.phase}, Q${m.quarter}`;
  for (const k of ['time', 'clock', 'shotClock', 'breakLeft']) assert.ok(finite(m[k]), `${k} is ${m[k]} (${where()})`);
  assert.ok(Number.isInteger(m.score.home) && Number.isInteger(m.score.away), `score ${JSON.stringify(m.score)} (${where()})`);

  for (const p of m.all) {
    assert.ok(finite(p.pos.x) && finite(p.pos.y), `${p.name} at ${p.pos.x},${p.pos.y} (${where()})`);
    assert.ok(p.pos.x >= 12 && p.pos.x <= COURT_W - 12 && p.pos.y >= 12 && p.pos.y <= COURT_H - 12, `${p.name} off the court at ${p.pos.x},${p.pos.y} (${where()})`);
    assert.ok(finite(p.stamina) && p.stamina >= 0 && p.stamina <= 100, `${p.name} stamina ${p.stamina} (${where()})`);
    for (const s of ['Q', 'W', 'E', 'R']) assert.ok(finite(p.cd[s]) && p.cd[s] >= 0, `${p.name} ${s} cooldown ${p.cd[s]} (${where()})`);
    if (p.target) assert.ok(finite(p.target.x) && finite(p.target.y), `${p.name} target ${JSON.stringify(p.target)} (${where()})`);
    if (p.dash) assert.ok(finite(p.dash.vx) && finite(p.dash.vy), `${p.name} dash ${JSON.stringify(p.dash)} (${where()})`);
  }

  // Exactly one ball, in one state.
  const b = m.ball;
  assert.ok(['held', 'pass', 'shot', 'loose', 'dead'].includes(b.state), `ball state ${b.state} (${where()})`);
  assert.ok(finite(b.pos.x) && finite(b.pos.y) && finite(b.z), `ball at ${JSON.stringify(b.pos)} z ${b.z} (${where()})`);
  if (b.state === 'held') {
    const h = m.byId.get(b.holder);
    assert.ok(h, `held by unknown id ${b.holder} (${where()})`);
    assert.equal(h.team, m.offense, `the holder is on offense (${where()})`);
  } else {
    assert.equal(b.holder, null, `a ${b.state} ball has no holder (${where()})`);
  }
  if (b.state === 'pass') assert.ok(b.pass && m.byId.get(b.pass.toId), `pass without a receiver (${where()})`);
  if (b.state === 'shot') assert.ok(b.shot && b.shot.dur > 0, `shot without flight (${where()})`);
  if (b.state === 'dead') assert.notEqual(m.phase, 'live', `a dead ball in live play (${where()})`);

  const box = boxScore(mt);
  const pts = (t) => box[t].reduce((s, r) => s + r.pts, 0);
  assert.equal(pts('home'), m.score.home, `home box score (${where()})`);
  assert.equal(pts('away'), m.score.away, `away box score (${where()})`);

  // The game clock only runs down within a period.
  if (ctx.quarter === m.quarter) assert.ok(m.clock <= ctx.clock + 1e-9, `clock went up ${ctx.clock} -> ${m.clock} (${where()})`);
  ctx.quarter = m.quarter;
  ctx.clock = m.clock;
}

let finals = 0;
let ticks = 0;
let commands = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const seed = FIRST_SEED + g;
  const rng = driverRng(seed * 7919);
  const hero = active[Math.floor(rng() * active.length)];
  const options = { quarterLength: 8 + Math.floor(rng() * 20), quarters: 1 + Math.floor(rng() * 4), tutorial: rng() < 0.2 };
  const mt = createMatch({ roster, humanId: hero.id, seed, ...options });
  // Each game picks a command rate and a frame-time style.
  const rate = [0.05, 0.3, 1][Math.floor(rng() * 3)];
  const frameStyle = Math.floor(rng() * 3);
  const dt = () => (frameStyle === 0 ? 1 / 60 : frameStyle === 1 ? 1 / 144 : rng() < 0.02 ? 0.3 : 0.004 + rng() * 0.04);
  const ctx = { seed, quarter: mt._m.quarter, clock: mt._m.clock };
  checkInvariants(mt, ctx);
  // The longest legal game here is 4 x 27 s plus overtimes; 30 minutes means it never ends.
  for (let f = 0; f < 60 * 60 * 30 && mt._m.phase !== 'final'; f++) {
    if (rng() < rate) {
      const c = rng() < 0.8 ? randomCommand(mt._m, rng) : standInDecide(mt, rng);
      if (mt.command(c)) commands += 1;
    }
    mt.step(dt());
    checkInvariants(mt, ctx);
  }
  assert.equal(mt._m.phase, 'final', `seed ${seed}: never reached the final (${JSON.stringify(options)}, Q${mt._m.quarter}, ${mt._m.score.home}-${mt._m.score.away})`);
  assert.notEqual(mt._m.score.home, mt._m.score.away, `seed ${seed}: no ties at the final`);
  finals += 1;
  ticks += mt._m.tick;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`fuzz: ${finals}/${GAMES} games reached the final, ${ticks} ticks, ${commands} commands accepted, invariants held every frame (${secs} s)`);

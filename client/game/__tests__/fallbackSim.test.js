/**
 * Standalone fallback-sim tests — no framework, plain Node:
 *   node client/game/__tests__/fallbackSim.test.js
 *
 * Proves the JS backup ref honors the two things the WASM engine would have:
 * the real ghost board (names on the away roster) and the tactics multipliers
 * (the favored side wins the majority of seeded fights).
 */
import assert from 'node:assert/strict';
import {
  createFallbackSim,
  runFallbackSim,
  shotProbability,
  mulberry32,
} from '../fallbackSim.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const unit = (name, courtX, courtY, over = {}) => ({
  name,
  courtX,
  courtY,
  stats: { speed: 45, shooting: 45, defense: 45, ...over },
});

const HOME = [unit('Home Alpha', 1, 1), unit('Home Bravo', 2, 2), unit('Home Charlie', 3, 3)];
const GHOSTS = [unit('Ghost Aldrin', 1, 1), unit('Ghost Baker', 2, 2), unit('Ghost Collins', 3, 3)];

test('mulberry32 is deterministic and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('same seed replays the identical fight', () => {
  const opts = { homeUnits: HOME, awayUnits: GHOSTS, seed: 7 };
  assert.deepEqual(runFallbackSim(opts), runFallbackSim(opts));
});

test('ghost board names appear in the away roster', () => {
  const sim = createFallbackSim({ homeUnits: HOME, awayUnits: GHOSTS, seed: 3 });
  const state = sim.step(1 / 30);
  const botNames = state.bots.map((b) => b.name);
  for (const g of GHOSTS) assert.ok(botNames.includes(g.name), `missing ${g.name}`);
  // Away ids never collide with home ids
  const homeIds = new Set(state.players.map((p) => p.id));
  for (const b of state.bots) assert.ok(!homeIds.has(b.id));
});

test('state matches the engine shape CourtCanvas consumes', () => {
  const sim = createFallbackSim({ homeUnits: HOME, awayUnits: GHOSTS, seed: 5 });
  const state = sim.step(1 / 30);
  assert.deepEqual(
    Object.keys(state).sort(),
    ['awayScore', 'ball', 'bots', 'homeScore', 'players'],
  );
  for (const p of [...state.players, ...state.bots]) {
    assert.equal(typeof p.id, 'number');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.x, 'number');
    assert.equal(typeof p.y, 'number');
  }
  for (const key of ['x', 'y', 'z', 'possessorId', 'isPossessed']) {
    assert.ok(key in state.ball, `ball missing ${key}`);
  }
});

test('shotProbability scales with the tactics multiplier and clamps', () => {
  const shooter = { stats: { shooting: 45 } };
  const even = shotProbability(shooter, 100, 0, 1.0);
  assert.ok(shotProbability(shooter, 100, 0, 1.25) > even);
  assert.ok(shotProbability(shooter, 100, 0, 0.8) < even);
  // Deep + contested shots are worse; extremes clamp to [0.05, 0.95]
  assert.ok(shotProbability(shooter, 200, 60, 1.0) < even);
  assert.equal(shotProbability({ stats: { shooting: 0 } }, 200, 99, 0.1), 0.05);
  assert.equal(shotProbability({ stats: { shooting: 99 } }, 50, 0, 3.0), 0.95);
});

test('multiplier 1.25 side beats the 0.8 side in the majority of 200 seeded sims', () => {
  // Identical rosters both ways — only the tactics multipliers differ.
  let homeWins = 0;
  let homePts = 0;
  let awayPts = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = runFallbackSim({
      homeUnits: HOME,
      awayUnits: GHOSTS,
      homeMultiplier: 1.25,
      awayMultiplier: 0.8,
      seed,
    });
    if (r.homeScore > r.awayScore) homeWins++;
    homePts += r.homeScore;
    awayPts += r.awayScore;
  }
  console.log(`    (favored side won ${homeWins}/200; points ${homePts} vs ${awayPts})`);
  assert.ok(homeWins > 100, `favored side won only ${homeWins}/200`);
  assert.ok(homePts > awayPts, 'favored side should outscore across the sample');
});

test('a 10-second fight produces plausible basketball scores', () => {
  for (const seed of [11, 22, 33]) {
    const r = runFallbackSim({ homeUnits: HOME, awayUnits: GHOSTS, seed });
    assert.ok(r.homeScore >= 0 && r.homeScore <= 40, `home ${r.homeScore}`);
    assert.ok(r.awayScore >= 0 && r.awayScore <= 40, `away ${r.awayScore}`);
    assert.ok(['win', 'loss'].includes(r.outcome));
  }
});

test('an empty ghost board never scores', () => {
  const r = runFallbackSim({ homeUnits: HOME, awayUnits: [], seed: 9 });
  assert.equal(r.awayScore, 0);
});

console.log(`\nfallbackSim.test.js: ${passed} tests passed`);

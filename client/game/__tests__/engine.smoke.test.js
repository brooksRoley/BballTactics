// WASM engine mechanics smoke test.
// Standalone: `node client/game/__tests__/engine.smoke.test.js` — no dependencies.
//
// With the JS-fallback sim removed, the WASM engine is the ONLY simulation.
// This test drives the real public/engine.wasm the way App.vue does each
// round: spawn home units, load a ghost away team, start the round, tick,
// and assert the mechanics actually run (state exports, both rosters present,
// movement happens, somebody scores).

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const publicDir = join(repoRoot, 'public');

// engine.js is a classic-script Emscripten factory (`var Module = ...`), not
// an ES module — evaluate it and hand back the factory.
const factory = new Function(`${readFileSync(join(publicDir, 'engine.js'), 'utf8')}; return Module;`)();
const wasm = await factory({
  locateFile: (file) => join(publicDir, file),
});

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

console.log('engine.smoke.test.js');

const eng = new wasm.GameManager();

test('new bindings exist (SpawnUnit, SetAwayTeamJSON)', () => {
  assert.strictEqual(typeof eng.SpawnUnit, 'function');
  assert.strictEqual(typeof eng.SetAwayTeamJSON, 'function');
});

// Mirror App.vue's syncEngineForRound: home units with tactics-scaled shooting.
eng.SpawnUnit(1, 'Steph Curry', 'GSW', 63, 74, 51);
eng.SetPlayerCoordinates(1, 120, 150, 120, 150);
eng.SpawnUnit(2, 'Rudy Gobert', 'MIN', 35, 47, 72);
eng.SetPlayerCoordinates(2, 80, 200, 80, 200);
eng.SetAwayTeamJSON(JSON.stringify({
  units: [
    { id: 901, name: 'Ghost Guard', x: 600, y: 150, stats: { shooting: 60, speed: 55, defense: 45 } },
    { id: 902, name: 'Ghost Big', x: 650, y: 250, stats: { shooting: 45, speed: 35, defense: 65 } },
  ],
}));
eng.StartRound();

let state = JSON.parse(eng.GetGameStateJSON());

test('state JSON exports players, bots, ball, and numeric scores', () => {
  assert.ok(Array.isArray(state.players) && state.players.length === 2, `players: ${state.players?.length}`);
  assert.ok(Array.isArray(state.bots) && state.bots.length === 2, `bots: ${state.bots?.length}`);
  assert.ok(state.ball && typeof state.ball.x === 'number');
  assert.strictEqual(typeof state.homeScore, 'number');
  assert.strictEqual(typeof state.awayScore, 'number');
});

test('ghost board became the away team (names survive the round trip)', () => {
  const botNames = state.bots.map(b => b.name).sort();
  assert.deepStrictEqual(botNames, ['Ghost Big', 'Ghost Guard']);
});

const before = state.players.map(p => ({ x: p.x, y: p.y }));

// Tick 40 simulated seconds at 60fps steps — the in-game round is 10s, so this
// is 4 rounds' worth of basketball; someone must score.
for (let i = 0; i < 40 * 60; i++) eng.TickSimulation(1 / 60);
state = JSON.parse(eng.GetGameStateJSON());

test('players actually move under simulation', () => {
  const moved = state.players.some((p, i) =>
    Math.abs(p.x - before[i].x) > 1 || Math.abs(p.y - before[i].y) > 1);
  assert.ok(moved, 'no player moved after 40s of ticks');
});

test('scoring mechanics fire within 40 simulated seconds', () => {
  const total = state.homeScore + state.awayScore;
  assert.ok(total > 0, `homeScore=${state.homeScore} awayScore=${state.awayScore}`);
  console.log(`        (final: ${state.homeScore} - ${state.awayScore})`);
});

test('RemovePlayer + respawn rebuilds a clean round (per-round reset path)', () => {
  eng.RemovePlayer(1);
  eng.RemovePlayer(2);
  eng.SpawnUnit(3, 'Fresh Legs', 'LAL', 50, 50, 50);
  eng.SetPlayerCoordinates(3, 100, 100, 100, 100);
  eng.StartRound();
  const s = JSON.parse(eng.GetGameStateJSON());
  assert.strictEqual(s.players.length, 1);
  assert.strictEqual(s.players[0].name, 'Fresh Legs');
});

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed > 0 ? 1 : 0);

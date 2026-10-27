/**
 * Full Court determinism — no framework, plain Node:
 *   node client/moba/__tests__/determinism.test.js
 *
 * A match is { rulesVersion, seed, humanId, options, log }. These tests hold
 * the engine to that: the same inputs give the same state hash at every
 * checkpoint, at any frame rate, and a live game recorded by record() replays
 * to the same result. The golden replays in ./goldens pin the rules
 * themselves: a change that alters play must bump RULES_VERSION.
 *
 * Not covered, on purpose: cross-browser determinism. JS Math.sin/cos/hypot
 * are not guaranteed bit-identical across engines, so a log recorded in
 * Chrome may drift in Safari. That waits for the rules port to WebAssembly.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createMatch, replay, stateHash, sanitizeCommand, RULES_VERSION, CHECKPOINT_TICKS, TICK } from '../match.js';
import { roster, byName, driverRng, standInDecide, randomCommand, FRAME_PATTERNS } from './helpers.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const SHORT = { quarterLength: 20, quarters: 2 };

/**
 * Play a live game the way the browser does: a frame of `dt()` seconds, the
 * stand-in deciding every few frames between them. Returns the match.
 */
function playLive({ hero = 'Jalen Brunson', seed = 1, options = SHORT, dt = FRAME_PATTERNS['60 fps'](), decideEvery = 4, decide = standInDecide }) {
  const mt = createMatch({ roster, humanId: byName(hero).id, seed, ...options });
  const rng = driverRng(seed * 977 + 3);
  for (let f = 0; f < 200000 && mt._m.phase !== 'final'; f++) {
    if (f % decideEvery === 0) {
      const c = decide(mt, rng);
      if (c) mt.command(c);
    }
    mt.step(dt());
  }
  assert.equal(mt._m.phase, 'final', 'the live game reached the final buzzer');
  return mt;
}

test('rules version is exported and a log from another version is refused', () => {
  assert.ok(Number.isInteger(RULES_VERSION) && RULES_VERSION >= 1);
  assert.throws(
    () => replay({ roster, humanId: byName('Steph Curry').id, seed: 1, log: [], rulesVersion: RULES_VERSION + 1 }),
    /rules version/,
  );
});

test('commands are stamped with the tick they land on and wait for it', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 3 });
  const m = mt._m;
  mt.step(TICK * 10);
  const startTick = m.tick;
  assert.equal(startTick, 10);
  const entry = mt.command({ type: 'move', x: 600, y: 120, junk: 'dropped' });
  assert.deepEqual(entry, { tick: 10, playerId: m.human.id, command: { type: 'move', x: 600, y: 120 } });
  assert.equal(m.human.target, null, 'not applied between ticks');
  mt.step(TICK / 3); // a short frame: no tick runs, nothing applies
  assert.equal(m.tick, 10);
  assert.equal(m.human.target, null);
  mt.step(TICK);
  assert.deepEqual(m.human.target, { x: 600, y: 120 }, 'applied at the start of tick 10');
  assert.equal(mt.record().log.length, 1);
  assert.equal(mt.command({ type: 'move', x: NaN, y: 4 }), null, 'a malformed command is dropped, not logged');
  assert.equal(mt.command({ type: 'move', x: 1, y: 1 }, 99999), null, 'a command for another seat is dropped');
  assert.equal(mt.record().log.length, 1);
});

test('sanitizeCommand keeps only what the rules read', () => {
  assert.deepEqual(sanitizeCommand({ type: 'cast', slot: 'Q', x: 1, y: 2, extra: 1 }), { type: 'cast', slot: 'Q', x: 1, y: 2 });
  assert.deepEqual(sanitizeCommand({ type: 'cast', slot: 'E', x: NaN, y: 2 }), { type: 'cast', slot: 'E' });
  assert.equal(sanitizeCommand({ type: 'cast', slot: 'Z' }), null);
  assert.equal(sanitizeCommand({ type: 'click', x: Infinity, y: 0 }), null);
  assert.equal(sanitizeCommand({ type: 'warp' }), null);
  assert.equal(sanitizeCommand(null), null);
});

test('the state hash is stable, and moves when the state does', () => {
  const a = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 5 });
  const b = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 5 });
  assert.match(stateHash(a), /^[0-9a-f]{8}$/);
  assert.equal(stateHash(a), stateHash(b));
  assert.equal(stateHash(a), stateHash(a._m), 'takes a match or its state');
  b._m.teams.away[3].pos.x += 0.01;
  assert.notEqual(stateHash(a), stateHash(b), 'a hundredth of a court unit is visible');
  b._m.teams.away[3].pos.x -= 0.01;
  b._m.rng();
  assert.notEqual(stateHash(a), stateHash(b), 'the RNG state is in the hash');
  const c = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 6 });
  c.runTicks(60);
  a.runTicks(60);
  assert.notEqual(stateHash(a), stateHash(c), 'another seed is another game');
});

test('same seed and log: the same hash at every checkpoint (60 random logs)', () => {
  const heroes = ['Steph Curry', 'Rudy Gobert', "De'Aaron Fox", 'Jalen Brunson', 'Derrick White'];
  for (let i = 0; i < 60; i++) {
    const seed = 1000 + i;
    const hero = heroes[i % heroes.length];
    const live = playLive({ hero, seed, options: { quarterLength: 12, quarters: 2 }, decide: (mt, rng) => (rng() < 0.5 ? randomCommand(mt._m, rng) : standInDecide(mt, rng)) });
    const rec = live.record();
    const one = replay({ roster, ...rec });
    const two = replay({ roster, ...rec });
    assert.equal(one.checkpoints.length, Math.floor(rec.ticks / CHECKPOINT_TICKS));
    assert.ok(one.checkpoints.length >= 24, 'a checkpoint every second of play');
    assert.deepEqual(one.checkpoints, two.checkpoints, `seed ${seed}: replays agree at every checkpoint`);
    assert.deepEqual(one.checkpoints, live._m.checkpoints, `seed ${seed}: replay agrees with the live game`);
    assert.equal(one.hash, rec.hash);
  }
});

test('frame-rate independence: 30, 60, 144 fps and jitter give the same game', () => {
  const live = playLive({ hero: 'Steph Curry', seed: 404, options: { quarterLength: 25, quarters: 2 } });
  const rec = live.record();
  assert.ok(rec.log.length > 50, `a real log (${rec.log.length} commands)`);
  const results = {};
  for (const [name, pattern] of Object.entries(FRAME_PATTERNS)) {
    const mt = createMatch({ roster, humanId: rec.humanId, seed: rec.seed, ...rec.options });
    mt.loadLog(rec.log);
    const dt = pattern();
    let frames = 0;
    while (mt._m.phase !== 'final' && frames < 200000) { mt.step(dt()); frames += 1; }
    results[name] = { hash: mt.hash(), ticks: mt._m.tick, checkpoints: mt._m.checkpoints, frames };
  }
  for (const [name, r] of Object.entries(results)) {
    assert.equal(r.ticks, rec.ticks, `${name}: same number of ticks`);
    assert.deepEqual(r.checkpoints, live._m.checkpoints, `${name}: same hash at every checkpoint`);
    assert.equal(r.hash, rec.hash, `${name}: same final hash`);
  }
  assert.ok(results['144 fps'].frames > results['30 fps'].frames * 4, 'the patterns really differ in frame count');
});

test('record then replay: a live game at jittery frame rates replays exactly', () => {
  for (const seed of [11, 12, 13]) {
    const live = playLive({ hero: 'Derrick White', seed, options: { quarterLength: 30, quarters: 2, tutorial: seed === 12 }, dt: FRAME_PATTERNS.jitter(seed), decideEvery: 3 });
    const rec = JSON.parse(JSON.stringify(live.record())); // through JSON, as it would be stored or sent
    const r = replay({ roster, ...rec });
    assert.equal(r.ticks, rec.ticks);
    assert.equal(r.hash, rec.hash, `seed ${seed}`);
    assert.deepEqual(r.checkpoints, live._m.checkpoints);
    assert.deepEqual(r.match.view().hud.phase, 'final');
    assert.equal(r.match._m.score.home, live._m.score.home);
    assert.equal(r.match._m.score.away, live._m.score.away);
  }
});

test('a replay of a game still in progress stops at its last tick', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 8 });
  const rng = driverRng(8);
  for (let f = 0; f < 600; f++) {
    if (f % 10 === 0) { const c = standInDecide(mt, rng); if (c) mt.command(c); }
    mt.step(1 / 60);
  }
  const rec = mt.record();
  assert.equal(rec.ticks, 600);
  const r = replay({ roster, ...rec });
  assert.equal(r.ticks, 600);
  assert.equal(r.hash, rec.hash);
});

test('golden replays still play to their recorded hashes', () => {
  const dir = new URL('./goldens/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 1, 'at least one golden is checked in');
  for (const f of files) {
    const gold = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const how = 'If the rules change was intended, bump RULES_VERSION and run `node scripts/full-court-goldens.mjs --write` (goldens/README.md).';
    assert.equal(gold.rulesVersion, RULES_VERSION, `${f} was recorded with rules v${gold.rulesVersion}. ${how}`);
    const r = replay({ roster, ...gold });
    const firstDiff = r.checkpoints.findIndex((h, i) => h !== gold.checkpoints[i]);
    assert.equal(firstDiff, -1, `${f} diverges at checkpoint ${firstDiff} (${firstDiff + 1} s in). ${how}`);
    assert.equal(r.hash, gold.hash, `${f}: final hash. ${how}`);
  }
});

console.log(`\n${passed} passed`);

/**
 * State-hash coverage — no framework, plain Node:
 *   node client/moba/__tests__/hashCoverage.test.js
 *
 * The golden replays only prove what stateHash() mixes in. State the hash
 * leaves out can diverge between two runs and every golden still passes.
 * This test makes that visible: it perturbs each field of the live match and
 * of every player, and checks the hash moved exactly for the fields listed
 * in HASHED. Every other field must be listed in UNHASHED with a reason.
 *
 * Add a field to the match and this test fails until you either mix it into
 * stateHash() (which changes every golden, so bump RULES_VERSION) or write
 * down why it can be left out.
 */
import assert from 'node:assert/strict';
import { createMatch, stateHash } from '../match.js';
import { roster, byName } from './helpers.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

// Fields stateHash() reads. Changing any of them must change the hash.
const HASHED_MATCH = ['tick', 'phase', 'quarter', 'clock', 'shotClock', 'breakLeft', 'offense', 'score', 'rng', 'ball'];
const HASHED_PLAYER = ['pos', 'stamina'];

// Fields it does not read, and why that is acceptable today. "gap" marks
// state that does change play, so two runs could differ there with matching
// hashes; the fuzz invariants and the replay of the whole log still catch
// most of it, but the hash alone would not.
const UNHASHED_MATCH = {
  spec: 'input: seed, human and options are replay() arguments, not evolving state',
  queue: 'input: commands waiting for their tick; the log carries them',
  log: 'input: the command log itself',
  checkpoints: 'output: hashes taken along the way',
  events: 'output: feed for the UI, drained by the client',
  time: 'derived: tick * TICK',
  acc: 'frame accumulator in step(); runTicks() and replay() bypass it',
  quarters: 'input: options',
  quarterLength: 'input: options',
  all: 'derived: teams flattened',
  human: 'derived: reference into teams',
  byId: 'derived: index over teams',
  tutorial: 'input: options',
  teams: 'container: its players are checked field by field below',
  zones: 'gap: wall zones from casts change shot chances',
  lastPass: 'gap: decides whether a steal reads as an interception',
  teamBuffs: 'gap: team speed buffs',
  poss: 'gap: possession counter and touch flag feed the HUD and the coach',
  clutchCalled: 'gap: one-shot flag',
  buzzer: 'gap: one-shot flag',
};
const UNHASHED_PLAYER = {
  id: 'identity: fixed at creation (hashed as the key for pos and stamina)',
  name: 'identity',
  team: 'identity',
  idx: 'identity',
  stats: 'input: roster data',
  kit: 'input: derived from roster data',
  baseSpeed: 'input: derived from roster data',
  isHuman: 'input: derived from humanId',
  target: 'gap: where the player is walking',
  dash: 'gap: a dash in flight',
  cd: 'gap: ability cooldowns',
  buffs: 'gap: timed buffs',
  stumbleUntil: 'gap: timed stun',
  denyUntil: 'gap: timed state',
  lock: 'gap: action lock',
  stealCd: 'gap: steal cooldown',
  think: 'gap: AI decision timer',
  cutUntil: 'gap: timed state',
  line: 'output: box score',
};

/** Advance a match far enough that timers and cooldowns hold live values. */
function warmMatch(seed = 5) {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed, quarterLength: 30, quarters: 2 });
  mt.runTicks(60 * 6);
  return mt;
}

/** Every numeric leaf under `obj[key]`, as setter closures that nudge one. */
function numericLeaves(holder, key) {
  const out = [];
  const walk = (parent, k) => {
    const v = parent[k];
    if (typeof v === 'number') out.push(() => { parent[k] = v + 1.5; return () => { parent[k] = v; }; });
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const kk of Object.keys(v)) walk(v, kk);
  };
  walk(holder, key);
  return out;
}

/** True when nudging any numeric leaf (or the named string swap) moves the hash. */
function moves(mt, holder, key) {
  const before = stateHash(mt);
  const swaps = { phase: 'break', offense: holder.offense === 'home' ? 'away' : 'home' };
  if (key in swaps && typeof holder[key] === 'string') {
    const old = holder[key];
    holder[key] = swaps[key];
    const changed = stateHash(mt) !== before;
    holder[key] = old;
    return changed;
  }
  if (key === 'rng') {
    // Draw once: the generator's state advances, nothing else changes.
    const changed = (() => { holder.rng(); return stateHash(mt) !== before; })();
    return changed;
  }
  let any = false;
  for (const nudge of numericLeaves(holder, key)) {
    const undo = nudge();
    if (stateHash(mt) !== before) any = true;
    undo();
  }
  return any;
}

test('stateHash is stable when nothing changes', () => {
  const mt = warmMatch();
  assert.equal(stateHash(mt), stateHash(mt));
});

test('every match field is either hashed or explained', () => {
  const m = warmMatch()._m;
  const known = new Set([...HASHED_MATCH, ...Object.keys(UNHASHED_MATCH)]);
  const unknown = Object.keys(m).filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], `new match fields need a place in HASHED_MATCH or UNHASHED_MATCH: ${unknown}`);
  const dead = [...known].filter((k) => !(k in m));
  assert.deepEqual(dead, [], `listed but gone from the match: ${dead}`);
});

test('every player field is either hashed or explained', () => {
  const p = warmMatch()._m.all[0];
  const known = new Set([...HASHED_PLAYER, ...Object.keys(UNHASHED_PLAYER)]);
  const unknown = Object.keys(p).filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], `new player fields need a place in HASHED_PLAYER or UNHASHED_PLAYER: ${unknown}`);
  const dead = [...known].filter((k) => !(k in p));
  assert.deepEqual(dead, [], `listed but gone from players: ${dead}`);
});

test('changing a hashed match field changes the hash', () => {
  const mt = warmMatch();
  for (const k of HASHED_MATCH) assert.ok(moves(mt, mt._m, k), `match.${k} is listed as hashed but does not move the hash`);
});

test('changing a hashed player field changes the hash, for every player', () => {
  const mt = warmMatch();
  for (const p of mt._m.all) {
    for (const k of HASHED_PLAYER) assert.ok(moves(mt, p, k), `${p.name}.${k} is listed as hashed but does not move the hash`);
  }
});

test('changing an unhashed numeric field does not change the hash (the listed gaps are real)', () => {
  const mt = warmMatch();
  const m = mt._m;
  const skip = new Set(['spec', 'queue', 'log', 'checkpoints', 'events', 'all', 'human', 'byId', 'teams', 'tutorial', 'zones']);
  for (const k of Object.keys(UNHASHED_MATCH)) {
    if (skip.has(k) || typeof m[k] === 'function') continue;
    if (numericLeaves(m, k).length === 0) continue;
    assert.ok(!moves(mt, m, k), `match.${k} is listed as unhashed but moves the hash: move it to HASHED_MATCH`);
  }
  for (const p of m.all) {
    for (const k of Object.keys(UNHASHED_PLAYER)) {
      if (['id', 'name', 'team', 'idx', 'stats', 'kit'].includes(k)) continue;
      if (numericLeaves(p, k).length === 0) continue;
      assert.ok(!moves(mt, p, k), `${p.name}.${k} is listed as unhashed but moves the hash: move it to HASHED_PLAYER`);
    }
  }
});

console.log(`${passed} passed`);

/**
 * How long until the state hash notices a gap — no framework, plain Node:
 *   node client/moba/__tests__/hashGapLatency.test.js
 *
 * hashCoverage.test.js lists the fields stateHash() leaves out ("gap" rows).
 * A field outside the hash is not invisible forever: if it changes play, the
 * hashed state (positions, stamina, score, rng) drifts a little later and a
 * checkpoint catches it. This test measures that delay. It runs two identical
 * matches in lockstep, perturbs one gap field in one of them, and records the
 * first tick where the hashes differ.
 *
 *   caught: the hash diverged within the bound. Checkpoints land every
 *           CHECKPOINT_TICKS, so the bound is also how many checkpoints late
 *           a golden replay would report it.
 *   unseen: no divergence in WINDOW ticks for this perturbation. That is not
 *           proof the field is harmless, only that this nudge on this seed
 *           did not reach the hashed state. Treat it as the real blind spot.
 *
 * The expectations are pinned. If you hash one of these fields (bump
 * RULES_VERSION), or a rules change moves a latency, this fails and tells you
 * to update the table, which is the point.
 */
import assert from 'node:assert/strict';
import { createMatch, stateHash, CHECKPOINT_TICKS } from '../match.js';
import { roster, byName } from './helpers.js';

const WINDOW = 60 * 20; // twenty seconds of play after the nudge

const fresh = () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 5, quarterLength: 30, quarters: 2 });
  mt.runTicks(60 * 6);
  return mt;
};

/** One nudge per gap field named in hashCoverage.test.js. */
const NUDGES = {
  stumbleUntil: (m) => { for (const p of m.all) p.stumbleUntil = m.time + 30; },
  cd: (m) => { for (const p of m.all) for (const k of Object.keys(p.cd)) p.cd[k] = 99; },
  target: (m) => { for (const p of m.all) p.target = { x: 400, y: 200 }; },
  think: (m) => { for (const p of m.all) p.think = 99; },
  teamBuffs: (m) => { m.teamBuffs.home = { fastUntil: m.time + 30, fastBonus: 0.5 }; },
  denyUntil: (m) => { for (const p of m.all) p.denyUntil = m.time + 30; },
  stealCd: (m) => { for (const p of m.all) p.stealCd = 99; },
  zones: (m) => {
    m.zones.push({ team: 'home', ownerId: m.all[0].id, until: m.time + 30, radius: 300, penalty: 0.9, center: () => ({ x: 600, y: 200 }) });
  },
};

// null = unseen inside WINDOW; a number = the latest tick delay we accept.
const EXPECTED = {
  stumbleUntil: 60,
  cd: 600,
  target: 60,
  think: 60,
  teamBuffs: 60,
  denyUntil: null,
  stealCd: null,
  zones: null,
};

/** Ticks until the hashes differ, or null if they never do inside WINDOW. */
function latency(nudge) {
  const a = fresh();
  const b = fresh();
  nudge(b._m);
  for (let i = 1; i <= WINDOW; i++) {
    a.runTicks(1);
    b.runTicks(1);
    if (stateHash(a) !== stateHash(b)) return i;
  }
  return null;
}

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test('two untouched matches never diverge (the measurement has no noise)', () => {
  const a = fresh();
  const b = fresh();
  for (let i = 0; i < 300; i++) {
    a.runTicks(1);
    b.runTicks(1);
    assert.equal(stateHash(a), stateHash(b), `diverged at tick ${i + 1} with no nudge`);
  }
});

test('every gap nudge has an expectation, and no expectation is orphaned', () => {
  assert.deepEqual(Object.keys(NUDGES).sort(), Object.keys(EXPECTED).sort());
});

for (const [field, nudge] of Object.entries(NUDGES)) {
  const bound = EXPECTED[field];
  test(`gap ${field}: ${bound === null ? `unseen for ${WINDOW} ticks` : `caught within ${bound} ticks`}`, () => {
    const got = latency(nudge);
    if (bound === null) {
      assert.equal(got, null, `${field} now moves the hash after ${got} ticks: list it as caught (or hash it and bump RULES_VERSION)`);
    } else {
      assert.notEqual(got, null, `${field} no longer reaches the hash inside ${WINDOW} ticks: it became a blind spot`);
      assert.ok(got <= bound, `${field} took ${got} ticks to show in the hash, bound is ${bound}`);
    }
  });
}

test('a checkpoint lands inside the slowest caught latency', () => {
  const slowest = Math.max(...Object.values(EXPECTED).filter((v) => v !== null));
  assert.ok(slowest <= 10 * CHECKPOINT_TICKS, 'a caught gap should surface within ten checkpoints');
});

console.log(`${passed} passed`);

/**
 * Standalone test suite for client/game/tactics.js — no test framework needed.
 * Run with:  node client/game/__tests__/tactics.test.js
 * (package.json has no JS test runner configured, so this uses node:assert.)
 */

import assert from 'node:assert/strict';
import {
  resolveMatchup,
  suggestCoverage,
  gradeRead,
  listSchemes,
  getScheme,
  schemes,
} from '../tactics.js';

// ── fixtures (real roster stats from public/engine_roster.json) ─────────────

const u = (id, name, cost, shooting, speed, defense, courtX, courtY) => ({
  id,
  name,
  cost,
  stats: { shooting, speed, defense },
  ...(courtX !== undefined ? { courtX, courtY } : {}),
});

// Shooting-heavy board: Curry / Fox / Brunson / Herro / Trent
const SHOOTERS = [
  u(1, 'Steph Curry', 5, 74, 63, 51),
  u(2, "De'Aaron Fox", 5, 66, 72, 42),
  u(6, 'Jalen Brunson', 4, 68, 58, 45),
  u(9, 'Tyler Herro', 3, 62, 55, 35),
  u(18, 'Gary Trent Jr.', 2, 58, 52, 40),
];

// Budget board: Haslem / Looney / Mills / Alvarado / Portis
const SCRUBS = [
  u(5, 'Udonis Haslem', 1, 25, 24, 21),
  u(15, 'Kevon Looney', 1, 28, 32, 52),
  u(14, 'Patty Mills', 1, 45, 48, 25),
  u(20, 'Jose Alvarado', 1, 40, 62, 55),
  u(13, 'Bobby Portis', 2, 48, 42, 44),
];

// One star carrying four scrubs: Wembanyama + minimum-wage crew
const STAR_BOARD = [
  u(21, 'Victor Wembanyama', 5, 65, 58, 88),
  u(5, 'Udonis Haslem', 1, 25, 24, 21),
  u(15, 'Kevon Looney', 1, 28, 32, 52),
  u(14, 'Patty Mills', 1, 45, 48, 25),
  u(20, 'Jose Alvarado', 1, 40, 62, 55),
];

// Defense with a true rim anchor placed in the paint (courtX <= 1)
const ANCHOR_D = [
  u(3, 'Rudy Gobert', 5, 47, 35, 72, 0, 2),
  u(10, 'Draymond Green', 2, 30, 45, 70, 1, 1),
  u(4, 'Alex Caruso', 3, 38, 56, 63, 3, 0),
  u(12, 'Derrick White', 3, 54, 55, 60, 3, 4),
  u(17, 'Jrue Holiday', 4, 55, 58, 66, 4, 2),
];

// All-guard defense: nobody clears the 55-defense anchor bar
const NO_ANCHOR_D = [
  u(9, 'Tyler Herro', 3, 62, 55, 35, 2, 2),
  u(18, 'Gary Trent Jr.', 2, 58, 52, 40, 3, 1),
  u(14, 'Patty Mills', 1, 45, 48, 25, 1, 3),
  u(11, 'Kyle Kuzma', 2, 52, 50, 38, 2, 4),
  u(2, "De'Aaron Fox", 5, 66, 72, 42, 4, 2),
];

// ── tiny harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message.split('\n').join('\n        ')}`);
  }
}

const offenseIds = schemes.offenses.map((o) => o.id);
const coverageIds = schemes.coverages.map((c) => c.id);

console.log('tactics.test.js');
console.log(`  offenses: ${offenseIds.join(', ')}`);
console.log(`  coverages: ${coverageIds.join(', ')}`);

// ── 1. counter table integrity ──────────────────────────────────────────────

test('counter table is complete: every offense has an entry for every coverage', () => {
  for (const o of schemes.offenses) {
    for (const c of coverageIds) {
      assert.ok(o.counters[c], `${o.id} missing counter vs ${c}`);
    }
  }
});

test(`all base multipliers stay inside the ${schemes.band.min}-${schemes.band.max} band (no hard counters)`, () => {
  for (const o of schemes.offenses) {
    for (const [c, entry] of Object.entries(o.counters)) {
      assert.ok(
        entry.multiplier >= schemes.band.min && entry.multiplier <= schemes.band.max,
        `${o.id} vs ${c} = ${entry.multiplier} outside band`,
      );
    }
  }
});

test('every offense has at least one favorable and one unfavorable coverage matchup', () => {
  for (const o of schemes.offenses) {
    const ms = Object.values(o.counters).map((e) => e.multiplier);
    assert.ok(Math.max(...ms) > 1, `${o.id} never favored`);
    assert.ok(Math.min(...ms) < 1, `${o.id} never punished`);
  }
});

test('every coverage has at least one offense it beats and one that beats it', () => {
  for (const c of coverageIds) {
    const col = schemes.offenses.map((o) => o.counters[c].multiplier);
    assert.ok(Math.min(...col) < 1, `${c} beats nothing`);
    assert.ok(Math.max(...col) > 1, `${c} is never exploited`);
  }
});

test('every counter entry carries a non-empty insider-lingo note', () => {
  for (const o of schemes.offenses) {
    for (const [c, entry] of Object.entries(o.counters)) {
      assert.ok(
        typeof entry.note === 'string' && entry.note.length > 20,
        `${o.id} vs ${c} note missing/too short`,
      );
    }
  }
});

test('every scheme has a translation line and a citation', () => {
  for (const s of [...schemes.offenses, ...schemes.coverages]) {
    assert.ok(s.translation && s.translation.length > 10, `${s.id} missing translation`);
    assert.ok(s.citation && s.citation.length > 10, `${s.id} missing citation`);
  }
});

// ── 2. resolveMatchup ───────────────────────────────────────────────────────

test('resolveMatchup: all 25 pairings return >=1 note and a clamped multiplier', () => {
  for (const o of offenseIds) {
    for (const c of coverageIds) {
      const r = resolveMatchup(o, c, SHOOTERS, ANCHOR_D);
      assert.ok(Array.isArray(r.notes) && r.notes.length >= 1, `${o} vs ${c}: no notes`);
      assert.ok(
        r.offenseMultiplier >= schemes.finalClamp.min &&
          r.offenseMultiplier <= schemes.finalClamp.max,
        `${o} vs ${c}: multiplier ${r.offenseMultiplier} outside final clamp`,
      );
      assert.equal(typeof r.notes[0], 'string');
    }
  }
});

test('resolveMatchup with empty unit arrays returns exactly the base multiplier', () => {
  for (const o of offenseIds) {
    for (const c of coverageIds) {
      const r = resolveMatchup(o, c, [], []);
      assert.equal(r.offenseMultiplier, r.base, `${o} vs ${c}: personnel fired on empty boards`);
    }
  }
});

test('resolveMatchup: shooter personnel boosts Spread PnR vs Drop above the scrub board', () => {
  const good = resolveMatchup('spread_pnr', 'drop', SHOOTERS, ANCHOR_D);
  const bad = resolveMatchup('spread_pnr', 'drop', SCRUBS, ANCHOR_D);
  assert.ok(
    good.offenseMultiplier > bad.offenseMultiplier,
    `${good.offenseMultiplier} !> ${bad.offenseMultiplier}`,
  );
});

test('resolveMatchup: Drop with a paint anchor suppresses the offense more than Drop without one', () => {
  const walled = resolveMatchup('spread_pnr', 'drop', SHOOTERS, ANCHOR_D);
  const doorless = resolveMatchup('spread_pnr', 'drop', SHOOTERS, NO_ANCHOR_D);
  assert.ok(
    walled.offenseMultiplier < doorless.offenseMultiplier,
    `${walled.offenseMultiplier} !< ${doorless.offenseMultiplier}`,
  );
  assert.ok(
    doorless.notes.some((n) => n.includes('welcome mat')),
    'missing-anchor lesson note not surfaced',
  );
});

test('resolveMatchup: notes name real units (the eye-test hook)', () => {
  const r = resolveMatchup('spread_pnr', 'drop', SHOOTERS, ANCHOR_D);
  const joined = r.notes.join(' | ');
  assert.ok(joined.includes("De'Aaron Fox"), `fastest handler not named in: ${joined}`);
  assert.ok(joined.includes('Rudy Gobert'), `paint anchor not named in: ${joined}`);
});

test('resolveMatchup: does not mutate its unit inputs', () => {
  const mine = SHOOTERS.map((x) => Object.freeze({ ...x, stats: Object.freeze({ ...x.stats }) }));
  const theirs = ANCHOR_D.map((x) => Object.freeze({ ...x, stats: Object.freeze({ ...x.stats }) }));
  assert.doesNotThrow(() => resolveMatchup('spain_pnr', 'switch', mine, theirs));
});

test('resolveMatchup: unknown scheme ids throw a helpful error', () => {
  assert.throws(() => resolveMatchup('triangle', 'drop'), /Unknown offense "triangle"/);
  assert.throws(() => resolveMatchup('spread_pnr', 'matchup_zone'), /Unknown coverage/);
});

// ── 3. suggestCoverage ──────────────────────────────────────────────────────

test('suggestCoverage is deterministic (same board twice -> identical ranking)', () => {
  assert.deepEqual(suggestCoverage(SHOOTERS), suggestCoverage(SHOOTERS));
  assert.deepEqual(suggestCoverage(STAR_BOARD), suggestCoverage(STAR_BOARD));
  assert.deepEqual(suggestCoverage([]), suggestCoverage([]));
});

test('suggestCoverage ranks all 5 coverages, each with reasoning', () => {
  const ranked = suggestCoverage(SHOOTERS);
  assert.equal(ranked.length, 5);
  for (const r of ranked) {
    assert.ok(coverageIds.includes(r.coverage));
    assert.ok(typeof r.reasoning === 'string' && r.reasoning.length > 20, `${r.coverage} has no reasoning`);
    assert.equal(typeof r.score, 'number');
  }
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'not sorted by score desc');
  }
});

test('suggestCoverage: one-star board -> Blitz is the top suggestion and names the star', () => {
  const ranked = suggestCoverage(STAR_BOARD);
  assert.equal(ranked[0].coverage, 'blitz', `got ${ranked[0].coverage}`);
  assert.ok(ranked[0].reasoning.includes('Victor Wembanyama'));
});

test('suggestCoverage: shooter-heavy board -> Drop and Zone are NOT in the top two', () => {
  const top2 = suggestCoverage(SHOOTERS).slice(0, 2).map((r) => r.coverage);
  assert.ok(!top2.includes('drop'), `drop suggested vs shooters: ${top2}`);
  assert.ok(!top2.includes('zone23'), `zone suggested vs shooters: ${top2}`);
});

// ── 4. gradeRead ────────────────────────────────────────────────────────────

test('gradeRead: textbook read (Spain vs their Drop + ICE vs their Spread) grades A', () => {
  const res = gradeRead(
    { offense: 'spain_pnr', coverage: 'ice' },
    { offense: 'spread_pnr', coverage: 'drop', units: SHOOTERS },
  );
  assert.equal(res.grade, 'A', `grade ${res.grade}, score ${res.score}`);
  assert.ok(res.lesson.length > 40);
  assert.ok(res.lesson.includes('Spain'), 'lesson does not name the concept used');
  assert.ok(res.concepts.includes('spain_pnr') && res.concepts.includes('drop'));
});

test('gradeRead: double miss (Spain into Switch + Drop vs their Spread) grades D with the book answer', () => {
  const res = gradeRead(
    { offense: 'spain_pnr', coverage: 'drop' },
    { offense: 'spread_pnr', coverage: 'switch', units: SHOOTERS },
  );
  assert.equal(res.grade, 'D', `grade ${res.grade}, score ${res.score}`);
  assert.ok(res.lesson.includes('book answer'), 'lesson missing the corrective concept');
  assert.ok(res.lesson.includes('ICE'), 'lesson should teach ICE as the answer to Spread PnR');
});

test('gradeRead: neutral matchups land C, never crash without units', () => {
  // Spread vs Blitz is 1.00 and 7SOL vs ICE is 1.00 — a true coin flip both ways.
  const res = gradeRead(
    { offense: 'spread_pnr', coverage: 'ice' },
    { offense: 'seven_sol', coverage: 'blitz' },
  );
  assert.equal(res.grade, 'C', `grade ${res.grade}, score ${res.score}`);
  assert.ok(res.lesson.length > 0);
});

test('gradeRead: taking the personnel suggestion earns the scouting bonus line', () => {
  // vs STAR_BOARD the top suggestion is blitz — choose it.
  const res = gradeRead(
    { offense: 'spread_pnr', coverage: 'blitz' },
    { offense: 'delay_5out', coverage: 'ice', units: STAR_BOARD },
  );
  assert.ok(res.lesson.includes('Scouting bonus'), res.lesson);
});

// ── 5. utility exports ──────────────────────────────────────────────────────

test('listSchemes exposes ids, names, translations for the planning UI', () => {
  const l = listSchemes();
  assert.equal(l.offenses.length, 5);
  assert.equal(l.coverages.length, 5);
  assert.ok(l.offenses.every((o) => o.id && o.name && o.translation));
});

test('getScheme resolves both kinds and returns null on misses', () => {
  assert.equal(getScheme('spain_pnr').name, 'Spain Pick-and-Roll');
  assert.equal(getScheme('drop').name, 'Drop');
  assert.equal(getScheme('princeton'), null);
});

// ── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);

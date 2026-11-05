/**
 * Shootaround sandbox rules — plain Node:
 *   node client/game/__tests__/shootaround.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SANDBOX_COURT_CAP, sandboxBench, scrimmageOpponent, scrimmageCalls,
  scrimmageMatchups, summarizeScrimmage,
} from '../shootaround.js';
import { listSchemes } from '../tactics.js';

const roster = JSON.parse(readFileSync(new URL('../../../public/engine_roster.json', import.meta.url), 'utf8'));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };

test('the sandbox court always holds five', () => assert.equal(SANDBOX_COURT_CAP, 5));

test('the bench is every active player, once each, with unique ids', () => {
  const bench = sandboxBench(roster);
  assert.equal(bench.length, roster.filter((p) => p.is_active !== false).length);
  assert.equal(new Set(bench.map((u) => u.uid)).size, bench.length);
  assert.ok(bench.every((u) => u.star === 1));
});

test('the bench skips inactive players and survives a bad roster', () => {
  const bench = sandboxBench([{ id: 1, name: 'A', stats: { shooting: 50, speed: 50, defense: 50 }, is_active: false }]);
  assert.equal(bench.length, 0);
  assert.deepEqual(sandboxBench(null), []);
});

const mine = sandboxBench(roster).slice(0, 5).map((u, i) => ({ ...u, courtX: i, courtY: i }));

test('the opponent matches your count and never reuses your players', () => {
  for (const n of [1, 3, 5]) {
    const lineup = mine.slice(0, n);
    const opp = scrimmageOpponent(roster, lineup, 3);
    assert.equal(opp.length, n);
    const used = new Set(lineup.map((u) => u.rosterId));
    assert.ok(opp.every((u) => !used.has(u.rosterId)));
    assert.equal(new Set(opp.map((u) => u.rosterId)).size, n);
  }
});

test('the same seed is the same game; another seed is another game', () => {
  const a = scrimmageOpponent(roster, mine, 11).map((u) => u.rosterId);
  const b = scrimmageOpponent(roster, mine, 11).map((u) => u.rosterId);
  const c = scrimmageOpponent(roster, mine, 12).map((u) => u.rosterId);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('opponent units sit on the 5x5 grid', () => {
  for (const u of scrimmageOpponent(roster, mine, 5)) {
    assert.ok(u.courtX >= 0 && u.courtX <= 4 && u.courtY >= 0 && u.courtY <= 4);
  }
});

test('the opponent calls real schemes from schemes.json', () => {
  const { offenses, coverages } = listSchemes();
  for (let s = 1; s < 20; s++) {
    const c = scrimmageCalls(s);
    assert.ok(offenses.some((o) => o.id === c.offense));
    assert.ok(coverages.some((o) => o.id === c.coverage));
  }
});

test('matchups give finite shooting multipliers for both sides', () => {
  const { offenses, coverages } = listSchemes();
  const m = scrimmageMatchups({
    myOffense: offenses[0].id, myCoverage: coverages[0].id,
    myUnits: mine, theirUnits: scrimmageOpponent(roster, mine, 2), seed: 2,
  });
  assert.ok(Number.isFinite(m.home.offenseMultiplier) && m.home.offenseMultiplier > 0);
  assert.ok(Number.isFinite(m.away.offenseMultiplier) && m.away.offenseMultiplier > 0);
});

test('a summary carries the score and never HP or gold', () => {
  const s = summarizeScrimmage(
    { outcome: 'win', homeScore: 31, awayScore: 24, playerScoring: [{ name: 'A', points: 9 }, { name: 'B', points: 7 }, 3, 4] },
    [{ name: 'A' }, { name: 'B' }],
  );
  assert.equal(s.outcome, 'win');
  assert.equal(s.margin, 7);
  assert.deepEqual(s.scorers.map((x) => x.name), ['A', 'B']);
  for (const key of Object.keys(s)) assert.ok(!/hp|health|gold|damage|streak/i.test(key), key);
  assert.match(s.verdict, /31–24/);
});

test('scorers who are not on your court are left out (placeholder ids)', () => {
  const s = summarizeScrimmage({ homeScore: 9, awayScore: 8, playerScoring: [{ name: 'Player 9002', points: 8 }] }, [{ name: 'A' }]);
  assert.deepEqual(s.scorers, []);
});

test('a loss and a bare string result both summarize', () => {
  assert.equal(summarizeScrimmage({ homeScore: 10, awayScore: 20 }).outcome, 'loss');
  assert.equal(summarizeScrimmage('win').outcome, 'win');
});

test('the module never touches the run economy', () => {
  const src = readFileSync(new URL('../shootaround.js', import.meta.url), 'utf8');
  assert.ok(!/\b(health|gold|REROLL_COST|goldIncome|rollShop)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
});

console.log(`${passed} passed`);

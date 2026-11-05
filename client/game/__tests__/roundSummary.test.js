/**
 * Standalone tests for client/game/roundSummary.js — plain Node:
 *   node client/game/__tests__/roundSummary.test.js
 */
import assert from 'node:assert/strict';
import { roundSummary } from '../roundSummary.js';
import { gradeRead } from '../tactics.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// Real reads from the scheme book, so a schemes.json rename shows up here.
const TEXTBOOK = gradeRead( // A: Spain into Drop, ICE vs Spread
  { offense: 'spain_pnr', coverage: 'ice' },
  { offense: 'spread_pnr', coverage: 'drop' },
);
const DOUBLE_MISS = gradeRead( // D: Spain into Switch, Drop vs Spread
  { offense: 'spain_pnr', coverage: 'drop' },
  { offense: 'spread_pnr', coverage: 'switch' },
);
const COIN_FLIP = gradeRead( // C: no edge either way
  { offense: 'spread_pnr', coverage: 'ice' },
  { offense: 'seven_sol', coverage: 'blitz' },
);
const SCORERS = [
  { name: 'Role Player', points: 2 },
  { name: 'Steph Curry', points: 5 },
];

test('gradeRead exposes the two edges and the scheme names the summary needs', () => {
  assert.equal(typeof DOUBLE_MISS.offEdge, 'number');
  assert.equal(typeof DOUBLE_MISS.defEdge, 'number');
  assert.ok(DOUBLE_MISS.offEdge < 0 && DOUBLE_MISS.defEdge < 0);
  assert.ok(TEXTBOOK.offEdge > 0 && TEXTBOOK.defEdge > 0);
  assert.equal(DOUBLE_MISS.names.theirCoverage, 'Switch Everything');
});

test('a win with a good read names the bigger winning edge', () => {
  const s = roundSummary({ outcome: 'win', homeScore: 7, awayScore: 4, read: TEXTBOOK, playerScoring: SCORERS });
  const n = TEXTBOOK.names;
  const expected = TEXTBOOK.offEdge >= TEXTBOOK.defEdge
    ? `Your ${n.myOffense} carved up their ${n.theirCoverage}.`
    : `Your ${n.myCoverage} took away their ${n.theirOffense}.`;
  assert.equal(s, expected);
});

test('a win despite a D read credits the players, never the bad scheme', () => {
  // The reported bug: Victory 2-0 next to a headline red D.
  assert.equal(DOUBLE_MISS.grade, 'D');
  const s = roundSummary({ outcome: 'win', homeScore: 7, awayScore: 6, read: DOUBLE_MISS, playerScoring: SCORERS });
  assert.equal(s, 'Steph Curry carried you with 5 of your 7 points.');
});

test('a win with no scorers and no edge still gives one plain sentence', () => {
  const s = roundSummary({ outcome: 'win', homeScore: 2, awayScore: 0, read: COIN_FLIP, playerScoring: [] });
  assert.equal(s, 'Your lineup outscored theirs; the scheme calls gave neither side an edge.');
});

test('a loss with a bad read names the most damaging edge', () => {
  const s = roundSummary({ outcome: 'loss', homeScore: 2, awayScore: 9, read: DOUBLE_MISS });
  const n = DOUBLE_MISS.names;
  const expected = DOUBLE_MISS.offEdge <= DOUBLE_MISS.defEdge
    ? `Their ${n.theirCoverage} shut down your ${n.myOffense}.`
    : `Their ${n.theirOffense} beat your ${n.myCoverage}.`;
  assert.equal(s, expected);
});

test('a loss despite a good read blames talent, not the read', () => {
  const s = roundSummary({ outcome: 'loss', homeScore: 4, awayScore: 6, read: TEXTBOOK });
  assert.equal(s, 'Your calls held up; their lineup simply outscored yours.');
});

test('overtime: the first basket is the decisive factor, either way', () => {
  assert.equal(
    roundSummary({ outcome: 'win', homeScore: 6, awayScore: 4, overtime: true, read: DOUBLE_MISS }),
    'You hit the first basket of sudden-death overtime.',
  );
  assert.equal(
    roundSummary({ outcome: 'loss', homeScore: 4, awayScore: 7, overtime: true, read: TEXTBOOK }),
    'They hit the first basket of sudden-death overtime.',
  );
  assert.equal(
    roundSummary({ outcome: 'loss', homeScore: 4, awayScore: 4, overtime: true }),
    'Still tied after sudden-death overtime, which counts as a loss.',
  );
});

test('no read (gradeRead failed) never crashes and returns one sentence', () => {
  for (const outcome of ['win', 'loss']) {
    const s = roundSummary({ outcome, homeScore: 3, awayScore: 1, read: null });
    assert.ok(s.length > 10);
    assert.equal(s.split('. ').length, 1, `more than one sentence: ${s}`);
  }
});

console.log(`\nroundSummary.test.js: ${passed} tests passed`);

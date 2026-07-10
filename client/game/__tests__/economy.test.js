/**
 * Standalone economy tests — no framework, plain Node:
 *   node client/game/__tests__/economy.test.js
 */
import assert from 'node:assert/strict';
import {
  SHOP_SIZE,
  REROLL_COST,
  shopOdds,
  rollShop,
  goldIncome,
  interestOn,
  streakBonus,
  teamSizeCap,
  sellValue,
  makeUnit,
  makeStarUp,
  starUpStats,
  findTriple,
  planCombine,
} from '../economy.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const ROSTER = [
  { id: 1, name: 'A One', team: 'AAA', cost: 1, stats: { shooting: 30, speed: 40, defense: 50 } },
  { id: 2, name: 'B Two', team: 'BBB', cost: 2, stats: { shooting: 40, speed: 45, defense: 45 } },
  { id: 3, name: 'C Three', team: 'CCC', cost: 3, stats: { shooting: 55, speed: 50, defense: 50 } },
  { id: 4, name: 'D Four', team: 'DDD', cost: 4, stats: { shooting: 65, speed: 55, defense: 55 } },
  { id: 5, name: 'E Five', team: 'EEE', cost: 5, stats: { shooting: 74, speed: 63, defense: 51 } },
];

test('shop odds sum to 100 for every round band', () => {
  for (const r of [1, 3, 5, 7, 9, 10]) {
    const odds = shopOdds(r);
    const total = Object.values(odds).reduce((s, w) => s + w, 0);
    assert.equal(total, 100, `round ${r} odds sum ${total}`);
  }
});

test('cost-5 units never appear in rounds 1-2', () => {
  assert.equal(shopOdds(1)[5], 0);
  assert.equal(shopOdds(2)[5], 0);
});

test('rollShop returns SHOP_SIZE slots and allows duplicates', () => {
  // Deterministic RNG that always picks the first tier and first player
  const rig = () => 0;
  const slots = rollShop(ROSTER, 1, rig);
  assert.equal(slots.length, SHOP_SIZE);
  assert.ok(slots.every((s) => s.id === slots[0].id), 'rigged RNG should duplicate');
});

test('rollShop never offers cost 5 in round 1', () => {
  for (let i = 0; i < 200; i++) {
    for (const s of rollShop(ROSTER, 1)) {
      assert.notEqual(s.cost, 5);
    }
  }
});

test('interest is +1 per 10 banked, capped at +5', () => {
  assert.equal(interestOn(0), 0);
  assert.equal(interestOn(9), 0);
  assert.equal(interestOn(10), 1);
  assert.equal(interestOn(39), 3);
  assert.equal(interestOn(500), 5);
});

test('streak bonus is +1/+2/+3 at 2/4/6', () => {
  assert.equal(streakBonus(0), 0);
  assert.equal(streakBonus(1), 0);
  assert.equal(streakBonus(2), 1);
  assert.equal(streakBonus(3), 1);
  assert.equal(streakBonus(4), 2);
  assert.equal(streakBonus(5), 2);
  assert.equal(streakBonus(6), 3);
  assert.equal(streakBonus(9), 3);
});

test('goldIncome combines base + interest + streak', () => {
  const inc = goldIncome(4, 23, 4);
  assert.deepEqual(inc, { total: 5 + 2 + 2, base: 5, interest: 2, streak: 2 });
});

test('team size cap grows 3 → 5 with rounds', () => {
  assert.equal(teamSizeCap(1), 3);
  assert.equal(teamSizeCap(2), 3);
  assert.equal(teamSizeCap(3), 4);
  assert.equal(teamSizeCap(4), 4);
  assert.equal(teamSizeCap(5), 5);
  assert.equal(teamSizeCap(10), 5);
});

test('sell-back is full cost; 2-star refunds three copies', () => {
  assert.equal(sellValue({ cost: 3, star: 1 }), 3);
  assert.equal(sellValue({ cost: 3, star: 2 }), 9);
});

test('makeUnit gives unique ids to copies of the same roster player', () => {
  const a = makeUnit(ROSTER[0]);
  const b = makeUnit(ROSTER[0]);
  assert.notEqual(a.id, b.id);
  assert.equal(a.rosterId, b.rosterId);
  assert.equal(a.star, 1);
});

test('star-up multiplies stats by 1.8 capped at 99', () => {
  const s = starUpStats({ shooting: 74, speed: 40, defense: 10 });
  assert.equal(s.shooting, 99); // 133 capped
  assert.equal(s.speed, 72);
  assert.equal(s.defense, 18);
});

test('findTriple detects three 1-star copies and ignores 2-stars', () => {
  const copies = [makeUnit(ROSTER[1]), makeUnit(ROSTER[1]), makeUnit(ROSTER[1])];
  const triple = findTriple([...copies, makeUnit(ROSTER[2])]);
  assert.ok(triple);
  assert.equal(triple.rosterId, 2);
  assert.equal(triple.copies.length, 3);

  const twoStar = makeStarUp(copies[0]);
  assert.equal(twoStar.star, 2);
  assert.equal(findTriple([twoStar, twoStar, twoStar]), null);
});

test('reroll cost matches the published constant', () => {
  assert.equal(REROLL_COST, 2);
});

const onCourt = (unit, x, y) => ({ ...unit, courtX: x, courtY: y });

test('planCombine returns null when no triple exists anywhere', () => {
  const bench = [makeUnit(ROSTER[0]), makeUnit(ROSTER[1])];
  const court = [onCourt(makeUnit(ROSTER[0]), 2, 3)];
  assert.equal(planCombine(bench, court), null);
});

test('planCombine merges an all-bench triple onto the bench', () => {
  const bench = [makeUnit(ROSTER[1]), makeUnit(ROSTER[1]), makeUnit(ROSTER[1])];
  const plan = planCombine(bench, []);
  assert.ok(plan);
  assert.equal(plan.twoStar.star, 2);
  assert.equal(plan.twoStar.rosterId, 2);
  assert.equal(plan.benchUids.length, 3);
  assert.equal(plan.courtUids.length, 0);
  assert.equal(plan.placement, null);
});

test('planCombine completes a triple split across court and bench', () => {
  const courtCopy = onCourt(makeUnit(ROSTER[2]), 1, 4);
  const bench = [makeUnit(ROSTER[2]), makeUnit(ROSTER[2]), makeUnit(ROSTER[0])];
  const plan = planCombine(bench, [courtCopy, onCourt(makeUnit(ROSTER[3]), 0, 0)]);
  assert.ok(plan);
  assert.equal(plan.twoStar.rosterId, 3);
  assert.equal(plan.benchUids.length, 2);
  assert.deepEqual(plan.courtUids, [courtCopy.uid]);
  // The 2-star replaces the on-court copy in its cell
  assert.deepEqual(plan.placement, { courtX: 1, courtY: 4 });
});

test('planCombine anchors to the first court copy when several are placed', () => {
  const first = onCourt(makeUnit(ROSTER[4]), 3, 1);
  const court = [first, onCourt(makeUnit(ROSTER[4]), 4, 2), onCourt(makeUnit(ROSTER[4]), 0, 0)];
  const plan = planCombine([], court);
  assert.ok(plan);
  assert.equal(plan.courtUids.length, 3);
  assert.equal(plan.benchUids.length, 0);
  assert.deepEqual(plan.placement, { courtX: 3, courtY: 1 });
});

test('planCombine ignores 2-star copies when hunting triples', () => {
  const twoStar = makeStarUp(makeUnit(ROSTER[1]));
  const bench = [twoStar, makeUnit(ROSTER[1]), makeUnit(ROSTER[1])];
  assert.equal(planCombine(bench, []), null);
});

console.log(`\neconomy.test.js: ${passed} tests passed`);

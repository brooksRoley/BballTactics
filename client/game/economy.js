/**
 * Pure economy rules for the Hardwood Autochess core loop.
 * No Vue, no DOM — everything here is unit-testable in plain Node.
 */

export const SHOP_SIZE = 5;
export const BENCH_CAP = 8;
export const REROLL_COST = 2;
export const BASE_INCOME = 5;
export const INTEREST_CAP = 5;
export const STARTING_GOLD = 10;
export const MAX_ROUNDS = 10;
export const STAR_MULTIPLIER = 1.8;
export const STAT_CAP = 99; // mirrors PlayerEntity::ClampStats in shared-core

/**
 * Cost-tier appearance weights per round. Higher rounds shift odds
 * toward expensive units, TFT-style.
 */
export function shopOdds(round) {
  if (round <= 2) return { 1: 50, 2: 30, 3: 15, 4: 5, 5: 0 };
  if (round <= 4) return { 1: 35, 2: 30, 3: 20, 4: 12, 5: 3 };
  if (round <= 6) return { 1: 25, 2: 28, 3: 24, 4: 15, 5: 8 };
  if (round <= 8) return { 1: 18, 2: 22, 3: 26, 4: 20, 5: 14 };
  return { 1: 12, 2: 18, 3: 25, 4: 25, 5: 20 };
}

/**
 * Roll a shop of SHOP_SIZE slots. Duplicates across slots are allowed —
 * that's what makes 3-copy combines achievable with a 20-player roster.
 * @param {Array} roster active roster entries ({id, name, team, cost, stats})
 * @param {number} round current round (1-10)
 * @param {Function} rand injectable RNG for tests
 */
export function rollShop(roster, round, rand = Math.random) {
  const odds = shopOdds(round);
  const byCost = {};
  for (const p of roster) {
    (byCost[p.cost] = byCost[p.cost] || []).push(p);
  }
  // Only keep tiers that actually have players
  const tiers = Object.keys(odds)
    .map(Number)
    .filter((c) => odds[c] > 0 && byCost[c] && byCost[c].length > 0);
  if (tiers.length === 0) return [];

  const totalWeight = tiers.reduce((sum, c) => sum + odds[c], 0);
  const slots = [];
  for (let i = 0; i < SHOP_SIZE; i++) {
    let r = rand() * totalWeight;
    let tier = tiers[tiers.length - 1];
    for (const c of tiers) {
      r -= odds[c];
      if (r <= 0) {
        tier = c;
        break;
      }
    }
    const pool = byCost[tier];
    slots.push(pool[Math.floor(rand() * pool.length)]);
  }
  return slots;
}

/**
 * Streak gold (fun-brief rec 1): +1/+2/+3 at 2/4/6 consecutive wins OR losses.
 * @param {number} streak length of the current W or L streak
 */
export function streakBonus(streak) {
  if (streak >= 6) return 3;
  if (streak >= 4) return 2;
  if (streak >= 2) return 1;
  return 0;
}

/** Interest: +1 gold per 10 banked, capped. */
export function interestOn(banked) {
  return Math.min(Math.floor(Math.max(0, banked) / 10), INTEREST_CAP);
}

/**
 * Gold income at the start of a round: base + interest + streak bonus.
 * @returns {{ total: number, base: number, interest: number, streak: number }}
 */
export function goldIncome(round, banked, streak = 0) {
  const base = BASE_INCOME;
  const interest = interestOn(banked);
  const streakGold = streakBonus(streak);
  return { total: base + interest + streakGold, base, interest, streak: streakGold };
}

/** Max units allowed on court, growing with the round (court holds 5 max). */
export function teamSizeCap(round) {
  return Math.min(3 + Math.floor((round - 1) / 2), 5);
}

/** Sell-back value: full cost; a 2-star refunds the three copies it consumed. */
export function sellValue(unit) {
  return unit.cost * (unit.star >= 2 ? 3 : 1);
}

let nextUid = 1;

/** Create an owned unit instance from a roster entry. `id` doubles as the
 *  engine/board id and must be unique per instance (copies share rosterId). */
export function makeUnit(rosterPlayer) {
  const uid = nextUid++;
  return {
    uid,
    id: uid,
    rosterId: rosterPlayer.id,
    name: rosterPlayer.name,
    team: rosterPlayer.team || "",
    cost: rosterPlayer.cost,
    star: 1,
    stats: { ...rosterPlayer.stats },
  };
}

/** Stats for a 2-star: base ×1.8, rounded, capped to the engine's clamp. */
export function starUpStats(stats) {
  const boost = (v) => Math.min(STAT_CAP, Math.round(v * STAR_MULTIPLIER));
  return {
    shooting: boost(stats.shooting),
    speed: boost(stats.speed),
    defense: boost(stats.defense),
  };
}

/** Build the 2-star unit produced by combining three copies of `unit`. */
export function makeStarUp(unit, baseStats) {
  const uid = nextUid++;
  return {
    uid,
    id: uid,
    rosterId: unit.rosterId,
    name: unit.name,
    team: unit.team,
    cost: unit.cost,
    star: 2,
    stats: starUpStats(baseStats || unit.stats),
  };
}

/**
 * Plan the first available triple-merge across the court AND the bench.
 * Copies can sit anywhere: the plan lists which uids to consume from each
 * zone and where the 2-star lands — replacing the first on-court copy in its
 * cell when one exists, otherwise going to the bench.
 *
 * Pure: no state is touched; the caller applies the plan to its own stores.
 *
 * @param {Array} benchUnits owned units on the bench
 * @param {Array} courtUnits owned units on court (carry courtX/courtY)
 * @returns {{ twoStar: Object, benchUids: number[], courtUids: number[],
 *             placement: {courtX: number, courtY: number}|null }|null}
 */
export function planCombine(benchUnits, courtUnits) {
  // Court first so the merged unit anchors to the earliest-placed court copy.
  const tagged = [
    ...courtUnits.map((u) => ({ unit: u, zone: "court" })),
    ...benchUnits.map((u) => ({ unit: u, zone: "bench" })),
  ];
  const triple = findTriple(tagged.map((t) => t.unit));
  if (!triple) return null;

  const uids = new Set(triple.copies.map((u) => u.uid));
  const consumed = tagged.filter((t) => uids.has(t.unit.uid));
  const anchor = consumed.find((t) => t.zone === "court");

  return {
    twoStar: makeStarUp(triple.copies[0]),
    benchUids: consumed.filter((t) => t.zone === "bench").map((t) => t.unit.uid),
    courtUids: consumed.filter((t) => t.zone === "court").map((t) => t.unit.uid),
    placement: anchor ? { courtX: anchor.unit.courtX, courtY: anchor.unit.courtY } : null,
  };
}

/**
 * Find the first 1-star triple across a set of owned units.
 * @returns {{rosterId: number, copies: Array}|null}
 */
export function findTriple(units) {
  const groups = {};
  for (const u of units) {
    if (u.star !== 1) continue;
    (groups[u.rosterId] = groups[u.rosterId] || []).push(u);
  }
  for (const rosterId of Object.keys(groups)) {
    if (groups[rosterId].length >= 3) {
      return { rosterId: Number(rosterId), copies: groups[rosterId].slice(0, 3) };
    }
  }
  return null;
}

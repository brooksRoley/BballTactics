/**
 * shootaround.js — rules for the Shootaround sandbox (docs/design/open-gym.md, OG4).
 *
 * Shootaround is a no-stakes court: pick any players, place them, watch a
 * scrimmage, run it again. There is no HP, no gold, no shop and no streak —
 * nothing in here reads or writes them, and `summarizeScrimmage` returns only
 * what the player needs to learn from (who won, by how much, who scored).
 *
 * Zero Vue, zero DOM — runs identically under plain `node` for tests.
 */
import { makeUnit, teamSizeCap } from './economy.js';
import { mulberry32 } from './fallbackSim.js';
import { roundMatchups, listSchemes } from './tactics.js';

/** The sandbox court always allows a full five. */
export const SANDBOX_COURT_CAP = teamSizeCap(10);

/** Grid cells (0-4) the scrimmage opponent starts in, in pick order. */
const OPPONENT_CELLS = [
  { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 4, y: 2 }, { x: 1, y: 3 }, { x: 3, y: 3 },
];

/** Every active player, by name, one fresh unit each. No cost, no cap. */
export function sandboxBench(roster) {
  return (Array.isArray(roster) ? roster : [])
    .filter((p) => p && p.is_active !== false)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((p) => makeUnit(p));
}

/** Scrimmage opponent: as many players as you placed, never one of yours,
 *  chosen from the seed so a replay with the same seed is the same game. */
export function scrimmageOpponent(roster, lineup, seed = 1) {
  const mine = new Set((lineup || []).map((u) => u.rosterId));
  const pool = (Array.isArray(roster) ? roster : [])
    .filter((p) => p && p.is_active !== false && !mine.has(p.id));
  const rand = mulberry32(seed);
  const picks = [];
  const left = pool.slice();
  const count = Math.min(OPPONENT_CELLS.length, (lineup || []).length, left.length);
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rand() * left.length);
    picks.push(left.splice(j, 1)[0]);
  }
  return picks.map((p, i) => ({
    id: 900 + i,
    rosterId: p.id,
    name: p.name,
    cost: p.cost ?? 1,
    star: 1,
    courtX: OPPONENT_CELLS[i].x,
    courtY: OPPONENT_CELLS[i].y,
    stats: { ...p.stats },
  }));
}

/** The opponent's offense and coverage for this seed (from schemes.json). */
export function scrimmageCalls(seed = 1) {
  const { offenses, coverages } = listSchemes();
  const rand = mulberry32(seed + 7919);
  return {
    offense: offenses[Math.floor(rand() * offenses.length)].id,
    coverage: coverages[Math.floor(rand() * coverages.length)].id,
  };
}

/** Both sides' shooting multipliers for a scrimmage, same rules as a round. */
export function scrimmageMatchups({ myOffense, myCoverage, myUnits, theirUnits, seed = 1 }) {
  const calls = scrimmageCalls(seed);
  const { home, away } = roundMatchups({
    myOffense, myCoverage,
    theirOffense: calls.offense, theirCoverage: calls.coverage,
    myUnits, theirUnits,
  });
  return { home, away, calls };
}

/** What a finished scrimmage tells the player. No HP, no gold. */
export function summarizeScrimmage(result, lineup = []) {
  const r = result && typeof result === 'object' ? result : { outcome: result };
  const home = Number(r.homeScore) || 0;
  const away = Number(r.awayScore) || 0;
  const outcome = r.outcome === 'win' || home > away ? 'win' : 'loss';
  const margin = Math.abs(home - away);
  // Only scorers we can match to a player on your court are shown: the backup
  // ref's score attribution can name a placeholder id, and a wrong name teaches wrong.
  const names = new Set((lineup || []).map((u) => u.name));
  const scorers = (Array.isArray(r.playerScoring) ? r.playerScoring : [])
    .filter((s) => s && names.has(s.name))
    .slice(0, 3);
  const verdict = outcome === 'win'
    ? `Your five won ${home}–${away}.`
    : `Your five lost ${home}–${away}.`;
  return { outcome, home, away, margin, overtime: !!r.overtime, verdict, scorers };
}

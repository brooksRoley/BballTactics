/**
 * roundSummary.js — the one sentence under the score on the result card.
 *
 * The card leads with the outcome (Victory/Defeat, score, HP), then this line
 * names the single most decisive factor. The full scheme lesson and the Film
 * Room sit behind a "Why?" disclosure, so a win never reads like a failure
 * (docs/design/build-review-2026-10-20.md, "read grade contradicts the
 * scoreboard").
 *
 * Pure: no Vue, no DOM — safe under plain `node`.
 */

/** Same threshold gradeRead uses to call a half of the read an edge. */
export const EDGE = 0.04;

/**
 * @param {Object} r
 * @param {'win'|'loss'} r.outcome
 * @param {number} r.homeScore your score
 * @param {number} r.awayScore their score
 * @param {boolean} [r.overtime] the round went to sudden-death overtime
 * @param {Object|null} [r.read] gradeRead() result (offEdge, defEdge, names)
 * @param {Array<{name: string, points: number}>} [r.playerScoring] your scorers
 * @returns {string} one sentence
 */
export function roundSummary({ outcome, homeScore = 0, awayScore = 0, overtime = false, read = null, playerScoring = [] }) {
  const won = outcome === 'win';

  // Sudden death decides itself: one basket, nothing else mattered as much.
  if (overtime) {
    if (homeScore === awayScore) return 'Still tied after sudden-death overtime, which counts as a loss.';
    return won ? 'You hit the first basket of sudden-death overtime.' : 'They hit the first basket of sudden-death overtime.';
  }

  // The biggest scheme edge pointing the same way as the result.
  if (read && read.names && typeof read.offEdge === 'number' && typeof read.defEdge === 'number') {
    const n = read.names;
    const sides = [
      { side: 'offense', edge: read.offEdge },
      { side: 'defense', edge: read.defEdge },
    ];
    const pick = won
      ? sides.filter((s) => s.edge >= EDGE).sort((a, b) => b.edge - a.edge)[0]
      : sides.filter((s) => s.edge <= -EDGE).sort((a, b) => a.edge - b.edge)[0];
    if (pick) {
      if (won) {
        return pick.side === 'offense'
          ? `Your ${n.myOffense} carved up their ${n.theirCoverage}.`
          : `Your ${n.myCoverage} took away their ${n.theirOffense}.`;
      }
      return pick.side === 'offense'
        ? `Their ${n.theirCoverage} shut down your ${n.myOffense}.`
        : `Their ${n.theirOffense} beat your ${n.myCoverage}.`;
    }
  }

  // No scheme edge in the result's direction: it came down to the players.
  if (won) {
    const top = [...playerScoring].sort((a, b) => b.points - a.points)[0];
    if (top && top.points > 0 && homeScore > 0) {
      return `${top.name} carried you with ${top.points} of your ${homeScore} points.`;
    }
    return 'Your lineup outscored theirs; the scheme calls gave neither side an edge.';
  }
  return 'Your calls held up; their lineup simply outscored yours.';
}

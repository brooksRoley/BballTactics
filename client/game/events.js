/**
 * events.js — derive game-feel events from two consecutive sim states.
 *
 * The engine (and the JS backup ref) only report state, never "a shot was
 * missed" or "that was a steal", so CourtCanvas compares each frame's state
 * with the last one and hands the result to the renderer's effects layer.
 * Pure data in, pure data out: zero Vue, zero DOM, safe under plain `node`.
 * Effects read these events; nothing here ever feeds back into the sim.
 *
 * State shape (GameManager.GetGameStateJSON / fallbackSim.getState):
 *   { players, bots, ball: {x, y, z, possessorId}, homeScore, awayScore, lastScorerId }
 * Positions use the engine's top-left convention; events carry CENTER
 * coordinates in the renderer's 800x400 world (units +15, ball +6).
 */

// The rims as CourtRenderer draws them. Home attacks right, away attacks left
// (engine Court.cpp: home shoots at AWAY_HOOP x=770, away at HOME_HOOP x=30).
export const RIMS = {
  left: { x: 20, y: 200 },
  right: { x: 780, y: 200 },
};
export const rimFor = (team) => (team === 'home' ? RIMS.right : RIMS.left);

const UNIT_HALF = 15;
const BALL_HALF = 6;
const AIRBORNE_Z = 0.5; // matches the engine's "ball is down" threshold

const teamOf = (state, id) => {
  if (id == null || id < 0) return null;
  if ((state.players || []).some((p) => p.id === id)) return 'home';
  if ((state.bots || []).some((p) => p.id === id)) return 'away';
  return null;
};

const unitCenter = (state, id) => {
  const u = [...(state.players || []), ...(state.bots || [])].find((p) => p.id === id);
  return u ? { x: u.x + UNIT_HALF, y: u.y + UNIT_HALF } : null;
};

const ballCenter = (ball) => ({ x: (ball.x ?? 0) + BALL_HALF, y: (ball.y ?? 0) + BALL_HALF });

/**
 * Events that happened between `prev` and `next`:
 *   make  — a score went up. { points, team, hoop, at } (at = the scorer)
 *   miss  — a loose, airborne ball came down with no score change. The engine
 *           launches a miss as an arc toward the hoop, so the landing is when
 *           it reaches the rim area; a made engine shot never flies (it
 *           teleports to mid-court), and the backup ref's makes land on the
 *           same frame the score changes, so landing never misfires on a make.
 *   steal — possession flipped straight to the other team with no score change.
 *           A pass (same team) or a rebound (from a loose ball) is not a steal.
 * Returns [] for the first frame (no prev) and for quiet frames.
 */
export function detectEvents(prev, next) {
  if (!prev || !next) return [];
  const events = [];
  const dHome = (next.homeScore ?? 0) - (prev.homeScore ?? 0);
  const dAway = (next.awayScore ?? 0) - (prev.awayScore ?? 0);
  const pb = prev.ball || {};
  const nb = next.ball || {};

  if (dHome > 0 || dAway > 0) {
    for (const [team, points] of [['home', dHome], ['away', dAway]]) {
      if (points <= 0) continue;
      const scorer = next.lastScorerId ?? -1;
      const at = (scorer >= 0 && teamOf(next, scorer) === team && unitCenter(next, scorer))
        || ballCenter(pb);
      events.push({ type: 'make', points, team, hoop: rimFor(team), at });
    }
    return events;
  }

  const prevPoss = pb.possessorId ?? -1;
  const nextPoss = nb.possessorId ?? -1;

  const wasFlying = prevPoss < 0 && (pb.z ?? 0) > AIRBORNE_Z;
  const cameDown = (nb.z ?? 0) <= AIRBORNE_Z || nextPoss >= 0;
  if (wasFlying && cameDown) {
    const c = ballCenter(nb);
    events.push({ type: 'miss', hoop: c.x < 400 ? RIMS.left : RIMS.right });
    return events;
  }

  if (prevPoss >= 0 && nextPoss >= 0 && prevPoss !== nextPoss) {
    const from = teamOf(prev, prevPoss);
    const to = teamOf(next, nextPoss);
    if (from && to && from !== to) {
      events.push({ type: 'steal', team: to, at: unitCenter(next, nextPoss) || ballCenter(nb) });
    }
  }
  return events;
}

/**
 * Did the round's last make decide it? True for the sudden-death overtime
 * basket, or for a go-ahead make by the winner within `window` seconds of the
 * horn. `lastMake` = { team, tookLead, t } (t in seconds, same clock as `now`).
 */
export function isGameWinner(lastMake, { overtime, homeScore, awayScore, now, window }) {
  if (!lastMake || homeScore === awayScore) return false;
  const winner = homeScore > awayScore ? 'home' : 'away';
  if (lastMake.team !== winner) return false;
  if (overtime) return true;
  return lastMake.tookLead && now - lastMake.t <= window;
}

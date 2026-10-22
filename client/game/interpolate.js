/**
 * Fixed-timestep stepping + render interpolation for the fight sim.
 *
 * The sim (WASM engine or the JS backup ref) only ever advances in exact
 * `substep` slices of sim time, so the same board plays out the same at
 * 60 Hz and 120 Hz — the display only decides how many slices run per frame.
 * The renderer draws a blend of the last two sim states (`alpha` of the way
 * from prev to cur), which keeps motion smooth between slices.
 */

// Per-step movement beyond this (px) is a discontinuity, not motion: the ball
// reset to mid-court after a make, a possession hand-off. Normal per-step
// motion is under ~4 px for units and the dribbled ball at a 1/60 s step.
export const SNAP_DIST = 20;

// Float slack so 60 frames of 1/60 s don't come up one step short.
const EPS = 1e-9;

/**
 * @param {{ substep: number, maxSteps: number,
 *           tick: (dt: number) => void, read: () => Object|null }} opts
 *   tick advances the sim by one substep; read returns its current state
 *   (null when it has none yet).
 */
export function createFixedStepper({ substep, maxSteps, tick, read }) {
  let acc = 0;
  let prev = null;
  let cur = null;
  let total = 0;

  return {
    reset(state) { acc = 0; prev = cur = state; },

    /** Feed sim-time; run whole substeps. Returns { steps, alpha }. */
    advance(simDt) {
      acc += simDt;
      let steps = 0;
      while (acc >= substep - EPS && steps < maxSteps) { acc -= substep; steps++; }
      // Past the cap (a tab stall), drop the backlog instead of spiralling.
      if (acc >= substep) acc %= substep;
      if (acc < 0) acc = 0;

      for (let i = 0; i < steps; i++) {
        // prev must sit exactly one step behind cur for alpha to mean anything
        if (i === steps - 1) prev = i === 0 ? cur : (read() ?? cur);
        tick(substep);
      }
      if (steps) cur = read() ?? cur;
      total += steps;
      return { steps, alpha: Math.min(1, acc / substep) };
    },

    get prev() { return prev; },
    get cur() { return cur; },
    get totalSteps() { return total; },
  };
}

const lerpEntity = (p, c, alpha, snap2) => {
  if (!p || !c) return c;
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const hasZ = typeof c.z === 'number' && typeof p.z === 'number';
  const dz = hasZ ? c.z - p.z : 0;
  if (dx * dx + dy * dy + dz * dz > snap2) return c; // teleport: snap
  const out = { ...c, x: p.x + dx * alpha, y: p.y + dy * alpha };
  if (hasZ) out.z = p.z + dz * alpha;
  return out;
};

const lerpList = (prevList, curList, alpha, snap2) => {
  if (!curList) return [];
  if (!prevList || !prevList.length) return curList;
  const byId = new Map(prevList.map((e) => [e.id, e]));
  return curList.map((c) => lerpEntity(byId.get(c.id), c, alpha, snap2));
};

/**
 * Positions blended prev → cur by alpha (players and bots matched by id, the
 * ball by x/y/z). Everything non-positional — scores, possession — is cur's.
 */
export function interpolateState(prev, cur, alpha, snapDist = SNAP_DIST) {
  if (!cur || !prev || prev === cur || alpha >= 1) return cur;
  const snap2 = snapDist * snapDist;
  return {
    ...cur,
    players: lerpList(prev.players, cur.players, alpha, snap2),
    bots: lerpList(prev.bots, cur.bots, alpha, snap2),
    ball: lerpEntity(prev.ball, cur.ball, alpha, snap2),
  };
}

/**
 * fallbackSim.js — pure-JS "backup ref" for Hardwood Autochess.
 *
 * When the WASM engine fails to load, CourtCanvas runs this instead so the
 * player still gets a real fight: the away side is the actual ghost board
 * from matchmaking and the round's tactics multipliers (resolveMatchup)
 * scale each side's shot probability. It is deliberately simpler than the
 * engine — movement toward the hoop plus shot-probability rolls off unit
 * stats — a fair, watchable stand-in, NOT an engine-accurate replica.
 *
 * step(dt) emits the same state shape as GameManager.GetGameStateJSON():
 *   { players: [{id,name,x,y}], bots: [{id,name,x,y}],
 *     ball: {x,y,z,possessorId,isPossessed}, homeScore, awayScore }
 * so CourtCanvas renders, attributes scores, and finishes the round through
 * the exact same code path as the WASM engine.
 *
 * Zero Vue, zero DOM — runs identically under plain `node` for tests.
 */

export const COURT_W = 800;
export const COURT_H = 400;

// Rims in CENTER coordinates: home attacks right, away attacks left
// (matches CourtCanvas's RIMS and the engine's Court.cpp hoops).
const RIM_HOME = { x: COURT_W - 24, y: COURT_H / 2 };
const RIM_AWAY = { x: 24, y: COURT_H / 2 };

const THREE_POINT_DIST = 160; // matches the 160px arcs CourtCanvas draws
const SHOT_FLIGHT_TIME = 0.55; // seconds the ball spends in the air per attempt
const SHOT_ARC_Z = 42;         // peak height — feeds the canvas lift/trail FX
const CONTEST_RADIUS = 60;     // a defender this close contests the shot
const OFF_REBOUND_CHANCE = 0.25;

/** Deterministic PRNG (mulberry32) so seeded sims replay identically. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const getStat = (u, key) => {
  const v = u && u.stats ? u.stats[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 45;
};

/** Planning-grid (0-4) coords → sim CENTER coords. Same 70px cells CourtCanvas
 *  uses in gridToSim (top-left +40), shifted +15 to the unit's center. */
const gridToCenter = (gx, gy) => ({ x: gx * 70 + 55, y: gy * 70 + 55 });

/**
 * Shot quality at launch: shooting stat sets the base, deep attempts and a
 * nearby contest shave it, and the side's tactics multiplier scales the lot.
 */
export function shotProbability(shooter, rimDist, contesterDefense, multiplier) {
  const base = 0.34 + getStat(shooter, 'shooting') / 300;
  const rangePenalty = rimDist > THREE_POINT_DIST ? 0.1 : 0;
  const contestPenalty = contesterDefense > 0 ? contesterDefense / 900 : 0;
  return clamp((base - rangePenalty - contestPenalty) * multiplier, 0.05, 0.95);
}

/**
 * Build a running fallback sim.
 *
 * @param {Object} opts
 * @param {Array}  opts.homeUnits       locked-in court lineup ({name, courtX, courtY, stats})
 * @param {Array}  opts.awayUnits       normalized ghost-board units (same shape)
 * @param {number} opts.homeMultiplier  resolveMatchup offenseMultiplier for the player
 * @param {number} opts.awayMultiplier  resolveMatchup offenseMultiplier for the ghost
 * @param {number} opts.seed            PRNG seed — same seed, same fight
 * @returns {{ step: (dt: number) => Object, getState: () => Object }}
 */
export function createFallbackSim({
  homeUnits = [],
  awayUnits = [],
  homeMultiplier = 1,
  awayMultiplier = 1,
  seed = 1,
} = {}) {
  const rng = mulberry32(seed);

  // Fallback-local ids: home 1..n, away 9001..; never collide across teams,
  // so CourtCanvas's isHomeId/isBotId checks stay unambiguous even when the
  // ghost board reuses another player's uids.
  const makeSide = (units, isHome, idBase) =>
    units.map((u, i) => {
      const c = gridToCenter(u.courtX ?? 1 + (i % 3), u.courtY ?? i % 5);
      return {
        id: idBase + i,
        name: u.name || (isHome ? `Player ${i + 1}` : `Ghost ${i + 1}`),
        x: isHome ? c.x : COURT_W - c.x, // ghosts mirror onto the right half
        y: c.y,
        speed: getStat(u, 'speed'),
        shooting: getStat(u, 'shooting'),
        defense: getStat(u, 'defense'),
      };
    });

  const home = makeSide(homeUnits, true, 1);
  const away = makeSide(awayUnits, false, 9001);

  let homeScore = 0;
  let awayScore = 0;

  const ball = { x: COURT_W / 2, y: COURT_H / 2, z: 0, possessorId: -1, isPossessed: false };
  const poss = { side: 'home', carrier: null, shotDist: 0 }; // active drive
  let flight = null; // { from, to, t, pts, prob, side } — shot in the air

  const teamOf = (side) => (side === 'home' ? home : away);
  const otherSide = (side) => (side === 'home' ? 'away' : 'home');
  const rimOf = (side) => (side === 'home' ? RIM_HOME : RIM_AWAY);
  const multOf = (side) => (side === 'home' ? homeMultiplier : awayMultiplier);

  const startPossession = (side) => {
    poss.side = side;
    const team = teamOf(side);
    poss.carrier = team.length ? team[Math.floor(rng() * team.length)] : null;
    poss.shotDist = 70 + rng() * 120; // where this drive pulls up (deep ones are threes)
    if (poss.carrier) {
      ball.x = poss.carrier.x;
      ball.y = poss.carrier.y;
      ball.z = 0;
      ball.possessorId = poss.carrier.id;
      ball.isPossessed = true;
    } else {
      ball.possessorId = -1;
      ball.isPossessed = false;
    }
  };

  const moveToward = (u, tx, ty, maxStep) => {
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d <= maxStep || d === 0) {
      u.x = tx;
      u.y = ty;
    } else {
      u.x += ((tx - u.x) / d) * maxStep;
      u.y += ((ty - u.y) / d) * maxStep;
    }
    u.x = clamp(u.x, 20, COURT_W - 20);
    u.y = clamp(u.y, 20, COURT_H - 20);
  };

  const launchShot = () => {
    const carrier = poss.carrier;
    const rim = rimOf(poss.side);
    const rimDist = dist(carrier, rim);
    const defenders = teamOf(otherSide(poss.side));
    const contester = defenders
      .filter((d) => dist(d, carrier) <= CONTEST_RADIUS)
      .sort((a, b) => dist(a, carrier) - dist(b, carrier))[0];
    flight = {
      from: { x: carrier.x, y: carrier.y },
      to: { x: rim.x, y: rim.y },
      t: 0,
      pts: rimDist > THREE_POINT_DIST ? 3 : 2,
      prob: shotProbability(carrier, rimDist, contester ? contester.defense : 0, multOf(poss.side)),
      side: poss.side,
    };
    ball.possessorId = -1;
    ball.isPossessed = false;
  };

  const resolveShot = () => {
    const made = rng() < flight.prob;
    const side = flight.side;
    if (made) {
      if (side === 'home') homeScore += flight.pts;
      else awayScore += flight.pts;
      startPossession(otherSide(side)); // inbound: the other team's ball
    } else {
      // Rebound scramble: a quarter of misses stay with the offense.
      startPossession(rng() < OFF_REBOUND_CHANCE ? side : otherSide(side));
    }
    flight = null;
  };

  const getState = () => ({
    // Emit the engine's top-left convention: CourtCanvas draws units at
    // (x+15, y+15) and the ball at (x+6, y+6).
    players: home.map((u) => ({ id: u.id, name: u.name, x: u.x - 15, y: u.y - 15 })),
    bots: away.map((u) => ({ id: u.id, name: u.name, x: u.x - 15, y: u.y - 15 })),
    ball: {
      x: ball.x - 6,
      y: ball.y - 6,
      z: ball.z,
      possessorId: ball.possessorId,
      isPossessed: ball.isPossessed,
    },
    homeScore,
    awayScore,
  });

  const step = (dt) => {
    if (flight) {
      // Shot in the air: parabolic arc toward the rim, then the make roll.
      flight.t += dt;
      const k = Math.min(1, flight.t / SHOT_FLIGHT_TIME);
      ball.x = flight.from.x + (flight.to.x - flight.from.x) * k;
      ball.y = flight.from.y + (flight.to.y - flight.from.y) * k;
      ball.z = Math.sin(k * Math.PI) * SHOT_ARC_Z;
      if (k >= 1) resolveShot();
    } else if (!poss.carrier) {
      // Degenerate board (no offensive units) — hand the ball straight over.
      startPossession(otherSide(poss.side));
    } else {
      const carrier = poss.carrier;
      const rim = rimOf(poss.side);
      const defenders = teamOf(otherSide(poss.side));

      // Carrier drives at the rim; speed stat sets the burst.
      moveToward(carrier, rim.x, rim.y, (150 + carrier.speed * 2) * dt);

      // Teammates trail the play in their own lanes.
      for (const u of teamOf(poss.side)) {
        if (u === carrier) continue;
        moveToward(u, (carrier.x + rim.x) / 2, u.y, (60 + u.speed) * dt);
      }
      // Defenders converge between the drive and the rim they protect,
      // fanned out vertically so they don't stack on one pixel.
      defenders.forEach((d, i) => {
        const midX = (carrier.x + rim.x) / 2;
        const midY = (carrier.y + rim.y) / 2 + (i - (defenders.length - 1) / 2) * 34;
        moveToward(d, midX, midY, (55 + d.speed * 1.4) * dt);
      });

      ball.x = carrier.x;
      ball.y = carrier.y;
      ball.z = 0;
      ball.possessorId = carrier.id;
      ball.isPossessed = true;

      if (dist(carrier, rim) <= poss.shotDist) launchShot();
    }
    return getState();
  };

  startPossession('home'); // home wins the fallback tip
  return { step, getState };
}

/**
 * Run a whole fight headlessly and return the final line — used by tests and
 * anything that needs an outcome without animating frames.
 * Outcome mirrors CourtCanvas: a draw counts as a loss.
 */
export function runFallbackSim(opts, duration = 10, dt = 1 / 30) {
  const sim = createFallbackSim(opts);
  let state = sim.getState();
  for (let t = 0; t < duration; t += dt) state = sim.step(dt);
  return {
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    outcome: state.homeScore > state.awayScore ? 'win' : 'loss',
  };
}

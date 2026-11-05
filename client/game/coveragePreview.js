// What the pre-fight panel shows about the coverage the player called on the
// scouting report. Pure data + one helper, so it runs under plain node tests.
//
// The call itself is made once, on the scouting report (App.vue). It reaches
// the sim as the opponent's offense multiplier: resolveMatchup(theirOffense,
// myCoverage, ...) scales their shooting before the round starts. The glow is
// the picture of that call: where the scheme funnels their shots (warm) and
// what it takes away (cool). The engine has no shot zones, so the glow
// illustrates the scheme; the multiplier is what it does in the sim.
import schemesData from './schemes.json' with { type: 'json' };

// Effect value per opponent shot zone, in [-1, 1], from the DEFENSE's point
// of view: positive = attempts funnelled here (warm), negative = taken away
// (cool). Keyed by schemes.json coverage ids.
export const COVERAGE_GLOW = {
  drop:   { tagline: 'Wall off the rim, live with mid-range.',
            effects: { rim: -0.85, mid:  0.85, cornerTop: -0.20, cornerBottom: -0.20, wing:  0.10 } },
  switch: { tagline: 'Switch 1–5, no blown coverages.',
            effects: { rim: -0.45, mid:  0.35, cornerTop: -0.55, cornerBottom: -0.55, wing: -0.35 } },
  blitz:  { tagline: 'Trap the ball, dare the pass.',
            effects: { rim:  0.60, mid: -0.45, cornerTop:  0.50, cornerBottom:  0.50, wing: -0.85 } },
  ice:    { tagline: 'Force baseline, kill the corner three.',
            effects: { rim: -0.15, mid:  0.60, cornerTop: -0.90, cornerBottom: -0.90, wing:  0.25 } },
  zone23: { tagline: 'Pack the paint, contest the arc late.',
            effects: { rim: -0.70, mid: -0.40, cornerTop:  0.70, cornerBottom:  0.70, wing:  0.65 } },
};

const NAMES = new Map(schemesData.coverages.map((c) => [c.id, c.name]));

/**
 * Display data for the called coverage.
 * @param {string} coverageId     the player's coverage (schemes.json id)
 * @param {number} theirMultiplier the opponent's offense multiplier this round
 *                                 (awayMatchup.offenseMultiplier)
 * @returns {{ id, name, tagline, effects, effectPct, effectText }}
 *   effectPct is the signed change to their shooting, e.g. -6 for ×0.94.
 */
export function coverageCall(coverageId, theirMultiplier = 1) {
  const glow = COVERAGE_GLOW[coverageId] || COVERAGE_GLOW.drop;
  const id = COVERAGE_GLOW[coverageId] ? coverageId : 'drop';
  const m = Number.isFinite(theirMultiplier) ? theirMultiplier : 1;
  const effectPct = Math.round((m - 1) * 100);
  const effectText = effectPct === 0
    ? 'leaves their shooting even this round'
    : effectPct < 0
      ? `cuts their shooting ${-effectPct}% this round`
      : `gives up ${effectPct}% on their shooting this round`;
  return { id, name: NAMES.get(id) || id, tagline: glow.tagline, effects: glow.effects, effectPct, effectText };
}

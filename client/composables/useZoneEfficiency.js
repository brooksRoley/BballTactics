// useZoneEfficiency.js
// -----------------------------------------------------------------------------
// Presentation-layer shot-zone efficiency model for the pre-fight planning grid.
//
// This is a LOCAL, UI-only approximation of shot value. The authoritative shot
// math lives in the C++ engine (shared-core/include/ShotProbability.h ->
// CalculateShotProbability). Nothing here feeds the simulation — it only tints
// the placement grid so the human can "see" the geometry of good and bad shots.
//
// Values are eFG%-flavoured (effective field goal %) for the standard 8-zone
// taxonomy. Reasonable real-basketball intuition:
//   - Paint (at the rim)     : high 2PT efficiency
//   - Corner 3               : the most valuable 3 (shortest 3, best %)
//   - Wing 3 / Top of key    : moderate 3PT value
//   - Mid-range              : the classically "bad" long-2 shot
// -----------------------------------------------------------------------------

export const ZONES = {
  'paint':          { label: 'Paint',          efg: 0.62 },
  'left-corner-3':  { label: 'Left Corner 3',  efg: 0.60 },
  'right-corner-3': { label: 'Right Corner 3', efg: 0.60 },
  'left-wing-3':    { label: 'Left Wing 3',    efg: 0.55 },
  'right-wing-3':   { label: 'Right Wing 3',   efg: 0.55 },
  'top-of-key':     { label: 'Top of Key',     efg: 0.54 },
  'left-mid':       { label: 'Left Mid-Range', efg: 0.42 },
  'right-mid':      { label: 'Right Mid-Range',efg: 0.42 },
};

// Spread of the efg values above, used to normalise warmth into [0, 1].
export const EFG_MIN = 0.42;
export const EFG_MAX = 0.62;

/**
 * Map a grid cell (x = column, y = row) to one of the 8 canonical shot zones.
 *
 * Grid convention on this court: y = 0 is the top (far from the hoop), the last
 * row is the baseline where the basket sits (see the .court-hoop / .court-paint
 * markings, both anchored to the bottom). Column 0 is the far-left sideline and
 * the last column is the far-right sideline.
 *
 *   depth 0-1  = near the basket (baseline band)
 *   depth 2    = mid band
 *   depth 3+   = out beyond the arc (3PT band)
 */
export function getZoneForCell(x, y, cols, rows) {
  const leftCol = 0;
  const rightCol = cols - 1;
  const depth = (rows - 1) - y; // 0 at the baseline/basket, grows moving away

  const isLeft = x === leftCol;
  const isRight = x === rightCol;

  // Sideline columns
  if (isLeft) return depth <= 1 ? 'left-corner-3' : 'left-wing-3';
  if (isRight) return depth <= 1 ? 'right-corner-3' : 'right-wing-3';

  // Interior columns
  if (depth <= 1) return 'paint';        // at / near the rim
  if (depth >= 3) return 'top-of-key';   // straight-away 3

  // depth === 2 -> the mid-range no-man's-land, split by side
  return x <= (cols - 1) / 2 ? 'left-mid' : 'right-mid';
}

/** Return the zone descriptor ({ label, efg }) for a cell. */
export function getZoneEfficiency(x, y, cols, rows) {
  return ZONES[getZoneForCell(x, y, cols, rows)];
}

/** Normalise an efg value to a 0 (coolest) .. 1 (warmest) warmth score. */
export function zoneWarmth(efg) {
  const t = (efg - EFG_MIN) / (EFG_MAX - EFG_MIN);
  return Math.max(0, Math.min(1, t));
}

/**
 * Inline-style glow for a grid cell. Warm/bright for high-value zones (paint,
 * corner 3), cool/dim for low-value zones (long mid-range).
 *
 * When `crowded` is true (a unit is hovering this cell while an already-placed
 * unit sits in an adjacent cell), the glow is desaturated and dimmed to signal
 * that packing two units together is a bad idea.
 */
export function getZoneGlowStyle(x, y, cols, rows, options = {}) {
  const { crowded = false } = options;
  const efg = getZoneEfficiency(x, y, cols, rows).efg;
  const t = zoneWarmth(efg);

  // Hue sweeps from cool cyan (~200deg, low value) to warm gold (~35deg, high).
  const hue = 200 - t * 165;
  const sat = crowded ? 10 : 35 + t * 45;
  const light = 45 + t * 12;
  const alpha = crowded ? 0.08 : 0.12 + t * 0.30;
  const glowPx = crowded ? 0 : t * 16;

  return {
    background: `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`,
    boxShadow: glowPx > 0
      ? `inset 0 0 ${glowPx}px hsla(${hue}, ${sat}%, ${light + 12}%, ${(alpha + 0.15).toFixed(3)})`
      : 'none',
    borderColor: `hsla(${hue}, ${sat}%, ${light + 12}%, ${crowded ? 0.15 : 0.35})`,
  };
}

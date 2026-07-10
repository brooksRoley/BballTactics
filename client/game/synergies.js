/**
 * JS mirror of shared-core/src/SynergyEngine.cpp trigger rules, computed from
 * roster metadata so the planning UI can show active synergies without a
 * round-trip through the WASM engine. Keep thresholds in sync with C++.
 */

/**
 * Compute active synergies for the units currently on court.
 * @param {Array} units owned units ({name, team, stats, star})
 * @returns {Array<{name: string, detail: string, count: number}>}
 */
export function computeSynergies(units) {
  const active = [];
  if (!units || units.length === 0) return active;

  // Franchise: 2+ units from the same NBA team → +5 shooting per pair-tier
  const teamCounts = {};
  for (const u of units) {
    if (u.team) teamCounts[u.team] = (teamCounts[u.team] || 0) + 1;
  }
  for (const [team, count] of Object.entries(teamCounts)) {
    if (count >= 2) {
      const tier = Math.floor(count / 2);
      active.push({
        name: `${team} Franchise`,
        detail: `+${5 * tier} SHT`,
        count,
      });
    }
  }

  // Splash Family: 3+ units with shooting >= 85 (reachable with 2-stars)
  const splashCount = units.filter((u) => u.stats.shooting >= 85).length;
  if (splashCount >= 3) {
    active.push({ name: "Splash Family", detail: "+20 SHT, limitless range", count: splashCount });
  }

  // 7 Seconds or Less: 4+ units averaging speed > 85
  if (units.length >= 4) {
    const avgSpeed = units.reduce((s, u) => s + u.stats.speed, 0) / units.length;
    if (avgSpeed > 85) {
      active.push({ name: "7 Seconds or Less", detail: "+25 SPD, +10 SHT", count: units.length });
    }
  }

  return active;
}

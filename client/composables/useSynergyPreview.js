// useSynergyPreview.js
// -----------------------------------------------------------------------------
// PRESENTATION-LAYER APPROXIMATION of the authoritative C++ SynergyEngine
// (shared-core/include/SynergyEngine.h -> AnalyzeRoster / GetActiveBuffs).
//
// This is NOT a replacement for the real engine. It exists only so the pre-fight
// planning screen can ghost-preview which already-placed units would "light up"
// in a synergy if a candidate pick is added. The real buffs (speedBuff /
// shootingBuff / defenseBuff and their tiers) are computed authoritatively in
// WASM at fight time; this file just mirrors the synergy NAMES and grouping rules
// so the preview matches what the player will eventually see.
//
// Mirrored rules (kept in sync with practice/SynergyEngine behaviour):
//   - "Franchise"    : 2+ units that share the same real-life NBA team.
//   - "Twin Towers"  : 2+ "tall" units (bigs / rim protectors).
// -----------------------------------------------------------------------------

/**
 * Approximate whether a roster player is "tall" (a big / rim protector).
 *
 * The client roster payload has no height field (see engine_roster.json:
 * id, name, team, cost, stats{shooting, speed, defense}), so we infer size from
 * the stat profile: bigs skew defense-heavy and foot-speed-light. This is a
 * deliberate UI heuristic, not the engine's real classification.
 */
export function isTall(player) {
  const d = player?.stats?.defense ?? 0;
  const s = player?.stats?.speed ?? 0;
  return d >= 55 && s <= 62;
}

/**
 * Compute the synergies currently active on a roster (array of player objects).
 * Returns e.g. [{ name: 'Franchise', teams: ['GSW'] }, { name: 'Twin Towers', count: 2 }].
 */
export function analyzeRoster(roster) {
  const synergies = [];
  const list = Array.isArray(roster) ? roster : [];

  // Franchise — 2+ from the same real NBA team.
  const teamCounts = {};
  for (const p of list) {
    if (p && p.team) teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
  }
  const franchiseTeams = Object.keys(teamCounts).filter((t) => teamCounts[t] >= 2);
  if (franchiseTeams.length) {
    synergies.push({ name: 'Franchise', teams: franchiseTeams });
  }

  // Twin Towers — 2+ tall units.
  const tallCount = list.filter(isTall).length;
  if (tallCount >= 2) {
    synergies.push({ name: 'Twin Towers', count: tallCount });
  }

  return synergies;
}

/**
 * Given the units already placed (currentRoster) and a candidate pick, return
 * the set of already-placed player ids that would join a synergy if the
 * candidate were added, plus the names of the synergies that would fire.
 *
 * @returns {{ ids: Set<string|number>, synergies: string[] }}
 */
export function previewSynergyContributors(currentRoster, candidate) {
  const ids = new Set();
  const synergies = [];
  const list = Array.isArray(currentRoster) ? currentRoster : [];

  if (!candidate) return { ids, synergies };

  // Franchise — candidate shares a team with any placed unit.
  if (candidate.team) {
    const sameTeam = list.filter((p) => p && p.team === candidate.team && p.id !== candidate.id);
    if (sameTeam.length >= 1) {
      sameTeam.forEach((p) => ids.add(p.id));
      synergies.push('Franchise');
    }
  }

  // Twin Towers — candidate is tall and at least one placed unit is also tall.
  if (isTall(candidate)) {
    const otherTalls = list.filter((p) => p && p.id !== candidate.id && isTall(p));
    if (otherTalls.length >= 1) {
      otherTalls.forEach((p) => ids.add(p.id));
      synergies.push('Twin Towers');
    }
  }

  return { ids, synergies: [...new Set(synergies)] };
}

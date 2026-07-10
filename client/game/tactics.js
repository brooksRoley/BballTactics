/**
 * tactics.js — pure tactical-resolution engine for Hardwood Autochess.
 *
 * Zero Vue imports, zero side effects, fully deterministic: every function is
 * a pure mapping from (scheme ids + unit arrays) to plain objects, so it runs
 * identically in the Vite client, in the JS sim fallback, and under plain
 * `node` for tests.
 *
 * Unit shape (matches the App.vue / board_states schema):
 *   { id, name, cost, stats: { shooting, speed, defense }, courtX?, courtY? }
 * courtX/courtY are planning-grid coords 0-4. The home team defends the left
 * hoop (Court.cpp: hoops at x=30 / x=770), so courtX <= 1 is "the paint" for
 * positional rules like Drop's rim anchor.
 *
 * Exports:
 *   resolveMatchup(myOffense, theirCoverage, myUnits, theirUnits)
 *     -> { offenseMultiplier, base, notes[] }
 *   suggestCoverage(opponentUnits) -> ranked [{ coverage, name, score, reasoning }]
 *   gradeRead(playerChoice, opponentBoard) -> { grade, score, lesson, concepts[] }
 *   listSchemes(), getScheme(id), schemes (raw data)
 */

import schemesData from './schemes.json' with { type: 'json' };

const OFFENSES = new Map(schemesData.offenses.map((o) => [o.id, o]));
const COVERAGES = new Map(schemesData.coverages.map((c) => [c.id, c]));
const FINAL_CLAMP = schemesData.finalClamp;

// ── small pure helpers ──────────────────────────────────────────────────────

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function round(x, places = 3) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

function getStat(unit, stat) {
  const v = unit && unit.stats ? unit.stats[stat] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function avgStat(units, stat) {
  if (!units.length) return 0;
  return units.reduce((s, u) => s + getStat(u, stat), 0) / units.length;
}

/** Units sorted by a stat descending, name ascending for deterministic ties. */
function sortByStat(units, stat) {
  return [...units].sort((a, b) => {
    const d = getStat(b, stat) - getStat(a, stat);
    if (d !== 0) return d;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function statSum(unit) {
  return getStat(unit, 'shooting') + getStat(unit, 'speed') + getStat(unit, 'defense');
}

/** Fraction of the board's total production carried by its best unit. */
function starShare(units) {
  if (!units.length) return { unit: null, share: 0 };
  const total = units.reduce((s, u) => s + statSum(u), 0);
  const star = [...units].sort((a, b) => {
    const d = statSum(b) - statSum(a);
    if (d !== 0) return d;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  })[0];
  return { unit: star, share: total > 0 ? statSum(star) / total : 0 };
}

function inPaint(unit) {
  // Home defends the left hoop; back-line grid columns 0-1 are the paint.
  // If the unit has no placement yet, count it (stat-only evaluation).
  return unit.courtX === undefined || unit.courtX === null || unit.courtX <= 1;
}

function fillNote(template, name, value) {
  return String(template)
    .replaceAll('{name}', name != null ? String(name) : 'nobody')
    .replaceAll('{value}', value != null ? String(round(value, 1)) : '?');
}

// ── personnel modifier evaluation ───────────────────────────────────────────

/**
 * Evaluate one personnel modifier from schemes.json.
 * @returns {{ delta: number, note: string|null }} delta is a signed fraction
 * (e.g. +0.03 = +3%); note is a filled-in human string or null when the
 * modifier is silent (empty units or negligible effect).
 */
function evaluateModifier(mod, ownUnits, oppUnits) {
  const units = mod.target === 'opponent' ? oppUnits : ownUnits;
  if (!units || !units.length) return { delta: 0, note: null };

  let delta = 0;
  let name = null;
  let value = null;
  let template = mod.note;

  switch (mod.type) {
    case 'avgStat': {
      value = avgStat(units, mod.stat);
      delta = clamp((value - mod.baseline) * mod.perPoint, -mod.cap, mod.cap);
      break;
    }
    case 'topStat': {
      const top = sortByStat(units, mod.stat)[0];
      name = top.name;
      value = getStat(top, mod.stat);
      delta = clamp((value - mod.baseline) * mod.perPoint, -mod.cap, mod.cap);
      break;
    }
    case 'topTwoAvgStat': {
      const sorted = sortByStat(units, mod.stat);
      const pair = sorted.slice(0, Math.min(2, sorted.length));
      value = pair.reduce((s, u) => s + getStat(u, mod.stat), 0) / pair.length;
      name = pair[0].name;
      delta = clamp((value - mod.baseline) * mod.perPoint, -mod.cap, mod.cap);
      break;
    }
    case 'minStat': {
      const sorted = sortByStat(units, mod.stat);
      const weakest = sorted[sorted.length - 1];
      name = weakest.name;
      value = getStat(weakest, mod.stat);
      delta = clamp((value - mod.baseline) * mod.perPoint, -mod.cap, mod.cap);
      break;
    }
    case 'statSpreadInverse': {
      const sorted = sortByStat(units, mod.stat);
      value = getStat(sorted[0], mod.stat) - getStat(sorted[sorted.length - 1], mod.stat);
      delta = clamp((mod.baseline - value) * mod.perPoint, -mod.cap, mod.cap);
      break;
    }
    case 'paintAnchor': {
      const candidates = sortByStat(
        units.filter((u) => getStat(u, mod.stat) >= mod.threshold && inPaint(u)),
        mod.stat,
      );
      if (!candidates.length) {
        return { delta: -mod.missingPenalty, note: mod.missingNote || null };
      }
      name = candidates[0].name;
      value = getStat(candidates[0], mod.stat);
      delta = clamp((value - mod.baseline) * mod.perPoint, 0, mod.cap);
      break;
    }
    case 'hubBig': {
      const candidates = units
        .filter(
          (u) => getStat(u, 'defense') >= mod.defenseMin && getStat(u, 'shooting') >= mod.shootingMin,
        )
        .sort((a, b) => {
          const score = (u) => (getStat(u, 'defense') + getStat(u, 'shooting')) / 2;
          const d = score(b) - score(a);
          if (d !== 0) return d;
          return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
      if (!candidates.length) {
        return { delta: -mod.missingPenalty, note: mod.missingNote || null };
      }
      name = candidates[0].name;
      value = (getStat(candidates[0], 'defense') + getStat(candidates[0], 'shooting')) / 2;
      delta = clamp((value - mod.baseline) * mod.perPoint, 0, mod.cap);
      break;
    }
    case 'starShare': {
      const { unit, share } = starShare(units);
      name = unit ? unit.name : null;
      value = share * 100;
      delta = clamp((share - mod.baseline) * mod.scale, -mod.cap, mod.cap);
      break;
    }
    default:
      return { delta: 0, note: null };
  }

  const note = Math.abs(delta) >= 0.005 ? fillNote(template, name, value) : null;
  return { delta, note };
}

// ── validation ──────────────────────────────────────────────────────────────

function requireOffense(id) {
  const o = OFFENSES.get(id);
  if (!o) {
    throw new Error(
      `Unknown offense "${id}". Valid offenses: ${[...OFFENSES.keys()].join(', ')}`,
    );
  }
  return o;
}

function requireCoverage(id) {
  const c = COVERAGES.get(id);
  if (!c) {
    throw new Error(
      `Unknown coverage "${id}". Valid coverages: ${[...COVERAGES.keys()].join(', ')}`,
    );
  }
  return c;
}

function pct(delta) {
  const p = round(delta * 100, 1);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Resolve one round's scheme matchup from the offense's point of view.
 *
 * @param {string} myOffense    offense id (e.g. 'spread_pnr')
 * @param {string} theirCoverage coverage id (e.g. 'drop')
 * @param {Array}  myUnits      my on-court units
 * @param {Array}  theirUnits   opponent on-court units
 * @returns {{ offenseMultiplier: number, base: number, notes: string[] }}
 *   offenseMultiplier scales my shot quality / scoring efficiency this round;
 *   notes are insider-lingo explanations of WHY, ready for the post-round
 *   box-score panel.
 */
export function resolveMatchup(myOffense, theirCoverage, myUnits = [], theirUnits = []) {
  const offense = requireOffense(myOffense);
  const coverage = requireCoverage(theirCoverage);
  const entry = offense.counters[coverage.id];
  const base = entry.multiplier;

  const notes = [`${offense.name} vs ${coverage.name}: ${entry.note}`];

  let offSum = 0;
  for (const mod of offense.personnel || []) {
    const { delta, note } = evaluateModifier(mod, myUnits, theirUnits);
    offSum += delta;
    if (note) notes.push(`${note} (${pct(delta)} offense)`);
  }

  let covSum = 0;
  for (const mod of coverage.personnel || []) {
    // Coverage personnel are evaluated with the DEFENDERS as "own" units.
    const { delta, note } = evaluateModifier(mod, theirUnits, myUnits);
    covSum += delta;
    if (note) notes.push(`Their ${coverage.name}: ${note} (${pct(-delta)} to your offense)`);
  }

  const raw = base * (1 + offSum) * (1 - covSum);
  const offenseMultiplier = round(clamp(raw, FINAL_CLAMP.min, FINAL_CLAMP.max));

  return { offenseMultiplier, base, notes };
}

/**
 * Rank all coverages against an opponent board — learning by suggestion, not
 * auto-play: the UI shows the ranked list with reasoning, the player decides.
 *
 * Deterministic: same units in, same ranking out (ties break on coverage id).
 *
 * @param {Array} opponentUnits opponent on-court units
 * @returns {Array<{ coverage: string, name: string, score: number, reasoning: string }>}
 */
export function suggestCoverage(opponentUnits = []) {
  const shooting = avgStat(opponentUnits, 'shooting');
  const speed = avgStat(opponentUnits, 'speed');
  const star = starShare(opponentUnits);
  const fastest = opponentUnits.length ? sortByStat(opponentUnits, 'speed')[0] : null;
  const topSpeed = fastest ? getStat(fastest, 'speed') : 0;
  const sharePct = round(star.share * 100, 0);
  const starName = star.unit ? star.unit.name : 'their best player';

  const rows = [
    {
      coverage: 'drop',
      score: (52 - shooting) * 0.6 + (speed - 50) * 0.35,
      reasoning:
        `They average ${round(shooting, 0)} shooting and ${round(speed, 0)} speed — Drop walls off the rim, ` +
        `keeps your floor balance against their pace, and lives with the pull-up jumpers they'd have to make.`,
    },
    {
      coverage: 'ice',
      score: (topSpeed - 55) * 0.5 + (shooting - 50) * 0.15,
      reasoning:
        `${fastest ? fastest.name : 'Their handler'} (${round(topSpeed, 0)} speed) wants to turn the corner — ` +
        `ICE forces him down the sideline and uses the baseline as a sixth defender.`,
    },
    {
      coverage: 'switch',
      score: (shooting - 50) * 0.55 - (star.share - 0.26) * 100 * 0.3,
      reasoning:
        `Their floor shoots ${round(shooting, 0)} on average — Switch Everything keeps a body attached to every ` +
        `shooter through every screen, betting they can't punish the mismatches.`,
    },
    {
      coverage: 'blitz',
      score: (star.share - 0.26) * 100 * 1.6,
      reasoning:
        `${starName} carries ${sharePct}% of their board's production — Blitz rips the ball out of exactly those ` +
        `hands and gambles that the leftovers can't beat you 4-on-3.`,
    },
    {
      coverage: 'zone23',
      score: (50 - shooting) * 0.7 + (48 - speed) * 0.3,
      reasoning:
        `At ${round(shooting, 0)} average shooting they can't reliably beat you from outside — a 2-3 Zone packs ` +
        `the paint and dares them to try.`,
    },
  ];

  return rows
    .map((r) => ({
      coverage: r.coverage,
      name: COVERAGES.get(r.coverage).name,
      score: round(r.score, 2),
      reasoning: r.reasoning,
    }))
    .sort((a, b) => (b.score - a.score) || a.coverage.localeCompare(b.coverage));
}

/** Coverage that most suppresses the given offense (the "book answer"). */
function bestCoverageAgainst(offenseId) {
  const offense = requireOffense(offenseId);
  const best = Object.entries(offense.counters).sort(
    (a, b) => (a[1].multiplier - b[1].multiplier) || a[0].localeCompare(b[0]),
  )[0];
  return COVERAGES.get(best[0]);
}

/** Offense that most exploits the given coverage. */
function bestOffenseAgainst(coverageId) {
  requireCoverage(coverageId);
  const best = schemesData.offenses
    .map((o) => [o, o.counters[coverageId].multiplier])
    .sort((a, b) => (b[1] - a[1]) || a[0].id.localeCompare(b[0].id))[0];
  return best[0];
}

/**
 * Grade the player's tactical read after a round and name the concept they
 * used or missed — the post-round feedback loop.
 *
 * @param {{ offense: string, coverage: string }} playerChoice what the player called
 * @param {{ offense: string, coverage: string, units?: Array }} opponentBoard what they walked into
 * @returns {{ grade: 'A'|'B'|'C'|'D', score: number, lesson: string, concepts: string[] }}
 */
export function gradeRead(playerChoice, opponentBoard) {
  const myOff = requireOffense(playerChoice.offense);
  const myCov = requireCoverage(playerChoice.coverage);
  const theirOff = requireOffense(opponentBoard.offense);
  const theirCov = requireCoverage(opponentBoard.coverage);

  // How well my offense read their coverage, and my coverage read their offense.
  const offEdge = myOff.counters[theirCov.id].multiplier - 1;
  const defEdge = 1 - theirOff.counters[myCov.id].multiplier;

  // Did the player land on the personnel-aware book suggestion?
  const suggested = suggestCoverage(opponentBoard.units || []);
  const tookSuggestion = suggested.length > 0 && suggested[0].coverage === myCov.id;
  const bonus = tookSuggestion ? 0.03 : 0;

  const score = round(offEdge + defEdge + bonus);
  const grade = score >= 0.12 ? 'A' : score >= 0.04 ? 'B' : score >= -0.04 ? 'C' : 'D';

  const parts = [];

  if (offEdge >= 0.04) {
    parts.push(
      `Sharp call: ${myOff.name} into their ${theirCov.name}. ${myOff.counters[theirCov.id].note}`,
    );
  } else if (offEdge <= -0.04) {
    const better = bestOffenseAgainst(theirCov.id);
    parts.push(
      `Your ${myOff.name} walked into its counter — ${myOff.counters[theirCov.id].note} ` +
        `Against ${theirCov.name}, the book answer is ${better.name}: ${better.translation}`,
    );
  } else {
    parts.push(`${myOff.name} vs ${theirCov.name} is a coin-flip matchup — this round came down to talent.`);
  }

  if (defEdge >= 0.04) {
    parts.push(
      `Defensively you read it: ${myCov.name} is exactly what ${theirOff.name} hates. ` +
        `${theirOff.counters[myCov.id].note}`,
    );
  } else if (defEdge <= -0.04) {
    const book = bestCoverageAgainst(theirOff.id);
    parts.push(
      `Their ${theirOff.name} beat your ${myCov.name} — ${theirOff.counters[myCov.id].note} ` +
        `The book answer is ${book.name}: ${book.translation}`,
    );
  } else {
    parts.push(`Your ${myCov.name} held serve against their ${theirOff.name} — no edge either way.`);
  }

  if (tookSuggestion) {
    parts.push(`Scouting bonus: ${myCov.name} was also the personnel read against their board.`);
  }

  return {
    grade,
    score,
    lesson: parts.join(' '),
    concepts: [...new Set([myOff.id, myCov.id, theirOff.id, theirCov.id])],
  };
}

/** Lightweight scheme listing for planning-phase pickers. */
export function listSchemes() {
  const brief = (s) => ({ id: s.id, name: s.name, translation: s.translation, lingo: s.lingo });
  return {
    offenses: schemesData.offenses.map(brief),
    coverages: schemesData.coverages.map(brief),
  };
}

/** Full scheme record (offense or coverage) by id, or null. */
export function getScheme(id) {
  return OFFENSES.get(id) || COVERAGES.get(id) || null;
}

export const schemes = schemesData;

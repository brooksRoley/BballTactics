/**
 * kits.js — Full Court ability kits, derived from a roster player's stats.
 *
 * Every player gets the same four slots (Q step-back, W burst, E closeout,
 * R signature). The numbers come from that player's shooting, speed and
 * defense, so the 29-player Hardwood roster yields 29 different kits without
 * hand-authoring each one. See docs/design/full-court.md.
 *
 * Pure data: no DOM, no Vue. Runs under plain `node` for tests.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Stat on a 0-100 scale, defaulting to league-average 50 when missing. */
export const stat = (player, key) => {
  const v = player && player.stats ? player.stats[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 100) : 50;
};

/** 0..1 position of a stat between a poor (25) and an elite (80) value. */
const grade = (v) => clamp((v - 25) / 55, 0, 1);

export const SIGNATURES = {
  shooting: {
    id: 'limitless',
    name: 'Limitless Range',
    blurb: 'Threes from anywhere, no distance penalty.',
  },
  speed: {
    id: 'fastbreak',
    name: 'Fast Break',
    blurb: 'Your whole team runs faster.',
  },
  defense: {
    id: 'wall',
    name: 'The Wall',
    blurb: 'Opponents near you shoot far worse.',
  },
};

/** The stat a player's ultimate is built on: their highest, ties to shooting. */
export function signatureStat(player) {
  const s = stat(player, 'shooting');
  const sp = stat(player, 'speed');
  const d = stat(player, 'defense');
  if (s >= sp && s >= d) return 'shooting';
  if (d >= sp) return 'defense';
  return 'speed';
}

/**
 * Build a player's kit. Cooldowns are seconds, costs are stamina points,
 * distances are court pixels (the court is 800 x 400).
 */
export function buildKit(player) {
  const sh = grade(stat(player, 'shooting'));
  const sp = grade(stat(player, 'speed'));
  const df = grade(stat(player, 'defense'));
  const sigKey = signatureStat(player);
  const sig = SIGNATURES[sigKey];

  return {
    Q: {
      key: 'Q',
      id: 'stepback',
      name: 'Step-back',
      blurb: 'Dash away from the cursor; a defender on you stumbles. Your next shot ignores part of the contest and the deep-three penalty.',
      cooldown: Math.round(lerp(7, 4.5, sh) * 10) / 10,
      cost: 15,
      distance: Math.round(lerp(45, 75, sh)),
      contestIgnore: Math.round(lerp(0.35, 0.7, sh) * 100) / 100,
      window: 1.5,
      needsBall: true,
    },
    W: {
      key: 'W',
      id: 'burst',
      name: 'Burst',
      blurb: 'A quick speed boost. With the ball you are harder to strip; on defense your reach-ins are likelier.',
      cooldown: Math.round(lerp(10, 6, sp) * 10) / 10,
      cost: 20,
      duration: 2,
      speedBonus: Math.round(lerp(0.3, 0.65, sp) * 100) / 100,
      needsBall: false,
    },
    E: {
      key: 'E',
      id: 'closeout',
      name: 'Closeout',
      blurb: 'Dash at the cursor. Land on the ball to smother the shot, or on your man to deny him the ball.',
      cooldown: Math.round(lerp(9, 5.5, df) * 10) / 10,
      cost: 20,
      distance: Math.round(lerp(70, 130, df)),
      lockRadius: 40,
      lockDuration: 2.5,
      contestBonus: Math.round(lerp(0.2, 0.45, df) * 100) / 100,
      stealBonus: Math.round(lerp(0.08, 0.2, df) * 100) / 100,
      needsBall: false,
      defenseOnly: true,
    },
    R: {
      key: 'R',
      id: sig.id,
      stat: sigKey,
      name: sig.name,
      blurb: sig.blurb,
      cooldown: 40,
      cost: 40,
      duration: 6,
      // Fast Break: team speed bonus. The Wall: radius and shot penalty.
      teamSpeedBonus: Math.round(lerp(0.2, 0.4, sp) * 100) / 100,
      wallRadius: Math.round(lerp(80, 110, df)),
      wallPenalty: Math.round(lerp(0.25, 0.45, df) * 100) / 100,
      needsBall: false,
    },
  };
}

/** Base movement speed in px/s, from the speed stat (crossing 800px takes ~4-6s). */
export const moveSpeed = (player) => Math.round(lerp(135, 195, grade(stat(player, 'speed'))));

export const SLOTS = ['Q', 'W', 'E', 'R'];

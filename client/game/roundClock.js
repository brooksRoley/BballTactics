// Round clock for an Autochess fight, shared by CourtCanvas.vue (the game) and
// scripts/balance-sweep.mjs (the balance sweep) so the sweep can't drift from
// what players watch.
//
// Durations are seconds on screen; the engine runs SIM_SPEED times faster, so
// regulation is ROUND_SECONDS * SIM_SPEED seconds of basketball. A tie at the
// horn goes to sudden-death overtime (next basket wins) for up to OT_SECONDS
// on screen; still tied after that counts as a home loss.
//
// 2026-11-04: 20 s on screen (50 s of sim) replaced 12 s (30 s of sim), same
// 2.5x speed. Once shots and passes travelled, 30 s produced about 4 points a
// round; see docs/design/balance-2026-11-04.md for the sweep behind this.
export const ROUND_SECONDS = 20;
export const OT_SECONDS = 6;
export const SIM_SPEED = 2.5;

export const REGULATION_SIM_SECONDS = ROUND_SECONDS * SIM_SPEED;
export const OT_SIM_SECONDS = OT_SECONDS * SIM_SPEED;

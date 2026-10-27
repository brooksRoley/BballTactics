/**
 * onboarding.js — the first possession teaches. Three contextual hints, in
 * order: move, get the ball, shoot (or step back). Each one clears when the
 * player does the thing, not on a timer. Shown once per browser; skippable.
 *
 * Pure apart from the storage helpers, which take the storage object as an
 * argument and swallow its errors (private windows, blocked site data).
 */

export const HINTS_KEY = 'bballtactics.fullCourt.hintsSeen.v1';

// `text` is for a mouse and keyboard, `touchText` for a phone or tablet
// (a coarse pointer, or the last input was a touch): see hintText().
export const HINT_STEPS = [
  {
    id: 'move', title: 'Move',
    text: 'Right-click the court to run there. Hold it to keep steering.',
    touchText: 'Tap the court to run there. Keep your finger down to steer.',
  },
  {
    id: 'ball', title: 'Get the ball',
    text: 'Get away from your defender, then left-click the ball carrier to call for it.',
    touchText: 'Get away from your defender, then tap the ball carrier to call for it.',
  },
  {
    id: 'shoot', title: 'Shoot or step back',
    text: 'Space shoots: the % by your player is your chance. Crowded? Q steps back first.',
    touchText: 'Tap Shoot: the % by your player is your chance. Crowded? Q steps back first.',
  },
];

/** The copy for a hint step on this input: touch copy on touch screens. */
export const hintText = (step, touch = false) => (touch && step.touchText ? step.touchText : step.text);

/** The one-line controls card, for the pick screen. */
export const controlsLine = (touch = false) => (touch
  ? 'Tap to move · Tap a teammate to pass or call for it, the ball carrier to reach · Shoot and Q W E R buttons aim where you last tapped'
  : 'Right-click to move · Space to shoot · Left-click a teammate to pass, the ball carrier to reach · Q W E R aim at the cursor · Esc pauses');

/**
 * The coach prompt (match.js coachPrompt) is written for a mouse and
 * keyboard; on touch, say the same thing in taps.
 */
export function forTouch(text) {
  if (!text) return text;
  return text
    .replace(/left-click to pass/g, 'tap him to pass')
    .replace(/right-click|left-click/g, 'tap')
    .replace(/\(Space, /g, '(')
    .replace(/Space shoots/g, 'Shoot is');
}

/** A fresh hint run: step 0 of HINT_STEPS, not finished. */
export const startHints = () => ({ step: 0, done: false, skipped: false });

/**
 * Advance the hints on one signal from the game:
 *   { type: 'move' }               the player issued a move
 *   { type: 'hasBall' }            the player is holding the ball
 *   { type: 'shot' } / { type: 'cast', slot: 'Q' }   shot or stepped back
 *   { type: 'skip' }               the player dismissed the hints
 * Signals for a later step are ignored until the earlier ones clear, except
 * that holding the ball also clears "move" (you clearly found the controls).
 */
export function advanceHints(state, signal) {
  if (!state || state.done || !signal) return state;
  if (signal.type === 'skip') return { step: state.step, done: true, skipped: true };
  const id = HINT_STEPS[state.step].id;
  const next = () => (state.step + 1 >= HINT_STEPS.length ? { step: state.step, done: true, skipped: false } : { step: state.step + 1, done: false, skipped: false });
  if (id === 'move' && (signal.type === 'move' || signal.type === 'hasBall')) {
    const s = next();
    return signal.type === 'hasBall' ? advanceHints(s, signal) : s;
  }
  if (id === 'ball' && signal.type === 'hasBall') return next();
  if (id === 'shoot' && (signal.type === 'shot' || (signal.type === 'cast' && signal.slot === 'Q'))) return next();
  return state;
}

/** Has this browser already seen (or skipped) the hints? False when storage fails. */
export function hintsSeen(storage) {
  try {
    return !!storage && storage.getItem(HINTS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the hints were shown. Silently does nothing when storage fails. */
export function markHintsSeen(storage) {
  try {
    if (storage) storage.setItem(HINTS_KEY, '1');
  } catch {
    // Private mode or blocked storage: the hints may show again next visit.
  }
}

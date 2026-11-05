/**
 * Two-step sell for bench cards.
 *
 * A single tap on a bench card used to hit its Sell button and sell the
 * player outright (no undo). Selling now takes two presses on the same
 * player's Sell control within SELL_CONFIRM_MS: the first press only arms it
 * ("Sell? 3G"), the second sells. Arming a different player, or waiting out
 * the window, starts over. Pure functions over a tiny state value so the
 * rules are testable without a DOM:
 *
 *   state = null | { id, at }   // which player's Sell is armed, and when
 */
export const SELL_CONFIRM_MS = 3000;

/**
 * Apply one press of a player's Sell control.
 * @returns {{ state: null | { id, at }, sell: boolean }}
 */
export function pressSell(state, id, now, windowMs = SELL_CONFIRM_MS) {
  if (state && state.id === id && now - state.at <= windowMs) {
    return { state: null, sell: true };
  }
  return { state: { id, at: now }, sell: false };
}

/** The id whose Sell is armed at `now`, or null once the window has passed. */
export function armedSellId(state, now, windowMs = SELL_CONFIRM_MS) {
  if (!state) return null;
  return now - state.at <= windowMs ? state.id : null;
}

/** Button text and accessible name for a player's Sell control. */
export function sellLabel(armed, value, name) {
  return armed
    ? { text: `Sell? ${value}G`, aria: `Confirm: sell ${name} for ${value} gold` }
    : { text: `Sell ${value}G`, aria: `Sell ${name} for ${value} gold (press twice to confirm)` };
}

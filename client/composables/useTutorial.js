// useTutorial.js
// -----------------------------------------------------------------------------
// "Front Office 101" — an adaptive, guide-don't-gate onboarding coach.
//
// This is a pure presentation-layer state machine. It knows nothing about the
// WASM engine; the real screens (draft shop, court placement, prefight coverage)
// call its event hooks, and it responds with a Coach Miller line + a real-world
// "skill tag" that frames each mechanic as a transferable skill:
//
//   draft      -> resource allocation / opportunity cost
//   placement  -> expected-value thinking (shot value)
//   coverage   -> strategic adaptation / game theory
//
// It never blocks or scolds — the acts advance on natural progress, and any
// "suboptimal" choice just earns a coaching comment. Completion is remembered in
// localStorage so returning players aren't re-taught (they can Replay).
// -----------------------------------------------------------------------------

import { reactive } from 'vue';

const STORAGE_KEY = 'bball_onboarded';

const isOnboarded = () => {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
};
const setOnboarded = () => { try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode */ } };
const clearOnboarded = () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ } };

const SKILL = {
  cap: 'Real-world skill: budgeting & opportunity cost — every choice spends a limited resource.',
  ev: 'Real-world skill: expected-value thinking — weigh the payoff, not just the effort.',
  adapt: 'Real-world skill: strategic adaptation — the best move depends on your opponent.',
};

export function useTutorial() {
  // A single reactive object (not refs) so property access like `tutorial.active`
  // stays reactive in both templates and script without manual unwrapping.
  const state = reactive({
    active: false,
    act: 'draft', // 'draft' | 'placement' | 'coverage' | 'done'
    message: '',
    skillTag: '',
  });
  let completeTimer = null;

  const set = (msg, tag) => { state.message = msg; if (tag !== undefined) state.skillTag = tag; };

  const enterDraft = () => {
    state.act = 'draft';
    set(
      "Welcome to the front office. That 10G is your salary cap — a hard limit. Every signing spends it, and money here is money you can't spend there. Draft a squad that fits the budget.",
      SKILL.cap,
    );
  };

  const enterPlacement = () => {
    state.act = 'placement';
    set(
      "Now set your lineup on the floor. The glow is shot value — the rim and the corners are bright and efficient; the dim mid-range is the worst shot in basketball. Put your players where the good shots are.",
      SKILL.ev,
    );
  };

  const enterCoverage = () => {
    state.act = 'coverage';
    set(
      "Before tip, call your coverage. There's no single right answer here — you're taking away what THEY do best. Read the matchup and adapt.",
      SKILL.adapt,
    );
  };

  const maybeStart = () => {
    if (isOnboarded()) { state.active = false; return; }
    state.active = true;
    enterDraft();
  };
  const replay = () => { clearOnboarded(); state.active = true; enterDraft(); };
  const skip = () => { state.active = false; clearTimeout(completeTimer); setOnboarded(); };
  const complete = () => { state.active = false; state.act = 'done'; setOnboarded(); };

  // ── Event hooks (guide, don't gate) ────────────────────────────────
  const onPlayerBought = (player, { goldLeft = 0, rosterCount = 0 } = {}) => {
    if (!state.active || state.act !== 'draft') return;
    if (player && player.cost >= 5 && (goldLeft <= 2 || rosterCount <= 1)) {
      set(
        "A supermax eats your whole cap. Elite talent wins games — but titles need a rotation, not one hero. Balance the star with role players who fit around him.",
        SKILL.cap,
      );
    } else if (rosterCount >= 3) {
      // Enough bodies to field a lineup — shift the lesson to placement.
      enterPlacement();
    } else {
      set(`Nice pickup — ${goldLeft}G left. Keep one eye on the cap as you round out the squad.`);
    }
  };

  const onPlayerPlaced = ({ onCourtCount = 0, zoneWarmth = null } = {}) => {
    if (!state.active) return;
    if (state.act === 'draft') enterPlacement();
    if (state.act !== 'placement') return;
    if (zoneWarmth != null && zoneWarmth < 0.34) {
      set(
        "That's a cold spot — a long two is the lowest-value shot on the floor. Slide them toward the paint or a corner three.",
        SKILL.ev,
      );
    } else if (onCourtCount >= 3) {
      set("Lineup's set and the spacing looks good. Lock it in when you're ready to fight.");
    }
  };

  const onCoverageOpened = () => {
    if (!state.active) return;
    if (state.act !== 'coverage') enterCoverage();
  };

  const onCoverageSelected = () => {
    if (!state.active || state.act !== 'coverage') return;
    set(
      "Good read. Coverage is rock-paper-scissors — the right call depends on the offense. That instinct to size up a problem and adapt will serve you far beyond this court. You're ready, coach.",
      SKILL.adapt,
    );
    clearTimeout(completeTimer);
    completeTimer = setTimeout(complete, 3600);
  };

  // Tip-off ends onboarding: the player has seen every act, and a coach card
  // left up through the fight covers the scoreboard (Start Fight without
  // changing coverage never fired onCoverageSelected).
  const onFightStarted = () => {
    if (!state.active) return;
    clearTimeout(completeTimer);
    complete();
  };

  // Attach methods onto the reactive state so consumers can use one object:
  // tutorial.active (reactive) and tutorial.replay() (method) both work.
  return Object.assign(state, {
    maybeStart, replay, skip, complete,
    onPlayerBought, onPlayerPlaced, onCoverageOpened, onCoverageSelected, onFightStarted,
  });
}

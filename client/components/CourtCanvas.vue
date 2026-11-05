<template>
  <div class="sim-container">
    <div class="sim-header">
      <div class="team-score home">YOU: {{ homeScore }}</div>
      <div class="sim-timer" :class="{ overtime }">{{ overtime ? 'OT ' : '' }}{{ timeLeft.toFixed(1) }}s</div>
      <div class="team-score away">OPP: {{ awayScore }}</div>
    </div>

    <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <div ref="courtCanvas"
           class="court-canvas"
           :style="{ width: COURT_W + 'px', height: COURT_H + 'px', transform: `scale(${courtScale})`, transformOrigin: 'top left' }">
      </div>
    </div>

    <!-- Pre-fight: the coverage called on the scouting report, shown on the floor -->
    <div v-if="simPhase === 'prefight'" class="coverage-panel">
      <div class="coverage-head">
        <span class="coverage-coach">COACH MILLER</span>
        <span class="coverage-preview-tag">OUR CALL</span>
      </div>
      <p class="coverage-call">
        <strong class="cc-name">{{ call.name }}</strong>
        <span class="cc-tag">{{ call.tagline }}</span>
      </p>
      <p class="coverage-blurb">
        Against their offense it {{ call.effectText }}.
        The glow on <strong>their</strong> end shows the shots it allows and takes away:
        <span class="warm-key">warm = we send them here</span>,
        <span class="cool-key">cool = we take it away</span>.
      </p>
      <button class="coverage-start" data-sfx="none" @click="startFight">Start Fight</button>
    </div>

    <div v-else class="sim-status">{{ statusText }}</div>
  </div>
</template>

<script>
import { ref, shallowRef, computed, onMounted, onUnmounted, inject, unref } from 'vue';
import { createFallbackSim } from '../game/fallbackSim.js';
import { createFixedStepper, interpolateState, SNAP_DIST } from '../game/interpolate.js';
import { detectEvents, isGameWinner, rimFor } from '../game/events.js';
import { sfx } from '../audio/sfx.js';
import { FEEL } from '../fx/feel.js';
import { ROUND_SECONDS, OT_SECONDS, SIM_SPEED } from '../game/roundClock.js';
import { coverageCall } from '../game/coveragePreview.js';

export default {
  props: {
    engine: { type: Object, default: null },
    courtLineup: { type: Array, default: () => [] },
    // Ghost board + tactics multipliers drive the JS backup ref when the
    // engine is missing (with the engine they're applied in syncEngineForRound)
    opponentUnits: { type: Array, default: () => [] },
    homeMultiplier: { type: Number, default: 1 },
    awayMultiplier: { type: Number, default: 1 },
    // The coverage called on the scouting report (schemes.json id). Its effect
    // on the sim is already in awayMultiplier; here it is only displayed.
    coverage: { type: String, default: 'drop' },
    roundStats: { type: Object, default: () => ({ playerScoring: [], events: [] }) }
  },
  emits: ['sim-complete', 'fight-started'],
  setup(props, { emit }) {
    // Sim state is replaced wholesale every frame and never read by the
    // template, so shallow refs skip deep-proxying a fresh array each frame.
    const livePlayers = shallowRef([]);
    const botPlayers = shallowRef([]);
    const ball = shallowRef({ x: 400, y: 200, z: 0, possessorId: -1, isPossessed: false });
    const homeScore = ref(0);
    const awayScore = ref(0);
    const timeLeft = ref(ROUND_SECONDS);
    const overtime = ref(false);
    const statusText = ref('Tip-off!');
    let animationFrameId = null;
    let lastTime = 0;
    let simDone = false;
    let fallback = null; // pure-JS backup ref, built only when the engine is missing
    let stepper = null;  // fixed-timestep driver, built on "Start Fight"
    let prevSimState = null; // last applied state, for game-feel event detection
    let lastMake = null;     // { team, tookLead, t } of the latest basket
    let fxTailRAF = null;    // renders the last effects out after the horn

    // Scoring attribution tracking
    const playerPoints = {};
    const eventLog = [];

    // The engine reports who made the basket; by the time we see the score
    // the ball already belongs to the inbounding team, so possession lies.
    let lastScorerId = -1;
    const attributeScore = (pts, isHome) => {
      const possId = lastScorerId >= 0 ? lastScorerId : ball.value.possessorId;
      if (isHome) {
        const scorer = livePlayers.value.find(p => p.id === possId);
        const name = scorer?.name || `Player ${possId}`;
        playerPoints[possId] = (playerPoints[possId] || { id: possId, name, points: 0 });
        playerPoints[possId].points += pts;
        const label = pts === 3 ? 'Three!' : 'Score!';
        const shortName = name.split(' ').pop();
        eventLog.push(`${shortName} hits a ${pts === 3 ? 'three-pointer' : 'bucket'} (+${pts})`);
        statusText.value = `${shortName} — ${label}`;
      } else {
        eventLog.push(`Opponent scores (+${pts})`);
        statusText.value = 'Opponent scores...';
      }
      setTimeout(() => { if (!simDone) statusText.value = ''; }, 1000);
    };

    const COURT_W = 800;
    const COURT_H = 400;
    // Round length lives in client/game/roundClock.js (shared with the
    // balance sweep): ROUND_SECONDS on screen at SIM_SPEED. A tie at the horn
    // goes to sudden-death overtime: next basket wins.
    const SIM_DURATION = ROUND_SECONDS;
    const OT_DURATION = OT_SECONDS;
    const SIM_SUBSTEP = 1 / 60;
    // Substeps per frame cap: the 50 ms dt clamp needs at most 8 (0.125 s of
    // sim); past that a stall's backlog is dropped, not replayed.
    const MAX_STEPS_PER_FRAME = 8;
    const dpr = Math.ceil(window.devicePixelRatio || 1);

    // ── Cosmetic shot-clock pressure ring ─────────────────────────
    // Purely visual: a ring around the ball-carrier that winds down and
    // heats up (blue → red). Never affects the simulation outcome.
    const SHOT_CLOCK_MAX = 6.0;
    const shotClock = ref(SHOT_CLOCK_MAX);
    let lastPossessionTeam = null;

    // ── Pre-fight coverage display ────────────────────────────────
    // simPhase gates the sim loop behind "Start Fight". The panel shows the
    // coverage called on the scouting report and its real effect (the
    // opponent multiplier the sim already uses); the glow pictures it.
    const simPhase = ref('prefight'); // 'prefight' | 'live'
    const call = computed(() => coverageCall(props.coverage, props.awayMultiplier));
    let flashT0 = 0;               // timestamp the glow started fading in
    let prefightRAF = null;

    // Opponent shot zones, positioned around THEIR basket (the left hoop —
    // the away team attacks left; see the fallback sim's target of x≈30).
    const COVERAGE_ZONES = [
      { key: 'rim',          label: 'RIM', cx: 58,  cy: 200, rx: 40, ry: 52 },
      { key: 'mid',          label: 'MID', cx: 128, cy: 200, rx: 46, ry: 72 },
      { key: 'cornerTop',    label: 'C3',  cx: 72,  cy: 56,  rx: 46, ry: 34 },
      { key: 'cornerBottom', label: 'C3',  cx: 72,  cy: 344, rx: 46, ry: 34 },
      { key: 'wing',         label: '3',   cx: 192, cy: 200, rx: 34, ry: 82 },
    ];

    const courtScaler = ref(null);
    const courtCanvas = ref(null);
    const courtScale = ref(1);
    let resizeObserver = null;
    let renderer = null;   // PixiJS CourtRenderer (lazy-loaded on mount)
    let unmounted = false;

    // inject() only works during setup, so resolve it once here. App
    // provides the engine *ref*, so unwrap it at call time.
    const injectedEngine = inject('engine', null);
    const getEngine = () => props.engine || unref(injectedEngine);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // ── Coverage glow (cosmetic) ──────────────────────────────────
    // Builds the per-zone draw data for the called coverage and hands it to
    // the Pixi renderer. Warm = attempts funnelled here, cool = taken away.
    // The flash envelope spikes on mount, then settles to a steady glow.
    const buildCoverage = () => {
      if (simPhase.value !== 'prefight') return null;
      const scheme = call.value;

      const elapsed = (performance.now() - flashT0) / 1000;
      let alpha;
      if (elapsed < 0.15) alpha = elapsed / 0.15;                 // 0 → 1
      else alpha = 0.55 + 0.45 * Math.exp(-(elapsed - 0.15) * 3); // → 0.55
      alpha = Math.min(1, alpha);

      return COVERAGE_ZONES.map((z) => {
        const e = scheme.effects[z.key] || 0;
        return {
          cx: z.cx, cy: z.cy, rx: z.rx, ry: z.ry, label: z.label,
          warm: e >= 0, mag: Math.abs(e), alpha,
        };
      });
    };

    // ── Frame render: delegate to the Pixi CourtRenderer ──────────
    // All drawing now lives in client/rendering/CourtRenderer.js. This just
    // packages sim state into plain data each frame. `view` is the
    // interpolated state from the sim loop; positions in it are final, the
    // renderer draws them as-is. Without one, the current sim state is drawn.
    const renderFrame = (view = null) => {
      if (!renderer) return;
      renderer.render({
        players: view ? view.players : livePlayers.value,
        bots: view ? view.bots : botPlayers.value,
        ball: (view && view.ball) || ball.value,
        phase: simPhase.value,
        coverage: buildCoverage(),
        shotClock: simPhase.value === 'live'
          ? { frac: clamp(shotClock.value / SHOT_CLOCK_MAX, 0, 1) }
          : null,
      });
    };

    // ── Game loop ─────────────────────────────────────────────────
    const syncLoop = (timestamp) => {
      if (simDone) return;

      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;
      timeLeft.value -= dt;

      if (timeLeft.value <= 0) {
        if (!overtime.value && homeScore.value === awayScore.value) {
          overtime.value = true;
          timeLeft.value = OT_DURATION;
          statusText.value = 'Overtime — next basket wins!';
        } else {
          timeLeft.value = 0;
          renderFrame();
          finishSim();
          return;
        }
      }

      // Fixed timestep: sim time only ever advances in exact SIM_SUBSTEP
      // slices (the frame just decides how many), so the same board plays
      // the same at 60 Hz and 120 Hz. Rendering blends the last two slices.
      const { steps, alpha } = stepper.advance(dt * SIM_SPEED);
      if (steps && stepper.cur) applySimState(stepper.cur);
      const view = interpolateState(stepper.prev, stepper.cur, alpha, SNAP_DIST);

      // ── Cosmetic shot-clock bookkeeping ────────────────────────
      // Infer possession boundaries from the ball-carrier's TEAM. When the
      // ball changes teams (a made basket resets possession, a steal/turnover
      // flips it) we reset the clock. A pass to a teammate keeps it running,
      // like a real shot clock. If it runs out it resets in place (a purely
      // cosmetic "violation"); it never alters the simulation.
      const pid = ball.value.possessorId;
      const team = (pid === undefined || pid < 0)
        ? null
        : (livePlayers.value.some(p => p.id === pid)
            ? 'home'
            : (botPlayers.value.some(bp => bp.id === pid) ? 'away' : null));
      if (team && team !== lastPossessionTeam) {
        shotClock.value = SHOT_CLOCK_MAX;
        lastPossessionTeam = team;
      } else if (team) {
        shotClock.value -= dt;
        if (shotClock.value <= 0) shotClock.value = SHOT_CLOCK_MAX;
      }

      renderFrame(view);

      // Sudden death: the first basket of overtime ends it
      if (overtime.value && homeScore.value !== awayScore.value) {
        finishSim();
        return;
      }
      animationFrameId = requestAnimationFrame(syncLoop);
    };

    // Engine (WASM) or backup ref (pure JS over the real ghost board with the
    // round's tactics multipliers, see client/game/fallbackSim.js).
    const readSimState = () => {
      const engine = getEngine();
      if (engine) {
        try { return JSON.parse(engine.GetGameStateJSON()); } catch (e) { return null; /* no state yet */ }
      }
      return fallback ? fallback.getState() : null;
    };
    const tickSim = (dt) => {
      const engine = getEngine();
      if (engine) engine.TickSimulation(dt);
      else if (fallback) fallback.step(dt);
    };

    // The engine and the JS backup ref emit the same state shape, so one
    // apply path drives rendering, scoring, and attribution for both.
    const applySimState = (state) => {
      livePlayers.value = state.players || [];
      botPlayers.value  = state.bots    || [];
      if (state.ball) ball.value = state.ball;
      lastScorerId = state.lastScorerId ?? -1;

      const prevHome = homeScore.value;
      const prevAway = awayScore.value;
      homeScore.value = state.homeScore ?? homeScore.value;
      awayScore.value = state.awayScore ?? awayScore.value;

      if (homeScore.value > prevHome) {
        attributeScore(homeScore.value - prevHome, true);
      } else if (awayScore.value > prevAway) {
        attributeScore(awayScore.value - prevAway, false);
      }

      // Game-feel events (make / miss / steal) for the renderer's effects
      // layer. The "+N" floater rises from the scorer there. Cosmetic only.
      const events = detectEvents(prevSimState, state);
      prevSimState = state;
      for (const e of events) {
        if (e.type === 'make') {
          const [mine, theirs] = e.team === 'home'
            ? [homeScore.value, awayScore.value] : [awayScore.value, homeScore.value];
          const [mineBefore, theirsBefore] = e.team === 'home' ? [prevHome, prevAway] : [prevAway, prevHome];
          lastMake = { team: e.team, tookLead: mineBefore <= theirsBefore && mine > theirs, t: performance.now() / 1000 };
        }
        if (renderer) renderer.fx(e);
        sfx.forEvent(e);
      }
    };

    // The make that decided the round (the OT basket, or a go-ahead make at
    // the horn) gets the full-weight shake on top of the make's own.
    const markGameWinner = () => {
      if (!renderer) return;
      const won = isGameWinner(lastMake, {
        overtime: overtime.value,
        homeScore: homeScore.value,
        awayScore: awayScore.value,
        now: performance.now() / 1000,
        window: FEEL.shake.gameWinnerWindow,
      });
      if (won) {
        renderer.fx({ type: 'gameWinner', team: lastMake.team, hoop: rimFor(lastMake.team) });
        sfx.forEvent({ type: 'gameWinner' });
      }
    };

    // The sim loop stops at the final horn; keep rendering until the result
    // screen takes over so the last effects play out instead of freezing.
    const runFxTail = (until) => {
      if (unmounted || performance.now() > until) return;
      renderFrame();
      fxTailRAF = requestAnimationFrame(() => runFxTail(until));
    };

    const finishSim = () => {
      simDone = true;
      sfx.play('horn');
      markGameWinner();
      fxTailRAF = requestAnimationFrame(() => runFxTail(performance.now() + 1500));
      const outcome = homeScore.value > awayScore.value ? 'win' : 'loss';
      const ot = overtime.value ? ' in overtime' : '';
      statusText.value = outcome === 'win'
        ? `Final — You win${ot}!`
        : homeScore.value === awayScore.value
          ? 'Final — Still tied after OT: counts as a loss.'
          : `Final — You lose${ot}.`;

      // Build per-player scoring sorted by points
      const playerScoring = Object.values(playerPoints)
        .sort((a, b) => b.points - a.points);

      setTimeout(() => {
        emit('sim-complete', {
          outcome,
          homeScore: homeScore.value,
          awayScore: awayScore.value,
          overtime: overtime.value,
          playerScoring,
          events: eventLog,
        });
      }, 1500);
    };

    // Idle render loop while the coverage panel is up, so the glow
    // animates without running the simulation.
    const prefightLoop = () => {
      if (simPhase.value !== 'prefight') return;
      renderFrame();
      prefightRAF = requestAnimationFrame(prefightLoop);
    };

    const startFight = () => {
      if (simPhase.value !== 'prefight') return;
      cancelAnimationFrame(prefightRAF);
      simPhase.value = 'live';
      sfx.play('whistle');
      emit('fight-started');
      shotClock.value = SHOT_CLOCK_MAX;
      lastPossessionTeam = null;
      stepper = createFixedStepper({
        substep: SIM_SUBSTEP, maxSteps: MAX_STEPS_PER_FRAME,
        tick: tickSim, read: readSimState,
      });
      stepper.reset(readSimState());
      lastTime = performance.now();
      animationFrameId = requestAnimationFrame(syncLoop);
    };

    onMounted(async () => {
      if (getEngine()) {
        // Show the opening formation the engine built in StartRound
        try { applySimState(JSON.parse(getEngine().GetGameStateJSON())); } catch (e) { /* no state yet */ }
      } else {
        // The WASM engine failed to load: build the pure-JS backup ref so the
        // fight still happens against the actual ghost board, with the same
        // tactics multipliers the engine would have baked into shooting.
        fallback = createFallbackSim({
          homeUnits: props.courtLineup,
          awayUnits: props.opponentUnits,
          homeMultiplier: props.homeMultiplier,
          awayMultiplier: props.awayMultiplier,
          seed: Date.now() >>> 0,
        });
        applySimState(fallback.step(0));
        statusText.value = 'Backup ref — simplified sim';
      }
      lastTime = performance.now();
      timeLeft.value = SIM_DURATION;
      flashT0 = performance.now();

      const updateScale = () => {
        if (courtScaler.value) {
          courtScale.value = Math.min(1, courtScaler.value.clientWidth / COURT_W);
        }
      };
      updateScale();
      resizeObserver = new ResizeObserver(updateScale);
      if (courtScaler.value) resizeObserver.observe(courtScaler.value);

      // Lazy-load the WebGL renderer. Keeping PixiJS behind a dynamic import
      // means it only ships when a fight actually mounts this component — the
      // draft/planning screens stay light.
      try {
        const { CourtRenderer } = await import('../rendering/CourtRenderer.js');
        if (unmounted || !courtCanvas.value) return;
        renderer = new CourtRenderer(courtCanvas.value, {
          width: COURT_W, height: COURT_H, resolution: dpr,
        });
        await renderer.ready;
        if (unmounted) { renderer.destroy(); renderer = null; return; }
        // Show the coverage panel first; the sim loop starts on "Start Fight".
        renderFrame();
        prefightRAF = requestAnimationFrame(prefightLoop);
      } catch (e) {
        console.error('CourtRenderer failed to load', e);
      }
    });

    onUnmounted(() => {
      simDone = true;
      unmounted = true;
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(prefightRAF);
      cancelAnimationFrame(fxTailRAF);
      if (resizeObserver) resizeObserver.disconnect();
      if (renderer) { renderer.destroy(); renderer = null; }
    });

    return {
      homeScore, awayScore, timeLeft, overtime, statusText,
      courtScaler, courtCanvas, courtScale, COURT_W, COURT_H, dpr,
      simPhase, call, startFight,
    };
  }
};
</script>

<style scoped>
.sim-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.court-scaler {
  width: 100%;
  max-width: 800px;
  overflow: hidden;
}

.sim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 800px;
  padding: 8px 20px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
}
.team-score { font-size: 1.3rem; font-weight: bold; }
.team-score.home { color: #d9534f; }
.team-score.away { color: #5bc0de; }
.sim-timer { font-size: 1.5rem; font-variant-numeric: tabular-nums; color: #ffd700; }
.sim-timer.overtime { color: #ff7a45; }

.court-canvas {
  display: block;
  border-radius: 4px;
}

.sim-status {
  height: 24px;
  font-size: 1rem;
  color: #ffd700;
  font-weight: bold;
}

/* ── Pre-fight coverage panel ────────────────────────────────────── */
.coverage-panel {
  width: 100%;
  max-width: 800px;
  background: #1e1e1e;
  border: 2px solid #8b5a2b;
  border-left: 8px solid #d9534f;
  border-radius: 4px;
  padding: 14px 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}
.coverage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.coverage-coach {
  font-weight: 900;
  color: #d9534f;
  letter-spacing: 2px;
  font-size: 0.8rem;
}
.coverage-preview-tag {
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.15em;
  color: #121212;
  background: #ffd700;
  padding: 2px 8px;
  border-radius: 3px;
}
.coverage-blurb {
  margin: 0 0 12px;
  font-size: 0.82rem;
  line-height: 1.45;
  color: #cfcfcf;
}
.coverage-blurb strong { color: #fff; }
.warm-key { color: #ff9a52; font-weight: bold; }
.cool-key { color: #5f8cdc; font-weight: bold; }

.coverage-call {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 6px;
}
.cc-name {
  font-weight: 800;
  font-size: 1rem;
  color: #ffd700;
  letter-spacing: 0.04em;
}
.cc-tag {
  font-size: 0.78rem;
  color: #9a9a9a;
}

.coverage-start {
  display: block;
  width: 100%;
  padding: 11px 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: #d9534f;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.coverage-start:hover { background: #c9302c; }
</style>

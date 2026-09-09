<template>
  <div class="sim-container">
    <div class="sim-header">
      <div class="team-score home">YOU: {{ homeScore }}</div>
      <div class="sim-timer">{{ timeLeft.toFixed(1) }}s</div>
      <div class="team-score away">OPP: {{ awayScore }}</div>
    </div>

    <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <div ref="courtCanvas"
           class="court-canvas"
           :style="{ width: COURT_W + 'px', height: COURT_H + 'px', transform: `scale(${courtScale})`, transformOrigin: 'top left' }">
      </div>

      <!-- Floating event popups -->
      <div v-for="popup in activePopups"
           :key="popup.id"
           class="event-popup"
           :class="popup.type"
           :style="{ left: (popup.x * courtScale) + 'px', top: (popup.y * courtScale) + 'px' }">
        {{ popup.text }}
      </div>
    </div>

    <!-- Pre-fight defensive coverage picker (preview only) -->
    <div v-if="simPhase === 'prefight'" class="coverage-panel">
      <div class="coverage-head">
        <span class="coverage-coach">COACH MILLER</span>
        <span class="coverage-preview-tag">PREVIEW</span>
      </div>
      <p class="coverage-blurb">
        Call our coverage before tip. The glow on <strong>their</strong> end shows where we funnel them —
        <span class="warm-key">warm = we send them here</span>,
        <span class="cool-key">cool = we take it away</span>.
        <em>This is a preview only — the ref doesn't enforce it yet.</em>
      </p>
      <div class="coverage-options">
        <button
          v-for="s in COVERAGE_SCHEMES"
          :key="s.id"
          class="coverage-btn"
          :class="{ active: selectedSchemeId === s.id }"
          @click="selectScheme(s.id)"
        >
          <span class="cb-name">{{ s.name }}</span>
          <span class="cb-tag">{{ s.tagline }}</span>
        </button>
      </div>
      <button class="coverage-start" @click="startFight">Start Fight</button>
    </div>

    <div v-else class="sim-status">{{ statusText }}</div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, inject } from 'vue';

export default {
  props: {
    engine: { type: Object, default: null },
    courtLineup: { type: Array, default: () => [] },
    roundStats: { type: Object, default: () => ({ playerScoring: [], events: [] }) }
  },
  emits: ['sim-complete', 'coverage-opened', 'coverage-selected'],
  setup(props, { emit }) {
    const livePlayers = ref([]);
    const botPlayers = ref([]);
    const ball = ref({ x: 400, y: 200, z: 0, possessorId: -1, isPossessed: false });
    const homeScore = ref(0);
    const awayScore = ref(0);
    const timeLeft = ref(10.0);
    const statusText = ref('Tip-off!');
    const activePopups = ref([]);
    let popupCounter = 0;
    let animationFrameId = null;
    let lastTime = 0;
    let simDone = false;

    // Scoring attribution tracking
    const playerPoints = {};
    const eventLog = [];

    const spawnPopup = (x, y, text, type = 'score-home') => {
      const id = ++popupCounter;
      activePopups.value = [...activePopups.value, { id, x, y, text, type }];
      setTimeout(() => {
        activePopups.value = activePopups.value.filter(p => p.id !== id);
      }, 1200);
    };

    const attributeScore = (pts, isHome) => {
      const possId = ball.value.possessorId;
      if (isHome) {
        const scorer = livePlayers.value.find(p => p.id === possId);
        const name = scorer?.name || `Player ${possId}`;
        playerPoints[possId] = (playerPoints[possId] || { id: possId, name, points: 0 });
        playerPoints[possId].points += pts;
        const label = pts === 3 ? 'Three!' : 'Score!';
        const shortName = name.split(' ').pop();
        eventLog.push(`${shortName} hits a ${pts === 3 ? 'three-pointer' : 'bucket'} (+${pts})`);
        spawnPopup(ball.value.x, ball.value.y - 20, `+${pts}`, 'score-home');
        statusText.value = `${shortName} — ${label}`;
      } else {
        eventLog.push(`Opponent scores (+${pts})`);
        spawnPopup(ball.value.x, ball.value.y - 20, `+${pts}`, 'score-away');
        statusText.value = 'Opponent scores...';
      }
      setTimeout(() => { if (!simDone) statusText.value = ''; }, 1000);
    };

    const COURT_W = 800;
    const COURT_H = 400;
    const SIM_DURATION = 10.0;
    const dpr = Math.ceil(window.devicePixelRatio || 1);

    // ── Cosmetic shot-clock pressure ring ─────────────────────────
    // Purely visual: a ring around the ball-carrier that winds down and
    // heats up (blue → red). Never affects the simulation outcome.
    const SHOT_CLOCK_MAX = 6.0;
    const shotClock = ref(SHOT_CLOCK_MAX);
    let lastPossessionTeam = null;

    // ── Pre-fight coverage picker (preview only) ──────────────────
    // simPhase gates the existing sim loop behind a "Start Fight" button
    // so the player can preview a defensive scheme first. This is a
    // presentational layer — the WASM engine is not told about it.
    const simPhase = ref('prefight'); // 'prefight' | 'live'
    const selectedSchemeId = ref('drop');
    let flashT0 = 0;               // timestamp of the last preview flash
    let prefightRAF = null;

    // Effect value per opponent shot zone, in [-1, 1].
    // Positive = attempts ELEVATED / funnelled here (warm, brighter).
    // Negative = attempts SUPPRESSED / taken away (cool, dimmer).
    // Read from the DEFENSE's point of view: pushing an opponent toward
    // the low-value mid-range still reads "warm" because we WANT them there.
    const COVERAGE_SCHEMES = [
      { id: 'drop',   name: 'Drop',   tagline: 'Wall off the rim, live with mid-range.',
        effects: { rim: -0.85, mid:  0.85, cornerTop: -0.20, cornerBottom: -0.20, wing:  0.10 } },
      { id: 'switch', name: 'Switch', tagline: 'Switch 1–5, no blown coverages.',
        effects: { rim: -0.45, mid:  0.35, cornerTop: -0.55, cornerBottom: -0.55, wing: -0.35 } },
      { id: 'blitz',  name: 'Blitz',  tagline: 'Trap the ball, dare the pass.',
        effects: { rim:  0.60, mid: -0.45, cornerTop:  0.50, cornerBottom:  0.50, wing: -0.85 } },
      { id: 'ice',    name: 'ICE',    tagline: 'Force baseline, kill the corner three.',
        effects: { rim: -0.15, mid:  0.60, cornerTop: -0.90, cornerBottom: -0.90, wing:  0.25 } },
      { id: 'zone',   name: 'Zone',   tagline: 'Pack the paint, contest the arc late.',
        effects: { rim: -0.70, mid: -0.40, cornerTop:  0.70, cornerBottom:  0.70, wing:  0.65 } },
    ];

    // Opponent shot zones, positioned around THEIR basket (the left hoop —
    // the away team attacks left; see the fallback sim's target of x≈30).
    const COVERAGE_ZONES = [
      { key: 'rim',          label: 'RIM', cx: 58,  cy: 200, rx: 40, ry: 52 },
      { key: 'mid',          label: 'MID', cx: 128, cy: 200, rx: 46, ry: 72 },
      { key: 'cornerTop',    label: 'C3',  cx: 72,  cy: 56,  rx: 46, ry: 34 },
      { key: 'cornerBottom', label: 'C3',  cx: 72,  cy: 344, rx: 46, ry: 34 },
      { key: 'wing',         label: '3',   cx: 192, cy: 200, rx: 34, ry: 82 },
    ];

    const selectedScheme = () => COVERAGE_SCHEMES.find(s => s.id === selectedSchemeId.value) || null;

    const selectScheme = (id) => {
      selectedSchemeId.value = id;
      flashT0 = performance.now(); // re-trigger the preview flash
      emit('coverage-selected', id);
    };

    const courtScaler = ref(null);
    const courtCanvas = ref(null);
    const courtScale = ref(1);
    let resizeObserver = null;
    let renderer = null;   // PixiJS CourtRenderer (lazy-loaded on mount)
    let unmounted = false;

    const getEngine = () => props.engine || inject('engine', null);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const gridToSim = (gx, gy) => ({
      x: gx * 70 + 40,
      y: gy * 70 + 40
    });

    const spawnBots = () => {
      botPlayers.value = [
        { id: 901, x: 600, y: 80,  tx: 580, ty: 100 },
        { id: 902, x: 650, y: 200, tx: 620, ty: 180 },
        { id: 903, x: 580, y: 320, tx: 560, ty: 300 },
      ];
    };

    const initFallbackPlayers = () => {
      if (props.courtLineup.length === 0) return;
      livePlayers.value = props.courtLineup.map(p => {
        const sim = gridToSim(p.courtX, p.courtY);
        return {
          id: p.id,
          name: p.name,
          x: sim.x,
          y: sim.y,
          tx: 420 + Math.random() * 180,
          ty: 80 + Math.random() * 240,
          speed: (p.stats?.speed || 50) / 100 * 15,
          shooting: p.stats?.shooting || 50
        };
      });
    };

    // ── Coverage preview state (cosmetic) ─────────────────────────
    // Builds the per-zone draw data for the currently selected scheme and
    // hands it to the Pixi renderer. Warm = attempts elevated/funnelled here,
    // cool = attempts suppressed/taken away. The flash envelope spikes on
    // select, then settles to a steady glow so the active scheme stays legible.
    const buildCoverage = () => {
      if (simPhase.value !== 'prefight') return null;
      const scheme = selectedScheme();
      if (!scheme) return null;

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
    // packages the current sim state into plain data each frame; the WASM
    // engine and sim loop are untouched.
    const renderFrame = () => {
      if (!renderer) return;
      renderer.render({
        players: livePlayers.value,
        bots: botPlayers.value,
        ball: ball.value,
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
        timeLeft.value = 0;
        renderFrame();
        finishSim();
        return;
      }

      const engine = getEngine();
      if (engine) {
        engine.TickSimulation(dt);
        try {
          const state = JSON.parse(engine.GetGameStateJSON());
          livePlayers.value = state.players || [];
          botPlayers.value  = state.bots    || [];
          if (state.ball) ball.value = state.ball;

          const prevHome = homeScore.value;
          const prevAway = awayScore.value;
          homeScore.value = state.homeScore ?? homeScore.value;
          awayScore.value = state.awayScore ?? awayScore.value;

          if (homeScore.value > prevHome) {
            const pts = homeScore.value - prevHome;
            attributeScore(pts, true);
          } else if (awayScore.value > prevAway) {
            const pts = awayScore.value - prevAway;
            attributeScore(pts, false);
          }
        } catch (e) { /* engine may not have state yet */ }
      } else {
        // --- Fallback: simplified JS sim with possession tracking ---
        const BASKET_X = 770;
        const BASKET_Y = 200;

        livePlayers.value = livePlayers.value.map(p => {
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 2) {
            const step = (p.speed || 8) * dt;
            return { ...p, x: p.x + (dx / dist) * step, y: p.y + (dy / dist) * step };
          }
          return { ...p, tx: 450 + Math.random() * 200, ty: 80 + Math.random() * 240 };
        });

        const carrierId = ball.value.possessorId;
        const carrier = livePlayers.value.find(p => p.id === carrierId);
        if (carrier) {
          ball.value = { ...ball.value, x: carrier.x, y: carrier.y, z: 0 };
          carrier.tx = BASKET_X;
          carrier.ty = BASKET_Y;
          const distToBasket = Math.sqrt((carrier.x - BASKET_X) ** 2 + (carrier.y - BASKET_Y) ** 2);
          if (distToBasket < 100) {
            const shotProb = (carrier.shooting || 50) / 100 * 0.4;
            if (Math.random() < shotProb * dt * 2) {
              const pts = distToBasket > 200 ? 3 : 2;
              homeScore.value += pts;
              attributeScore(pts, true);
              if (botPlayers.value.length > 0) {
                ball.value = { ...ball.value, possessorId: botPlayers.value[0].id };
              }
            }
          }
        } else {
          const botCarrier = botPlayers.value.find(b => b.id === carrierId);
          if (botCarrier) {
            ball.value = { ...ball.value, x: botCarrier.x, y: botCarrier.y, z: 0 };
            botCarrier.tx = 30;
            botCarrier.ty = 200;
            const distToBasket = Math.sqrt((botCarrier.x - 30) ** 2 + (botCarrier.y - 200) ** 2);
            if (distToBasket < 100 && Math.random() < 0.3 * dt * 2) {
              const pts = Math.random() < 0.3 ? 3 : 2;
              awayScore.value += pts;
              attributeScore(pts, false);
              if (livePlayers.value.length > 0) {
                ball.value = { ...ball.value, possessorId: livePlayers.value[0].id };
              }
            }
          } else if (livePlayers.value.length > 0) {
            ball.value = { ...ball.value, possessorId: livePlayers.value[0].id };
          }
        }

        botPlayers.value = botPlayers.value.map(b => {
          const dx = b.tx - b.x;
          const dy = b.ty - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 3) return { ...b, x: b.x + (dx / dist) * 3, y: b.y + (dy / dist) * 3 };
          return { ...b,
            tx: clamp(b.x + (Math.random() - 0.5) * 200, 400, COURT_W - 40),
            ty: clamp(b.y + (Math.random() - 0.5) * 150, 20,  COURT_H - 40) };
        });
      }

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

      renderFrame();
      animationFrameId = requestAnimationFrame(syncLoop);
    };

    const finishSim = () => {
      simDone = true;
      const outcome = homeScore.value > awayScore.value ? 'win' : 'loss';
      statusText.value = outcome === 'win'
        ? 'Final — You win!'
        : homeScore.value === awayScore.value
          ? 'Final — Draw counts as a loss!'
          : 'Final — You lose.';

      // Build per-player scoring sorted by points
      const playerScoring = Object.values(playerPoints)
        .sort((a, b) => b.points - a.points);

      setTimeout(() => {
        emit('sim-complete', {
          outcome,
          homeScore: homeScore.value,
          awayScore: awayScore.value,
          playerScoring,
          events: eventLog,
        });
      }, 1500);
    };

    // Idle render loop while the coverage picker is up, so the preview
    // flash animates without running the simulation.
    const prefightLoop = () => {
      if (simPhase.value !== 'prefight') return;
      renderFrame();
      prefightRAF = requestAnimationFrame(prefightLoop);
    };

    const startFight = () => {
      if (simPhase.value !== 'prefight') return;
      cancelAnimationFrame(prefightRAF);
      simPhase.value = 'live';
      shotClock.value = SHOT_CLOCK_MAX;
      lastPossessionTeam = null;
      lastTime = performance.now();
      animationFrameId = requestAnimationFrame(syncLoop);
    };

    onMounted(async () => {
      // The prefight coverage picker is visible from mount — cue the coach.
      emit('coverage-opened');
      spawnBots();
      if (!getEngine()) {
        initFallbackPlayers();
        if (livePlayers.value.length > 0) {
          const best = livePlayers.value.reduce((a, b) => (b.shooting || 0) > (a.shooting || 0) ? b : a);
          ball.value = { x: best.x, y: best.y, z: 0, possessorId: best.id, isPossessed: true };
        }
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
        // Show the coverage picker first; the sim loop starts on "Start Fight".
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
      if (resizeObserver) resizeObserver.disconnect();
      if (renderer) { renderer.destroy(); renderer = null; }
    });

    return {
      homeScore, awayScore, timeLeft, statusText, activePopups,
      courtScaler, courtCanvas, courtScale, COURT_W, COURT_H, dpr,
      simPhase, selectedSchemeId, COVERAGE_SCHEMES, selectScheme, startFight,
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

/* ── Floating event popups ──────────────────────────────────────── */
.event-popup {
  position: absolute;
  pointer-events: none;
  font-weight: 900;
  font-size: 1.3rem;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  animation: popup-float 1.2s ease-out forwards;
  z-index: 20;
}
.event-popup.score-home { color: #d9534f; }
.event-popup.score-away { color: #5bc0de; }

@keyframes popup-float {
  0% {
    opacity: 1;
    transform: translateY(0) scale(0.8);
  }
  20% {
    transform: translateY(-8px) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translateY(-50px) scale(0.9);
  }
}

/* ── Pre-fight coverage picker ───────────────────────────────────── */
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
.coverage-blurb em { color: #8a8a8a; font-size: 0.76rem; }
.warm-key { color: #ff9a52; font-weight: bold; }
.cool-key { color: #5f8cdc; font-weight: bold; }

.coverage-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.coverage-btn {
  flex: 1 1 130px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 8px 10px;
  background: #171717;
  border: 2px solid #383838;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}
.coverage-btn:hover { transform: translateY(-2px); border-color: #6b6b6b; }
.coverage-btn.active {
  border-color: #f4a300;
  background: #241d10;
  box-shadow: 0 0 14px rgba(244, 163, 0, 0.35);
}
.cb-name {
  font-weight: 800;
  font-size: 0.92rem;
  color: #ffd700;
  letter-spacing: 0.04em;
}
.cb-tag {
  font-size: 0.72rem;
  color: #9a9a9a;
  line-height: 1.3;
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

@media (max-width: 600px) {
  .coverage-btn { flex: 1 1 100%; }
}
</style>

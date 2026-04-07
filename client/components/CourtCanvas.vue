<template>
  <div class="sim-container">
    <div class="sim-header">
      <div class="team-score home">YOU: {{ homeScore }}</div>
      <div class="sim-timer">{{ timeLeft.toFixed(1) }}s</div>
      <div class="team-score away">OPP: {{ awayScore }}</div>
    </div>

    <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <canvas ref="courtCanvas"
              :width="COURT_W * dpr"
              :height="COURT_H * dpr"
              class="court-canvas"
              :style="{ width: COURT_W + 'px', height: COURT_H + 'px', transform: `scale(${courtScale})`, transformOrigin: 'top left' }">
      </canvas>

      <!-- Floating event popups -->
      <div v-for="popup in activePopups"
           :key="popup.id"
           class="event-popup"
           :class="popup.type"
           :style="{ left: (popup.x * courtScale) + 'px', top: (popup.y * courtScale) + 'px' }">
        {{ popup.text }}
      </div>
    </div>

    <div class="sim-status">{{ statusText }}</div>
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
  emits: ['sim-complete'],
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

    const courtScaler = ref(null);
    const courtCanvas = ref(null);
    const courtScale = ref(1);
    let resizeObserver = null;
    let ctx = null;

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

    // ── Canvas rendering ──────────────────────────────────────────
    const renderFrame = () => {
      if (!ctx) return;
      const c = ctx;
      c.save();
      c.scale(dpr, dpr);

      // Court floor
      c.fillStyle = '#c59b6d';
      c.fillRect(0, 0, COURT_W, COURT_H);

      // Court border
      c.strokeStyle = '#8b5a2b';
      c.lineWidth = 4;
      c.strokeRect(2, 2, COURT_W - 4, COURT_H - 4);

      // Half-court line
      c.strokeStyle = 'rgba(255,255,255,0.3)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(COURT_W / 2, 0);
      c.lineTo(COURT_W / 2, COURT_H);
      c.stroke();

      // Center circle
      c.beginPath();
      c.arc(COURT_W / 2, COURT_H / 2, 40, 0, Math.PI * 2);
      c.stroke();

      // Three-point arcs (left and right)
      c.beginPath();
      c.arc(0, COURT_H / 2, 160, -Math.PI * 0.4, Math.PI * 0.4);
      c.stroke();
      c.beginPath();
      c.arc(COURT_W, COURT_H / 2, 160, Math.PI * 0.6, Math.PI * 1.4);
      c.stroke();

      // Paint / key areas
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.strokeRect(0, COURT_H / 2 - 60, 120, 120);
      c.strokeRect(COURT_W - 120, COURT_H / 2 - 60, 120, 120);

      // Backboards
      c.strokeStyle = 'rgba(255,255,255,0.4)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(10, COURT_H / 2 - 20);
      c.lineTo(10, COURT_H / 2 + 20);
      c.stroke();
      c.beginPath();
      c.moveTo(COURT_W - 10, COURT_H / 2 - 20);
      c.lineTo(COURT_W - 10, COURT_H / 2 + 20);
      c.stroke();

      const b = ball.value;
      const possId = b.possessorId;

      // Ball shadow (when airborne)
      if (b.x !== null && (b.z || 0) > 1) {
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.beginPath();
        c.ellipse(clamp(b.x + 6, 6, COURT_W - 6), clamp(b.y + 10, 6, COURT_H - 6), 7, 3, 0, 0, Math.PI * 2);
        c.fill();
      }

      // Away players (blue)
      for (const bot of botPlayers.value) {
        const bx = clamp(bot.x + 10, 10, COURT_W - 10);
        const by = clamp(bot.y + 10, 10, COURT_H - 10);
        const hasBall = possId === bot.id;

        if (hasBall) {
          c.shadowColor = 'rgba(244, 163, 0, 0.8)';
          c.shadowBlur = 10;
        }

        c.globalAlpha = hasBall ? 1.0 : 0.8;
        c.fillStyle = '#5bc0de';
        c.strokeStyle = hasBall ? '#f4a300' : '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, 10, 0, Math.PI * 2);
        c.fill();
        c.stroke();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.globalAlpha = 1.0;
      }

      // Home players (red)
      for (const player of livePlayers.value) {
        const px = clamp(player.x + 10, 10, COURT_W - 10);
        const py = clamp(player.y + 10, 10, COURT_H - 10);
        const hasBall = possId === player.id;

        if (hasBall) {
          c.shadowColor = 'rgba(244, 163, 0, 0.8)';
          c.shadowBlur = 10;
        }

        c.fillStyle = '#d9534f';
        c.strokeStyle = hasBall ? '#f4a300' : '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, py, 10, 0, Math.PI * 2);
        c.fill();
        c.stroke();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;

        // Player name label
        const label = player.name ? player.name.split(' ').pop().slice(0, 3) : String(player.id);
        c.fillStyle = '#fff';
        c.font = 'bold 7px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, px, py);
      }

      // Ball
      if (b.x !== null) {
        const z = b.z || 0;
        const lift = z * 3;
        const radius = 6 * (1 + z * 0.04);
        const bx = clamp(b.x + 6, 6, COURT_W - 6);
        const by = clamp(b.y - lift + 6, 6, COURT_H - 6);

        c.shadowColor = '#f4a300';
        c.shadowBlur = 6;
        c.fillStyle = '#f4a300';
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, radius, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
      }

      c.restore();
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

    onMounted(() => {
      // Initialize canvas 2D context
      const canvas = courtCanvas.value;
      if (canvas) {
        ctx = canvas.getContext('2d');
      }

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
      renderFrame();
      animationFrameId = requestAnimationFrame(syncLoop);

      const updateScale = () => {
        if (courtScaler.value) {
          courtScale.value = Math.min(1, courtScaler.value.clientWidth / COURT_W);
        }
      };
      updateScale();
      resizeObserver = new ResizeObserver(updateScale);
      if (courtScaler.value) resizeObserver.observe(courtScaler.value);
    });

    onUnmounted(() => {
      simDone = true;
      cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
    });

    return { homeScore, awayScore, timeLeft, statusText, activePopups, courtScaler, courtCanvas, courtScale, COURT_W, COURT_H, dpr };
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
</style>

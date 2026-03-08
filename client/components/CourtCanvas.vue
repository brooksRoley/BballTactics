<template>
  <div class="sim-container">
    <div class="sim-header">
      <div class="team-score home">YOU: {{ homeScore }}</div>
      <div class="sim-timer">{{ timeLeft.toFixed(1) }}s</div>
      <div class="team-score away">OPP: {{ awayScore }}</div>
    </div>

    <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
    <div class="court-floor" :style="{ transform: `scale(${courtScale})`, transformOrigin: 'top left' }">
      <!-- Court markings -->
      <div class="marking half-line"></div>
      <div class="marking center-circle"></div>

      <!-- Home players (red) -->
      <div v-for="player in livePlayers"
           :key="'h-' + player.id"
           class="player-dot home-dot"
           :style="dotStyle(player)">
        <span class="dot-label">{{ player.name ? player.name.split(' ').pop().slice(0,3) : player.id }}</span>
      </div>

      <!-- Bot players (blue) -->
      <div v-for="bot in botPlayers"
           :key="'b-' + bot.id"
           class="player-dot away-dot"
           :style="dotStyle(bot)">
      </div>

      <!-- Ball -->
      <div v-if="ball.x !== null" class="ball-dot" :style="dotStyle(ball)"></div>
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
    courtLineup: { type: Array, default: () => [] }
  },
  emits: ['sim-complete'],
  setup(props, { emit }) {
    const livePlayers = ref([]);
    const botPlayers = ref([]);
    const ball = ref({ x: 400, y: 200 });
    const homeScore = ref(0);
    const awayScore = ref(0);
    const timeLeft = ref(10.0);
    const statusText = ref('Tip-off!');
    let animationFrameId = null;
    let lastTime = 0;
    let simDone = false;

    const COURT_W = 800;
    const COURT_H = 400;
    const SIM_DURATION = 10.0; // seconds

    const courtScaler = ref(null);
    const courtScale = ref(1);
    let resizeObserver = null;

    const getEngine = () => props.engine || inject('engine', null);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // Map planning-grid position (0-4) to sim-court pixel position (800x400).
    // Home team occupies the left half; grid col → x, grid row → y.
    const gridToSim = (gx, gy) => ({
      x: gx * 70 + 40,
      y: gy * 70 + 40
    });

    // Place some bot opponents for the sim to play against
    const spawnBots = () => {
      botPlayers.value = [
        { id: 901, x: 600, y: 80,  tx: 580, ty: 100 },
        { id: 902, x: 650, y: 200, tx: 620, ty: 180 },
        { id: 903, x: 580, y: 320, tx: 560, ty: 300 },
      ];
    };

    // Seed livePlayers from the court lineup when there is no engine
    const initFallbackPlayers = () => {
      if (props.courtLineup.length === 0) return;
      livePlayers.value = props.courtLineup.map(p => {
        const sim = gridToSim(p.courtX, p.courtY);
        // Each player gets a target near the right basket area
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

    const dotStyle = (p) => ({
      transform: `translate(${clamp(p.x, 0, COURT_W - 20)}px, ${clamp(p.y, 0, COURT_H - 20)}px)`
    });

    const syncLoop = (timestamp) => {
      if (simDone) return;

      const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap dt
      lastTime = timestamp;
      timeLeft.value -= dt;

      if (timeLeft.value <= 0) {
        timeLeft.value = 0;
        finishSim();
        return;
      }

      const engine = getEngine();
      if (engine) {
        // --- Engine-driven path ---
        engine.TickSimulation(dt);
        try {
          const state = JSON.parse(engine.GetGameStateJSON());
          livePlayers.value = state.players || [];
          botPlayers.value  = state.bots    || [];
          if (state.ball) ball.value = state.ball;

          // Engine owns scoring — detect changes for status flash
          const prevHome = homeScore.value;
          const prevAway = awayScore.value;
          homeScore.value = state.homeScore ?? homeScore.value;
          awayScore.value = state.awayScore ?? awayScore.value;
          if (homeScore.value > prevHome) {
            statusText.value = 'Score!';
            setTimeout(() => { statusText.value = ''; }, 800);
          } else if (awayScore.value > prevAway) {
            statusText.value = 'Opponent scores...';
            setTimeout(() => { statusText.value = ''; }, 800);
          }
        } catch (e) { /* engine may not have state yet */ }
      } else {
        // --- Fallback: JS movement + simple proximity scoring ---
        livePlayers.value = livePlayers.value.map(p => {
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 2) {
            const step = (p.speed || 8) * dt;
            return { ...p, x: p.x + (dx / dist) * step, y: p.y + (dy / dist) * step };
          }
          return { ...p, tx: 350 + Math.random() * 200, ty: 60 + Math.random() * 280 };
        });

        // Move ball toward whoever has it (first home player past half-court)
        const carrier = livePlayers.value.find(p => p.x > 300);
        if (carrier) ball.value = { x: carrier.x, y: carrier.y };

        // Scoring based on proximity to basket
        const nearBasket = livePlayers.value.filter(p => p.x > 450).length;
        if (Math.random() < 0.001 + nearBasket * 0.002) {
          const pts = Math.random() < 0.35 ? 3 : 2;
          homeScore.value += pts;
          statusText.value = pts === 3 ? 'Three!' : 'Score!';
          setTimeout(() => { statusText.value = ''; }, 800);
        }
        if (Math.random() < 0.003) {
          awayScore.value += Math.random() < 0.3 ? 3 : 2;
          statusText.value = 'Opponent scores...';
          setTimeout(() => { statusText.value = ''; }, 800);
        }

        // Move JS bots
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

      animationFrameId = requestAnimationFrame(syncLoop);
    };

    const finishSim = () => {
      simDone = true;
      const result = homeScore.value > awayScore.value ? 'win' : 'loss';
      statusText.value = result === 'win'
        ? 'Final — You win!'
        : homeScore.value === awayScore.value
          ? 'Final — Draw counts as a loss!'
          : 'Final — You lose.';

      setTimeout(() => {
        emit('sim-complete', result);
      }, 1500);
    };

    onMounted(() => {
      spawnBots();
      if (!getEngine()) {
        initFallbackPlayers();
      }
      lastTime = performance.now();
      timeLeft.value = SIM_DURATION;
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

    return { livePlayers, botPlayers, ball, homeScore, awayScore, timeLeft, statusText, dotStyle, courtScaler, courtScale, COURT_H };
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

.court-floor {
  position: relative;
  width: 800px;
  height: 400px;
  background: #c59b6d;
  border: 4px solid #8b5a2b;
  border-radius: 4px;
  overflow: hidden;
}

/* Court markings */
.marking.half-line {
  position: absolute;
  left: 50%;
  top: 0;
  width: 0;
  height: 100%;
  border-left: 2px solid rgba(255,255,255,0.3);
}
.marking.center-circle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 80px;
  height: 80px;
  transform: translate(-50%, -50%);
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
}

/* Player dots */
.player-dot {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  top: 0; left: 0;
  will-change: transform;
  display: flex;
  align-items: center;
  justify-content: center;
}
.home-dot { background: #d9534f; border: 2px solid #fff; }
.away-dot { background: #5bc0de; border: 2px solid #fff; opacity: 0.8; }
.dot-label {
  font-size: 0.5rem;
  color: #fff;
  font-weight: bold;
  pointer-events: none;
}

.ball-dot {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  top: 0; left: 0;
  background: #f4a300;
  border: 2px solid #fff;
  box-shadow: 0 0 6px #f4a300;
  will-change: transform;
  z-index: 10;
}

.sim-status {
  height: 24px;
  font-size: 1rem;
  color: #ffd700;
  font-weight: bold;
}
</style>

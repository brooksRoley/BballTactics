<template>
  <div class="app">
    <header class="top-bar">
      <h1>B-Ball Tactics</h1>
      <div class="status-bar">
        <span class="round-badge">Round {{ round }}/10</span>
        <span class="record-badge">{{ wins }}W - {{ losses }}L</span>
        <span class="hp-bar">
          HP
          <span class="hp-fill" :style="{ width: health + '%' }"></span>
          <span class="hp-text">{{ health }}</span>
        </span>
        <span class="gold-badge">{{ gold }}G</span>
      </div>
    </header>

    <!-- Scouting Report (loading screen) -->
    <div v-if="loading" class="scouting-report">
      <div class="sr-card">
        <div class="sr-badge">SCOUTING REPORT</div>
        <h2 class="sr-title">Preparing the Arena</h2>

        <div class="sr-progress">
          <div class="sr-step" :class="{ done: loadStep >= 1, active: loadStep === 0 }">
            <span class="sr-dot"></span>
            <span>Initializing Referee (WASM)</span>
          </div>
          <div class="sr-step" :class="{ done: loadStep >= 2, active: loadStep === 1 }">
            <span class="sr-dot"></span>
            <span>Loading Roster Data</span>
          </div>
          <div class="sr-step" :class="{ done: loadStep >= 3, active: loadStep === 2 }">
            <span class="sr-dot"></span>
            <span>Generating Draft Board</span>
          </div>
        </div>

        <div class="sr-tip">
          <span class="sr-tip-label">STRATEGY TIP</span>
          <p>{{ currentTip }}</p>
        </div>

        <div class="sr-bar-track">
          <div class="sr-bar-fill" :style="{ width: (loadStep / 3 * 100) + '%' }"></div>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Tutorial (first time only) -->
      <TutorialPhase1
        v-if="phase === 'tutorial'"
        @phase-one-complete="onTutorialComplete"
      />

      <!-- Draft + Plan (unified screen) -->
      <div v-if="phase === 'planning'" class="planning-screen">
        <PlanningPhase
          :engine="engine"
          :bench="bench"
          @update:bench="bench = $event"
          @sell-player="sellPlayer"
          @locked-in="onLockedIn"
        />

        <div class="shop-section">
          <div class="shop-header">
            <h3>Free Agents</h3>
            <button class="reroll-btn" :disabled="gold < 1" @click="rerollShop">
              Reroll (1G)
            </button>
          </div>
          <div class="shop-panel">
            <div
              class="player-card"
              v-for="player in shop"
              :key="player.id"
              :class="[`cost-${player.cost}`, { affordable: gold >= player.cost }]"
              @click="buyPlayer(player)"
            >
              <span class="card-cost">{{ player.cost }}G</span>
              <strong>{{ player.name }}</strong>
              <span class="card-stats">
                SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }} / DEF {{ player.stats.defense }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tip-off transition -->
      <div v-if="phase === 'tipoff'" class="tipoff-overlay">
        <div class="tipoff-content" :class="{ 'tipoff-zoom': tipoffZoom }">
          <div class="tipoff-whistle">
            <div class="whistle-ring"></div>
            <div class="whistle-ring ring-2"></div>
            <div class="whistle-icon">&#127925;</div>
          </div>
          <h2 class="tipoff-text">TIP OFF!</h2>
          <p class="tipoff-sub">Round {{ round }}</p>
        </div>
      </div>

      <!-- Sim -->
      <CourtCanvas
        v-if="phase === 'sim'"
        :engine="engine"
        :court-lineup="courtLineup"
        :round-stats="roundStats"
        @sim-complete="onSimComplete"
      />

      <!-- Result -->
      <div v-if="phase === 'result'" class="result-screen">
        <div class="result-card" :class="lastResult">
          <h2>{{ lastResult === 'win' ? 'Victory' : 'Defeat' }}</h2>
          <div class="result-score">{{ lastScore.home }} - {{ lastScore.away }}</div>
          <p v-if="lastResult === 'loss'" class="result-damage">-20 HP</p>
          <p v-else class="result-safe">No damage taken</p>

          <!-- Per-player breakdown -->
          <div v-if="roundStats.playerScoring && roundStats.playerScoring.length" class="combat-log">
            <h3 class="log-title">Player Performance</h3>
            <div class="log-entries">
              <div v-for="ps in roundStats.playerScoring" :key="ps.id" class="log-entry">
                <span class="log-name">{{ ps.name }}</span>
                <span class="log-pts">{{ ps.points }} PTS</span>
                <div class="log-bar-track">
                  <div class="log-bar-fill" :style="{ width: (ps.points / (maxPlayerPts || 1) * 100) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Key moments -->
          <div v-if="roundStats.events && roundStats.events.length" class="key-moments">
            <h3 class="log-title">Key Moments</h3>
            <div class="moment" v-for="(ev, i) in roundStats.events.slice(-5)" :key="i">
              {{ ev }}
            </div>
          </div>

          <p class="record-summary">Record: {{ wins }}W - {{ losses }}L</p>
          <button v-if="health > 0 && round <= 10" @click="nextRound">Next Round</button>
          <div v-else class="game-over">
            <h3>{{ health <= 0 ? 'Eliminated' : 'Season Complete — You Win!' }}</h3>
            <button @click="resetGame">Play Again</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, provide } from 'vue';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
import CourtCanvas from './components/CourtCanvas.vue';
import PlanningPhase from './components/PlanningPhase.vue';
import TutorialPhase1 from './components/TutorialPhase1.vue';

const loading = ref(true);
const loadStep = ref(0);
const phase = ref('tutorial');
const round = ref(1);
const health = ref(100);
const gold = ref(10);
const wins = ref(0);
const losses = ref(0);
const shop = ref([]);
const bench = ref([]);
const lastResult = ref('');
const lastScore = ref({ home: 0, away: 0 });
const engine = ref(null);
const courtLineup = ref([]);
const tipoffZoom = ref(false);
const roundStats = ref({ playerScoring: [], events: [] });
let allPlayers = [];

const STRATEGY_TIPS = [
  'Posting up a Power Forward against small-ball increases Paint Dominance by 15%.',
  'The "Splash Family" synergy triggers at 3+ shooters with 85+ shooting — +20 to all.',
  'Twin Towers activates with 2+ players over 6\'10" — massive defense boost but slower pace.',
  '"7 Seconds or Less" needs 4+ players averaging 85+ speed — explosive offense, glass defense.',
  'Franchise synergies stack: 2 Lakers = Tier 1, 4 Lakers = Tier 2. Each tier adds +5 shooting.',
  'Cost 5 players are rare early — you won\'t see them reliably until Round 7+.',
  'Selling a player refunds half their cost. Sell early if you\'re pivoting synergies.',
  'Gold interest caps at +5 per round. Banking gold above 50 doesn\'t help.',
  'Position matters: players near the hoop shoot at higher probability due to distance decay.',
  'A contested shot loses ~10% accuracy per foot of defender proximity within 5 feet.',
];
const currentTip = ref(STRATEGY_TIPS[Math.floor(Math.random() * STRATEGY_TIPS.length)]);

const maxPlayerPts = computed(() => {
  if (!roundStats.value.playerScoring.length) return 0;
  return Math.max(...roundStats.value.playerScoring.map(p => p.points));
});

provide('engine', engine);

const initWasm = async () => {
  if (typeof Module === 'undefined') {
    console.warn('Wasm engine.js not loaded — running without C++ engine');
    loadStep.value = 1;
    return;
  }
  const wasmModule = await Module();
  engine.value = new wasmModule.GameManager();
  loadStep.value = 1;
};

const fetchRoster = async () => {
  // Try backend API first
  try {
    const apiResponse = await fetch(`${API_BASE}/api/roster`);
    if (apiResponse.ok) {
      allPlayers = await apiResponse.json();
      loadStep.value = 2;
      refreshShop();
      loadStep.value = 3;
      return;
    }
  } catch (e) {
    console.warn('Backend /api/roster unavailable, falling back to static file.');
  }
  // Fallback to static file (works for gh-pages deploy or no backend)
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'engine_roster.json');
    allPlayers = await response.json();
    loadStep.value = 2;
    refreshShop();
    loadStep.value = 3;
  } catch (error) {
    console.error('Failed to load roster data from both sources.', error);
  }
};

const getShopWeights = (roundNum) => {
  if (roundNum <= 3) return { 1: 40, 2: 35, 3: 20, 4: 5, 5: 0 };
  if (roundNum <= 6) return { 1: 25, 2: 30, 3: 25, 4: 15, 5: 5 };
  return { 1: 15, 2: 20, 3: 25, 4: 25, 5: 15 };
};

const weightedSample = (candidates, count, weights) => {
  const pool = candidates.map(p => ({ player: p, weight: weights[p.cost] || 0 }))
                         .filter(e => e.weight > 0);
  const result = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
    let r = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    result.push(pool[idx].player);
    pool.splice(idx, 1);
  }
  return result;
};

const refreshShop = () => {
  const available = allPlayers.filter(p =>
    !bench.value.find(b => b.id === p.id)
  );
  const weights = getShopWeights(round.value);
  shop.value = weightedSample(available, 5, weights);
};

const rerollShop = () => {
  if (gold.value < 1) return;
  gold.value -= 1;
  refreshShop();
};

const buyPlayer = (player) => {
  if (gold.value < player.cost) return;
  gold.value -= player.cost;
  bench.value = [...bench.value, player];
  shop.value = shop.value.filter(p => p.id !== player.id);
};

const sellPlayer = (player) => {
  const refund = Math.floor(player.cost / 2);
  gold.value += refund;
  bench.value = bench.value.filter(p => p.id !== player.id);
};

const onLockedIn = (lineup) => {
  courtLineup.value = lineup || [];
  if (engine.value) {
    engine.value.StartRound();
  }
  // Reset round stats for tracking
  roundStats.value = { playerScoring: [], events: [] };
  // Tip-off transition
  phase.value = 'tipoff';
  tipoffZoom.value = false;
  setTimeout(() => { tipoffZoom.value = true; }, 100);
  setTimeout(() => { phase.value = 'sim'; }, 1800);
};

const onSimComplete = (result) => {
  // result is now { outcome, homeScore, awayScore, playerScoring, events }
  const outcome = typeof result === 'string' ? result : result.outcome;
  lastResult.value = outcome;
  lastScore.value = {
    home: typeof result === 'object' ? result.homeScore : 0,
    away: typeof result === 'object' ? result.awayScore : 0,
  };
  if (typeof result === 'object') {
    roundStats.value = {
      playerScoring: result.playerScoring || [],
      events: result.events || [],
    };
  }
  if (outcome === 'loss') {
    health.value = Math.max(0, health.value - 20);
    losses.value++;
  } else {
    wins.value++;
  }
  phase.value = 'result';
};

const nextRound = () => {
  round.value++;
  gold.value += 5 + Math.min(round.value, 5); // base 5 + interest up to 5
  refreshShop();
  phase.value = 'planning';
};

const resetGame = () => {
  round.value = 1;
  health.value = 100;
  gold.value = 10;
  wins.value = 0;
  losses.value = 0;
  bench.value = [];
  lastResult.value = '';
  refreshShop();
  phase.value = 'planning';
};

const onTutorialComplete = (tutorialPlayer) => {
  if (tutorialPlayer) {
    // Find the real roster version by name so stats/id are correct for the engine
    const rosterMatch = allPlayers.find(p =>
      p.name.toLowerCase() === tutorialPlayer.name.toLowerCase()
    );
    if (rosterMatch && !bench.value.find(b => b.id === rosterMatch.id)) {
      bench.value = [...bench.value, rosterMatch];
      gold.value -= tutorialPlayer.cost; // deduct what the tutorial charged
    }
  }
  phase.value = 'planning';
};

onMounted(async () => {
  await initWasm();
  await fetchRoster();
  loading.value = false;
});
</script>

<style>
* { box-sizing: border-box; }
body {
  background-color: #121212;
  color: #e0e0e0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  margin: 0;
  padding: 0;
}

.app {
  max-width: 900px;
  margin: 0 auto;
  padding: 10px 20px;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #8b5a2b;
  padding-bottom: 10px;
  margin-bottom: 15px;
}
.top-bar h1 { margin: 0; font-size: 1.4rem; }

.status-bar {
  display: flex;
  gap: 15px;
  align-items: center;
}
.round-badge {
  background: #333;
  padding: 4px 12px;
  border-radius: 3px;
  font-size: 0.9rem;
}
.gold-badge {
  background: #333;
  color: #ffd700;
  font-weight: bold;
  padding: 4px 12px;
  border-radius: 3px;
}
.hp-bar {
  position: relative;
  width: 120px;
  height: 22px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
  font-size: 0.8rem;
  line-height: 22px;
  padding-left: 6px;
}
.hp-fill {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  background: #27ae60;
  transition: width 0.5s ease;
  z-index: 0;
}
.hp-text {
  position: relative;
  z-index: 1;
  margin-left: 4px;
  font-weight: bold;
}

/* ── Scouting Report Loading ─────────────────────────────────────── */
.scouting-report {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 420px;
  padding: 20px;
}
.sr-card {
  max-width: 440px;
  width: 100%;
  background: #1a1a1a;
  border: 2px solid #8b5a2b;
  border-radius: 8px;
  padding: 28px 24px;
  text-align: center;
}
.sr-badge {
  display: inline-block;
  background: #8b5a2b;
  color: #ffd700;
  font-size: 0.65rem;
  font-weight: bold;
  letter-spacing: 0.15em;
  padding: 3px 12px;
  border-radius: 3px;
  margin-bottom: 12px;
}
.sr-title {
  margin: 0 0 20px;
  font-size: 1.3rem;
  color: #e0e0e0;
}
.sr-progress {
  text-align: left;
  margin-bottom: 20px;
}
.sr-step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 0.85rem;
  color: #555;
  transition: color 0.3s;
}
.sr-step.active { color: #ffd700; }
.sr-step.done { color: #27ae60; }
.sr-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #333;
  border: 2px solid #555;
  flex-shrink: 0;
  transition: all 0.3s;
}
.sr-step.active .sr-dot {
  background: #ffd700;
  border-color: #ffd700;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
  animation: pulse-dot 1s ease-in-out infinite;
}
.sr-step.done .sr-dot {
  background: #27ae60;
  border-color: #27ae60;
}
@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 4px rgba(255, 215, 0, 0.3); }
  50% { box-shadow: 0 0 12px rgba(255, 215, 0, 0.7); }
}
.sr-tip {
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px 14px;
  margin-bottom: 16px;
  text-align: left;
}
.sr-tip-label {
  display: block;
  font-size: 0.6rem;
  font-weight: bold;
  letter-spacing: 0.1em;
  color: #5bc0de;
  margin-bottom: 6px;
}
.sr-tip p {
  margin: 0;
  font-size: 0.8rem;
  color: #aaa;
  line-height: 1.4;
}
.sr-bar-track {
  height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}
.sr-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5a2b, #ffd700);
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* ── Tip-off Transition ─────────────────────────────────────────── */
.tipoff-overlay {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 420px;
  position: relative;
}
.tipoff-content {
  text-align: center;
  transform: scale(0.8);
  opacity: 0;
  animation: tipoff-enter 0.6s ease-out forwards;
}
.tipoff-content.tipoff-zoom {
  animation: tipoff-enter 0.4s ease-out forwards, tipoff-zoom-out 0.8s ease-in 1.0s forwards;
}
@keyframes tipoff-enter {
  0% { transform: scale(0.5); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes tipoff-zoom-out {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(2.5); opacity: 0; }
}
.tipoff-whistle {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
}
.whistle-ring {
  position: absolute;
  inset: 0;
  border: 3px solid #ffd700;
  border-radius: 50%;
  animation: whistle-pulse 0.8s ease-out infinite;
}
.whistle-ring.ring-2 {
  animation-delay: 0.3s;
}
@keyframes whistle-pulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2); opacity: 0; }
}
.whistle-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.2rem;
}
.tipoff-text {
  margin: 0;
  font-size: 2.5rem;
  font-weight: 900;
  color: #ffd700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.4);
}
.tipoff-sub {
  margin: 8px 0 0;
  font-size: 1rem;
  color: #888;
}

/* ── Result screen upgrades ─────────────────────────────────────── */
.result-score {
  font-size: 2rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  margin: 8px 0;
}
.result-card.win .result-score { color: #27ae60; }
.result-card.loss .result-score { color: #d9534f; }
.result-damage { color: #d9534f; font-weight: bold; }
.result-safe { color: #27ae60; }

.combat-log {
  text-align: left;
  margin: 16px 0;
  padding: 12px;
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
}
.log-title {
  font-size: 0.7rem;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888;
  margin: 0 0 10px;
}
.log-entries { display: flex; flex-direction: column; gap: 6px; }
.log-entry {
  display: grid;
  grid-template-columns: 1fr 50px 80px;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}
.log-name { color: #e0e0e0; }
.log-pts { color: #ffd700; font-weight: bold; text-align: right; }
.log-bar-track {
  height: 6px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
}
.log-bar-fill {
  height: 100%;
  background: #d9534f;
  border-radius: 3px;
  transition: width 0.5s ease;
}
.key-moments {
  text-align: left;
  margin: 12px 0;
  padding: 10px 12px;
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
}
.moment {
  font-size: 0.75rem;
  color: #aaa;
  padding: 3px 0;
  border-bottom: 1px solid #2a2a2a;
}
.moment:last-child { border-bottom: none; }

/* Shop */
.shop-section { margin-top: 15px; }
.shop-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.shop-header h3 { margin: 0; font-size: 1rem; color: #888; }
.reroll-btn {
  padding: 4px 14px;
  font-size: 0.8rem;
  background: #333;
  color: #ffd700;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-weight: bold;
}
.reroll-btn:hover:not(:disabled) { background: #444; }
.reroll-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.record-badge {
  background: #333;
  padding: 4px 12px;
  border-radius: 3px;
  font-size: 0.9rem;
}
.record-summary { color: #888; font-size: 0.9rem; margin-top: 8px; }
.shop-panel { display: flex; gap: 8px; flex-wrap: wrap; }

.player-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: #1a1a1a;
  border: 2px solid #333;
  min-width: 140px;
  cursor: not-allowed;
  opacity: 0.5;
  transition: all 0.15s ease;
  font-size: 0.85rem;
}
.player-card.affordable { cursor: pointer; opacity: 1; }
.player-card.affordable:hover { transform: translateY(-3px); }
.card-cost { color: #ffd700; font-weight: bold; font-size: 0.75rem; }
.card-stats { color: #777; font-size: 0.7rem; }

.cost-1 { border-color: #7f8c8d; }
.cost-2 { border-color: #27ae60; }
.cost-3 { border-color: #2980b9; }
.cost-4 { border-color: #9b59b6; }
.cost-5 { border-color: #f1c40f; }

/* Result */
.result-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}
.result-card {
  text-align: center;
  padding: 40px 60px;
  background: #1a1a1a;
  border: 3px solid #444;
  border-radius: 8px;
}
.result-card.win { border-color: #27ae60; }
.result-card.win h2 { color: #27ae60; }
.result-card.loss { border-color: #d9534f; }
.result-card.loss h2 { color: #d9534f; }
.result-card button {
  margin-top: 20px;
  background: #d9534f;
  color: white;
  border: none;
  padding: 10px 30px;
  font-size: 1rem;
  cursor: pointer;
}
.result-card button:hover { background: #c9302c; }
.game-over h3 { margin-top: 15px; }

@media (max-width: 600px) {
  .app { padding: 8px 10px; }
  .top-bar {
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .top-bar h1 { font-size: 1.1rem; }
  .status-bar { width: 100%; justify-content: space-between; }
  .hp-bar { width: 90px; }
  .shop-panel { flex-direction: column; }
  .player-card { min-width: unset; width: 100%; flex-direction: row; align-items: center; gap: 8px; }
  .card-cost { font-size: 0.85rem; }
  .card-stats { font-size: 0.75rem; }
  .result-card { padding: 30px 20px; }
}
</style>

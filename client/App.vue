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

    <div v-if="loading" class="loading">Loading Engine...</div>

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

      <!-- Sim -->
      <CourtCanvas
        v-if="phase === 'sim'"
        :engine="engine"
        :court-lineup="courtLineup"
        @sim-complete="onSimComplete"
      />

      <!-- Result -->
      <div v-if="phase === 'result'" class="result-screen">
        <div class="result-card" :class="lastResult">
          <h2>{{ lastResult === 'win' ? 'Victory' : 'Defeat' }}</h2>
          <p v-if="lastResult === 'loss'">-20 HP</p>
          <p v-else>No damage taken</p>
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
import { ref, onMounted, provide } from 'vue';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
import CourtCanvas from './components/CourtCanvas.vue';
import PlanningPhase from './components/PlanningPhase.vue';
import TutorialPhase1 from './components/TutorialPhase1.vue';

const loading = ref(true);
const phase = ref('tutorial');
const round = ref(1);
const health = ref(100);
const gold = ref(10);
const wins = ref(0);
const losses = ref(0);
const shop = ref([]);
const bench = ref([]);
const lastResult = ref('');
const engine = ref(null);
const courtLineup = ref([]);
let allPlayers = [];

provide('engine', engine);

const initWasm = async () => {
  if (typeof Module === 'undefined') {
    console.warn('Wasm engine.js not loaded — running without C++ engine');
    return;
  }
  const wasmModule = await Module();
  engine.value = new wasmModule.GameManager();
  console.log('C++ Engine Loaded');
};

const fetchRoster = async () => {
  // Try backend API first
  try {
    const apiResponse = await fetch(`${API_BASE}/api/roster`);
    if (apiResponse.ok) {
      allPlayers = await apiResponse.json();
      refreshShop();
      return;
    }
  } catch (e) {
    console.warn('Backend /api/roster unavailable, falling back to static file.');
  }
  // Fallback to static file (works for gh-pages deploy or no backend)
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'engine_roster.json');
    allPlayers = await response.json();
    refreshShop();
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
  phase.value = 'sim';
};

const onSimComplete = (result) => {
  lastResult.value = result;
  if (result === 'loss') {
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

.loading { text-align: center; padding: 60px; font-size: 1.2rem; }

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

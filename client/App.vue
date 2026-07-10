<template>
  <div class="app">
    <header class="top-bar">
      <h1>B-Ball Tactics</h1>
      <div class="status-bar">
        <span class="round-badge">Round {{ Math.min(round, 10) }}/10</span>
        <span class="record-badge">{{ wins }}W - {{ losses }}L</span>
        <span v-if="streakCount >= 2" class="streak-badge" :class="streakType">
          {{ streakCount }}{{ streakType === 'win' ? 'W' : 'L' }} streak
        </span>
        <SpringBar :value="health" />
        <span class="gold-badge" :title="incomeTooltip">{{ gold }}G</span>
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
      <!-- Engine failed to load: the JS backup ref (fallbackSim.js) calls the fights -->
      <p v-if="engineFailed" class="backup-ref-note">
        The WASM engine didn't load — a simplified backup ref will call your fights.
        <a href="#" @click.prevent="reloadPage">Reload</a> to try the real engine again.
      </p>

      <!-- Tutorial (first time only) -->
      <TutorialPhase1
        v-if="phase === 'tutorial'"
        @phase-one-complete="onTutorialComplete"
      />

      <!-- Draft + Plan (unified screen). v-show keeps PlanningPhase mounted so
           the court lineup persists across rounds; :key remounts it on reset. -->
      <div v-show="phase === 'planning'" class="planning-screen">

        <!-- First-round coach tip -->
        <div v-if="round === 1 && !planningIntroDismissed" class="planning-intro">
          <div class="pi-label">COACH MILLER</div>
          <p class="pi-text">Buy players from the Free Agents shop below, then <strong>drag or tap them onto the court</strong>. Pick your offense and coverage, then hit <strong>Lock In &amp; Fight</strong>. Three copies of the same player merge into a ★★ upgrade — court or bench, wherever they sit.</p>
          <button class="pi-dismiss" @click="planningIntroDismissed = true">Got it</button>
        </div>

        <!-- Active synergies -->
        <div class="synergy-bar">
          <span class="synergy-count">{{ activeSynergies.length }} synerg{{ activeSynergies.length === 1 ? 'y' : 'ies' }} active</span>
          <span v-for="syn in activeSynergies" :key="syn.name" class="synergy-chip" :title="syn.detail">
            {{ syn.name }} ({{ syn.count }}) <em>{{ syn.detail }}</em>
          </span>
          <span v-if="activeSynergies.length === 0" class="synergy-hint">Stack teammates from the same NBA franchise to unlock buffs</span>
        </div>

        <!-- Tactics pickers -->
        <div class="scheme-row">
          <label class="scheme-picker">
            <span class="scheme-label">Offense</span>
            <select v-model="myOffense">
              <option v-for="o in schemeList.offenses" :key="o.id" :value="o.id" :title="o.translation">
                {{ o.name }}
              </option>
            </select>
          </label>
          <label class="scheme-picker">
            <span class="scheme-label">Coverage</span>
            <select v-model="myCoverage">
              <option v-for="c in schemeList.coverages" :key="c.id" :value="c.id" :title="c.translation">
                {{ c.name }}
              </option>
            </select>
          </label>
        </div>
        <p class="scheme-translation">{{ selectedOffenseInfo.translation }}</p>
        <p class="scheme-translation coverage">{{ selectedCoverageInfo.translation }}</p>

        <PlanningPhase
          ref="planningRef"
          :key="'plan-' + runEpoch"
          :bench="bench"
          :max-on-court="courtCap"
          @update:bench="onBenchUpdate"
          @update:court="courtMirror = $event"
          @sell-player="onSellPlayer"
          @locked-in="onLockedIn"
        />

        <div class="shop-section">
          <div class="shop-header">
            <h3>Free Agents</h3>
            <span class="shop-odds" :title="'Odds of each cost tier appearing in a shop slot this round'">
              Rd {{ round }} odds:
              <template v-for="(w, c) in currentOdds" :key="c">
                <span v-if="w > 0" class="odds-entry" :class="`odds-${c}`">{{ c }}G {{ w }}%</span>
              </template>
            </span>
            <button class="reroll-btn" :disabled="gold < REROLL_COST" @click="onReroll">
              Reroll ({{ REROLL_COST }}G)
            </button>
          </div>
          <div v-if="combineToast" class="combine-toast">
            ★★ {{ combineToast.name }} upgraded! Stats ×1.8
          </div>
          <div class="shop-panel">
            <div
              class="player-card"
              v-for="(player, i) in shop"
              :key="'shop-' + i + '-' + player.id"
              :class="[`cost-${player.cost}`, { affordable: gold >= player.cost && !benchFull }]"
              @click="onBuy(i)"
            >
              <span class="card-cost">{{ player.cost }}G</span>
              <strong>{{ player.name }}
                <span v-if="ownedCopies[player.id]" class="copies-badge">{{ ownedCopies[player.id] }}/3</span>
              </strong>
              <span class="card-stats">
                SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }} / DEF {{ player.stats.defense }}
              </span>
            </div>
          </div>
          <p v-if="benchFull" class="bench-full-note">Bench is full ({{ BENCH_CAP }}) — sell or place a unit to buy more.</p>
          <p class="income-note">Next round income: +{{ nextIncome.total }}G ({{ nextIncome.base }} base<template v-if="nextIncome.interest"> + {{ nextIncome.interest }} interest</template><template v-if="nextIncome.streak"> + {{ nextIncome.streak }} streak</template>)</p>
        </div>
      </div>

      <!-- Matchmaking -->
      <div v-if="phase === 'searching'" class="scouting-report">
        <div class="sr-card">
          <div class="sr-badge">GHOST LOBBY</div>
          <h2 class="sr-title">Scouting opponent boards…</h2>
          <div class="sr-bar-track"><div class="sr-bar-fill searching"></div></div>
        </div>
      </div>

      <!-- Opponent scouting: revise your coverage before tip-off -->
      <div v-if="phase === 'scout'" class="scout-screen">
        <div class="scout-card">
          <div class="sr-badge">SCOUTING REPORT</div>
          <h2 class="scout-title">vs {{ opponentName }}</h2>
          <p v-if="offlineGhost" class="offline-note">Server unreachable — playing an offline practice squad.</p>

          <div class="scout-units">
            <div v-for="(u, i) in theirUnits" :key="'opp-' + i" class="scout-unit" :class="`cost-${u.cost || 1}`">
              <strong>{{ u.name || 'Ghost' }}<span v-if="u.star === 2" class="star-badge"> ★★</span></strong>
              <span class="card-stats">SPD {{ u.stats?.speed ?? '?' }} / SHT {{ u.stats?.shooting ?? '?' }} / DEF {{ u.stats?.defense ?? '?' }}</span>
            </div>
          </div>

          <div class="scout-suggestions">
            <h3 class="log-title">Coach's Board — coverage reads</h3>
            <div v-for="s in coverageSuggestions" :key="s.coverage" class="suggestion" :class="{ chosen: myCoverage === s.coverage }">
              <strong>{{ s.name }}</strong>
              <p>{{ s.reasoning }}</p>
            </div>
          </div>

          <div class="scheme-row scout-picker">
            <label class="scheme-picker">
              <span class="scheme-label">Your coverage call</span>
              <select v-model="myCoverage">
                <option v-for="c in schemeList.coverages" :key="c.id" :value="c.id" :title="c.translation">
                  {{ c.name }}
                </option>
              </select>
            </label>
            <button class="tipoff-btn" @click="startBattle">Tip Off</button>
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
          <p class="tipoff-sub">Round {{ round }} — vs {{ opponentName }}</p>
        </div>
      </div>

      <!-- Sim -->
      <CourtCanvas
        v-if="phase === 'sim'"
        :engine="engine"
        :court-lineup="courtLineup"
        :opponent-units="theirUnits"
        :home-multiplier="homeMatchup ? homeMatchup.offenseMultiplier : 1"
        :away-multiplier="awayMatchup ? awayMatchup.offenseMultiplier : 1"
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

          <!-- Tactical read grade -->
          <div v-if="lastGrade" class="grade-panel">
            <span class="grade-chip" :class="'grade-' + lastGrade.grade">{{ lastGrade.grade }}</span>
            <p class="grade-lesson">{{ lastGrade.lesson }}</p>
          </div>

          <!-- Film Room -->
          <div v-if="filmRoom.length" class="key-moments film-room">
            <h3 class="log-title">Film Room</h3>
            <div class="moment" v-for="(note, i) in filmRoom" :key="'fr-' + i">{{ note }}</div>
          </div>

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
          <button v-if="runStatus === 'active'" @click="nextRound">Next Round</button>
          <div v-else class="game-over">
            <h3>{{ runStatus === 'lost' ? 'Eliminated' : 'Season Complete — You Win!' }}</h3>
            <p class="record-summary">Final: {{ wins }}W - {{ losses }}L, {{ health }} HP remaining</p>
            <button @click="resetGame">Play Again</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

import CourtCanvas from './components/CourtCanvas.vue';
import PlanningPhase from './components/PlanningPhase.vue';
import TutorialPhase1 from './components/TutorialPhase1.vue';
import SpringBar from './components/SpringBar.vue';
import { useShop } from './composables/useShop.js';
import { useMatchmaking, API_BASE } from './composables/useMatchmaking.js';
import {
  REROLL_COST, BENCH_CAP, MAX_ROUNDS, STAT_CAP,
  shopOdds, teamSizeCap, goldIncome, makeUnit, rollShop,
} from './game/economy.js';
import { computeSynergies } from './game/synergies.js';
import { listSchemes, resolveMatchup, suggestCoverage, gradeRead, schemes } from './game/tactics.js';

// ── core state ──────────────────────────────────────────────────────────────
const loading = ref(true);
const engineFailed = ref(false);
const loadStep = ref(0);
const phase = ref('tutorial');
const planningIntroDismissed = ref(false);
const round = ref(1);
const health = ref(100);
const wins = ref(0);
const losses = ref(0);
const streakType = ref(null);   // 'win' | 'loss' | null
const streakCount = ref(0);
const engine = ref(null);
const courtLineup = ref([]);
const courtMirror = ref([]);    // live read-only mirror of PlanningPhase's court
const tipoffZoom = ref(false);
const roundStats = ref({ playerScoring: [], events: [] });
const lastResult = ref('');
const lastScore = ref({ home: 0, away: 0 });
const runEpoch = ref(0);        // bumped on reset to remount PlanningPhase
const rosterRef = ref([]);

// ── server run state ────────────────────────────────────────────────────────
const runId = ref(null);
const runStatus = ref('active'); // 'active' | 'won' | 'lost'
const offlineGhost = ref(false);
const { startRun, submitAndFetchOpponent, resolveMatch } = useMatchmaking();

// ── shop / economy ──────────────────────────────────────────────────────────
const shopApi = useShop(rosterRef, courtMirror);
const { gold, shop, bench, benchFull, ownedCopies } = shopApi;
const combineToast = ref(null);
let combineToastTimer = null;

// PlanningPhase owns the live court state; these ops let combines consume
// on-court copies and drop the merged 2-star back into a court cell.
const planningRef = ref(null);
shopApi.setCourtOps({
  remove: (uids) => !!(planningRef.value && planningRef.value.removeUnits(uids)),
  place: (unit, cx, cy) => !!(planningRef.value && planningRef.value.placeUnit(unit, cx, cy)),
});

// ── tactics ─────────────────────────────────────────────────────────────────
const schemeList = listSchemes();
const myOffense = ref('spread_pnr');
const myCoverage = ref('drop');
const opponentBoard = ref(null);
const theirUnits = ref([]);
const theirOffense = ref('spread_pnr');
const theirCoverage = ref('drop');
const opponentName = ref('Ghost Team');
const coverageSuggestions = ref([]);
const lastGrade = ref(null);
const filmRoom = ref([]);
// Refs (not plain lets) so the sim's multiplier props stay reactive
const homeMatchup = ref(null);
const awayMatchup = ref(null);

const STRATEGY_TIPS = [
  'Cost 5 players are rare early — the shop publishes its odds each round.',
  'Selling a player refunds their full cost. Pivot your lineup freely.',
  'Three copies of the same player merge into a ★★ unit with 1.8x stats.',
  'Banked gold earns interest: +1 per 10 saved, up to +5 a round.',
  'Win or loss streaks pay bonus gold — commit to a direction.',
  'Losing a round costs 20 HP. You start at 100 and are eliminated at 0.',
  'Your lineup carries over each round — you do not rebuild from scratch.',
  'Stack teammates from the same NBA franchise for a shooting synergy.',
  'Your team size cap grows with the round: 3 players early, 5 by round 5.',
  'After scouting the ghost, you can still change your coverage call.',
];
const currentTip = ref(STRATEGY_TIPS[Math.floor(Math.random() * STRATEGY_TIPS.length)]);

// ── derived ─────────────────────────────────────────────────────────────────
const maxPlayerPts = computed(() => {
  if (!roundStats.value.playerScoring.length) return 0;
  return Math.max(...roundStats.value.playerScoring.map(p => p.points));
});
const courtCap = computed(() => teamSizeCap(round.value));
const currentOdds = computed(() => shopOdds(round.value));
const activeSynergies = computed(() => computeSynergies(courtMirror.value));
const nextIncome = computed(() => goldIncome(round.value + 1, gold.value, streakCount.value));
const incomeTooltip = computed(() =>
  `Next round: +${nextIncome.value.total}G = ${nextIncome.value.base} base + ${nextIncome.value.interest} interest + ${nextIncome.value.streak} streak`);
const selectedOffenseInfo = computed(() =>
  schemeList.offenses.find(o => o.id === myOffense.value) || schemeList.offenses[0]);
const selectedCoverageInfo = computed(() =>
  schemeList.coverages.find(c => c.id === myCoverage.value) || schemeList.coverages[0]);

// ── tactics mastery (localStorage) ──────────────────────────────────────────
const MASTERY_KEY = 'tactics_mastery';
const bumpMastery = (ids, field) => {
  try {
    const m = JSON.parse(localStorage.getItem(MASTERY_KEY) || '{}');
    for (const id of ids) {
      m[id] = m[id] || { seen: 0, used: 0, understood: 0 };
      m[id][field]++;
    }
    localStorage.setItem(MASTERY_KEY, JSON.stringify(m));
  } catch (e) { /* private mode etc. — mastery is best-effort */ }
};

// ── player identity ─────────────────────────────────────────────────────────
const getPlayerId = () => {
  try {
    let id = localStorage.getItem('bball_player_id');
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      localStorage.setItem('bball_player_id', id);
    }
    return id;
  } catch (e) {
    return `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
};

// ── boot ────────────────────────────────────────────────────────────────────
const reloadPage = () => window.location.reload();

const initWasm = async () => {
  // The WASM engine is the primary simulation. If it can't load, the run
  // still plays: CourtCanvas swaps in the pure-JS backup ref
  // (client/game/fallbackSim.js) with the ghost board + tactics multipliers.
  if (typeof Module === 'undefined') {
    console.error('Wasm engine.js not loaded — falling back to the JS backup ref.');
    engineFailed.value = true;
  } else {
    try {
      const wasmModule = await Module();
      engine.value = new wasmModule.GameManager();
    } catch (e) {
      console.error('Wasm engine failed to initialize — falling back to the JS backup ref:', e);
      engineFailed.value = true;
    }
  }
  loadStep.value = 1;
};

const fetchRoster = async () => {
  // Try the zero-next backend first, fall back to the static file
  try {
    const apiResponse = await fetch(`${API_BASE}/api/bball/roster`);
    if (apiResponse.ok) {
      const data = await apiResponse.json();
      rosterRef.value = data.filter(p => p.is_active !== false);
      loadStep.value = 2;
      shopApi.roll(round.value);
      loadStep.value = 3;
      return;
    }
  } catch (e) {
    console.warn('Backend /api/bball/roster unavailable, falling back to static file.');
  }
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'engine_roster.json');
    const data = await response.json();
    rosterRef.value = data.filter(p => p.is_active !== false);
    loadStep.value = 2;
    shopApi.roll(round.value);
    loadStep.value = 3;
  } catch (error) {
    console.error('Failed to load roster data from both sources.', error);
  }
};

const ensureRun = async () => {
  if (runId.value) return;
  const res = await startRun(getPlayerId());
  if (res && res.run_id) {
    runId.value = res.run_id;
    health.value = res.health ?? 100;
  }
};

// ── shop handlers ───────────────────────────────────────────────────────────
const showCombineToast = (unit) => {
  combineToast.value = unit;
  clearTimeout(combineToastTimer);
  combineToastTimer = setTimeout(() => { combineToast.value = null; }, 3000);
};

const onBuy = (slotIndex) => {
  const result = shopApi.buy(slotIndex);
  if (result && result.star === 2) showCombineToast(result);
};

const onReroll = () => { shopApi.reroll(round.value); };

const onSellPlayer = (player) => { shopApi.sell(player); };

const onBenchUpdate = (newBench) => {
  bench.value = newBench;
  // Safety net: triples merge at buy/placement time now, but re-check after
  // any bench change so a missed merge can never linger.
  const merged = shopApi.combineTriples();
  if (merged) showCombineToast(merged);
};

// ── ghost helpers ───────────────────────────────────────────────────────────
const normalizeGhostUnits = (board) => {
  const units = Array.isArray(board?.units) ? board.units : [];
  return units.map((u, i) => ({
    id: typeof u.id === 'number' ? u.id : 900 + i,
    name: u.name || `Ghost ${i + 1}`,
    cost: u.cost ?? 1,
    star: u.star ?? 1,
    courtX: u.courtX ?? u.x ?? 2,
    courtY: u.courtY ?? u.y ?? 2,
    stats: {
      shooting: u.stats?.shooting ?? 45,
      speed: u.stats?.speed ?? 45,
      defense: u.stats?.defense ?? 45,
    },
  }));
};

/** Deterministic scheme fallback for ghosts that predate scheme submission. */
const ghostSchemes = (board, units) => {
  if (board?.offense && board?.coverage) {
    const validOff = schemeList.offenses.some(o => o.id === board.offense);
    const validCov = schemeList.coverages.some(c => c.id === board.coverage);
    if (validOff && validCov) return { offense: board.offense, coverage: board.coverage };
  }
  let ghostId = 0;
  for (const u of units) {
    ghostId += typeof u.id === 'number'
      ? u.id
      : String(u.name || '').split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
  }
  return {
    offense: schemes.offenses[ghostId % schemes.offenses.length].id,
    coverage: schemes.coverages[ghostId % schemes.coverages.length].id,
  };
};

/** Offline fallback opponent scaled to the current round. */
const localGhostBoard = () => {
  const count = Math.min(2 + Math.floor(round.value / 2), 5);
  const picks = rollShop(rosterRef.value, round.value).slice(0, count);
  return {
    team_name: 'Practice Squad',
    is_bot: true,
    units: picks.map((p, i) => ({
      id: 900 + i,
      name: p.name,
      cost: p.cost,
      x: 1 + (i % 3),
      y: i,
      stats: { ...p.stats },
    })),
  };
};

// ── round flow ──────────────────────────────────────────────────────────────
const onLockedIn = async (lineup) => {
  courtLineup.value = (lineup || []).map(u => ({ ...u }));
  courtMirror.value = courtLineup.value;
  roundStats.value = { playerScoring: [], events: [] };
  phase.value = 'searching';
  bumpMastery([myOffense.value, myCoverage.value], 'used');

  await ensureRun();

  const boardData = {
    team_name: 'You',
    offense: myOffense.value,
    coverage: myCoverage.value,
    units: courtLineup.value.map(u => ({
      id: u.uid ?? u.id,
      rosterId: u.rosterId ?? u.id,
      name: u.name,
      team: u.team || '',
      cost: u.cost,
      star: u.star || 1,
      x: u.courtX,
      y: u.courtY,
      stats: u.stats,
    })),
  };

  let board = null;
  if (runId.value) {
    board = await submitAndFetchOpponent(runId.value, round.value, boardData);
  }
  offlineGhost.value = !board;
  if (!board) board = localGhostBoard();

  opponentBoard.value = board;
  theirUnits.value = normalizeGhostUnits(board);
  opponentName.value = board.team_name || 'Ghost Team';
  const ghostCall = ghostSchemes(board, theirUnits.value);
  theirOffense.value = ghostCall.offense;
  theirCoverage.value = ghostCall.coverage;
  coverageSuggestions.value = suggestCoverage(theirUnits.value).slice(0, 3);

  phase.value = 'scout';
};

const startBattle = () => {
  // Resolve the tactical matchup from both points of view
  homeMatchup.value = resolveMatchup(myOffense.value, theirCoverage.value, courtLineup.value, theirUnits.value);
  awayMatchup.value = resolveMatchup(theirOffense.value, myCoverage.value, theirUnits.value, courtLineup.value);

  syncEngineForRound(homeMatchup.value.offenseMultiplier, awayMatchup.value.offenseMultiplier);

  phase.value = 'tipoff';
  tipoffZoom.value = false;
  setTimeout(() => { tipoffZoom.value = true; }, 100);
  setTimeout(() => { phase.value = 'sim'; }, 1800);
};

// All engine state is rebuilt from scratch every round: pristine stats (no
// buff accumulation across StartRound calls), tactics multipliers baked into
// shooting, and the ghost board loaded as the real away team.
const engineUids = new Set();
const syncEngineForRound = (homeMult, awayMult) => {
  const eng = engine.value;
  // No engine: CourtCanvas receives the same multipliers + ghost board as
  // props and runs the JS backup ref with them instead.
  if (!eng) return;

  const hasNewBindings =
    typeof eng.SpawnUnit === 'function' && typeof eng.SetAwayTeamJSON === 'function';

  for (const uid of engineUids) eng.RemovePlayer(uid);
  engineUids.clear();

  for (const u of courtLineup.value) {
    const shooting = Math.min(STAT_CAP, Math.round(u.stats.shooting * homeMult));
    if (hasNewBindings) {
      eng.SpawnUnit(u.id, u.name, u.team || '', u.stats.speed, shooting, u.stats.defense);
    } else {
      eng.SpawnPlayer(u.id, u.name, u.stats.speed, shooting);
    }
    eng.SetPlayerCoordinates(u.id, u.courtX, u.courtY, u.courtX, u.courtY);
    engineUids.add(u.id);
  }

  if (hasNewBindings) {
    const scaledAway = theirUnits.value.map(g => ({
      id: g.id,
      name: g.name,
      x: g.courtX,
      y: g.courtY,
      stats: {
        ...g.stats,
        shooting: Math.min(STAT_CAP, Math.round(g.stats.shooting * awayMult)),
      },
    }));
    eng.SetAwayTeamJSON(JSON.stringify({ units: scaledAway }));
  }

  eng.StartRound();
};

const onSimComplete = async (result) => {
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

  // Streaks + record
  if (streakType.value === outcome) streakCount.value++;
  else { streakType.value = outcome; streakCount.value = 1; }
  if (outcome === 'loss') losses.value++;
  else wins.value++;

  // Tactical read feedback
  try {
    lastGrade.value = gradeRead(
      { offense: myOffense.value, coverage: myCoverage.value },
      { offense: theirOffense.value, coverage: theirCoverage.value, units: theirUnits.value },
    );
    if ((lastGrade.value.grade === 'A' || lastGrade.value.grade === 'B') && lastGrade.value.score > 0) {
      bumpMastery([myOffense.value, myCoverage.value], 'understood');
    }
  } catch (e) {
    console.warn('gradeRead failed:', e.message);
    lastGrade.value = null;
  }
  filmRoom.value = [
    ...(homeMatchup.value ? homeMatchup.value.notes : []),
    ...(awayMatchup.value ? awayMatchup.value.notes.map(n => `Their side — ${n}`) : []),
  ];

  // Server owns HP and run status; fall back to local bookkeeping offline
  const res = runId.value ? await resolveMatch(runId.value, round.value, outcome) : null;
  if (res && typeof res.health === 'number') {
    health.value = Math.max(0, res.health);
    runStatus.value = res.status;
  } else {
    if (outcome === 'loss') health.value = Math.max(0, health.value - 20);
    runStatus.value = health.value <= 0 ? 'lost' : round.value >= MAX_ROUNDS ? 'won' : 'active';
  }

  phase.value = 'result';
};

const nextRound = () => {
  round.value++;
  shopApi.collectIncome(round.value, streakCount.value);
  shopApi.roll(round.value);
  phase.value = 'planning';
};

const resetGame = () => {
  round.value = 1;
  health.value = 100;
  wins.value = 0;
  losses.value = 0;
  streakType.value = null;
  streakCount.value = 0;
  lastResult.value = '';
  lastGrade.value = null;
  filmRoom.value = [];
  courtLineup.value = [];
  courtMirror.value = [];
  runStatus.value = 'active';
  runId.value = null;
  runEpoch.value++;          // remounts PlanningPhase → clears its court state
  shopApi.reset();
  shopApi.roll(1);
  ensureRun();
  phase.value = 'planning';
};

const onTutorialComplete = (tutorialPlayer) => {
  if (tutorialPlayer) {
    const rosterMatch = rosterRef.value.find(p =>
      p.name.toLowerCase() === tutorialPlayer.name.toLowerCase()
    );
    if (rosterMatch) {
      bench.value = [...bench.value, makeUnit(rosterMatch)];
      gold.value -= tutorialPlayer.cost; // deduct what the tutorial charged
    }
  }
  phase.value = 'planning';
};

onMounted(async () => {
  await initWasm();
  await fetchRoster();
  bumpMastery(
    [...schemeList.offenses.map(o => o.id), ...schemeList.coverages.map(c => c.id)],
    'seen',
  );
  ensureRun(); // fire-and-forget; lock-in retries if it hasn't landed yet
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
  gap: 12px;
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
  cursor: help;
}
.record-badge {
  background: #333;
  padding: 4px 12px;
  border-radius: 3px;
  font-size: 0.9rem;
}
.streak-badge {
  padding: 3px 10px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: bold;
}
.streak-badge.win { background: rgba(39, 174, 96, 0.2); color: #4fc97f; }
.streak-badge.loss { background: rgba(217, 83, 79, 0.2); color: #e05a4e; }

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
.sr-bar-fill.searching {
  width: 40%;
  animation: search-sweep 1.1s ease-in-out infinite;
}
@keyframes search-sweep {
  0%   { margin-left: 0; }
  50%  { margin-left: 60%; }
  100% { margin-left: 0; }
}

/* ── Synergy bar ─────────────────────────────────────────────────── */
.synergy-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 0.8rem;
}
.synergy-count {
  font-weight: bold;
  color: #ffd700;
  white-space: nowrap;
}
.synergy-chip {
  background: rgba(255, 215, 0, 0.12);
  border: 1px solid rgba(255, 215, 0, 0.4);
  color: #ffd700;
  border-radius: 3px;
  padding: 2px 8px;
}
.synergy-chip em { color: #b89b2e; font-style: normal; font-size: 0.7rem; }
.synergy-hint { color: #666; font-style: italic; }

/* ── Scheme pickers ──────────────────────────────────────────────── */
.scheme-row {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.scheme-picker {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.scheme-label {
  font-size: 0.65rem;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888;
}
.scheme-picker select {
  background: #222;
  color: #e0e0e0;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 6px 10px;
  font-size: 0.85rem;
  cursor: pointer;
}
.scheme-translation {
  margin: 0 0 2px;
  font-size: 0.72rem;
  color: #777;
  font-style: italic;
}
.scheme-translation.coverage { margin-bottom: 10px; }

/* ── Scout screen ────────────────────────────────────────────────── */
.scout-screen {
  display: flex;
  justify-content: center;
  padding: 10px 0 30px;
}
.scout-card {
  width: 100%;
  max-width: 560px;
  background: #1a1a1a;
  border: 2px solid #8b5a2b;
  border-radius: 8px;
  padding: 22px 20px;
}
.scout-title { margin: 0 0 6px; font-size: 1.3rem; color: #5bc0de; }
.offline-note { color: #f0a500; font-size: 0.78rem; margin: 0 0 8px; }
.scout-units {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.scout-unit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #222;
  border: 2px solid #444;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 0.8rem;
}
.scout-unit .star-badge { color: #ffd700; }
.scout-suggestions { margin: 14px 0; }
.suggestion {
  background: #222;
  border: 1px solid #333;
  border-left: 4px solid #444;
  border-radius: 3px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
.suggestion.chosen { border-left-color: #5bc0de; }
.suggestion strong { font-size: 0.85rem; color: #e0e0e0; }
.suggestion p { margin: 4px 0 0; font-size: 0.75rem; color: #999; line-height: 1.4; }
.scout-picker { align-items: flex-end; margin-top: 12px; }
.tipoff-btn {
  background: #d9534f;
  color: white;
  border: none;
  padding: 10px 28px;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 3px;
  font-weight: bold;
}
.tipoff-btn:hover { background: #c9302c; }

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

/* ── Result screen ──────────────────────────────────────────────── */
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

.grade-panel {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  text-align: left;
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 12px;
  margin: 14px 0;
}
.grade-chip {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 900;
  border-radius: 6px;
}
.grade-A { background: rgba(39, 174, 96, 0.2); color: #4fc97f; border: 2px solid #27ae60; }
.grade-B { background: rgba(91, 192, 222, 0.15); color: #5bc0de; border: 2px solid #5bc0de; }
.grade-C { background: rgba(240, 165, 0, 0.15); color: #f0b93e; border: 2px solid #d99a2b; }
.grade-D { background: rgba(217, 83, 79, 0.15); color: #e05a4e; border: 2px solid #c0392b; }
.grade-lesson { margin: 0; font-size: 0.78rem; color: #bbb; line-height: 1.45; }

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
.film-room .moment { color: #9fb8c9; }

/* Planning intro coach bubble */
.planning-intro {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #1e1e1e;
  border: 2px solid #8b5a2b;
  border-left: 6px solid #d9534f;
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.pi-label {
  font-size: 0.65rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: #d9534f;
  white-space: nowrap;
  flex-shrink: 0;
}
.pi-text {
  margin: 0;
  font-size: 0.85rem;
  color: #ccc;
  line-height: 1.4;
  flex: 1;
}
.pi-text strong { color: #e0e0e0; }
.pi-dismiss {
  padding: 4px 14px;
  font-size: 0.78rem;
  background: #333;
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.pi-dismiss:hover { background: #444; }

/* Shop */
.shop-section { margin-top: 15px; }
.shop-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.shop-header h3 { margin: 0; font-size: 1rem; color: #888; }
.shop-odds {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 0.68rem;
  color: #777;
  cursor: help;
}
.odds-entry { padding: 1px 5px; border-radius: 3px; background: #222; border: 1px solid #333; }
.odds-1 { color: #aab2b3; }
.odds-2 { color: #4fc97f; }
.odds-3 { color: #58a6d8; }
.odds-4 { color: #b07cc6; }
.odds-5 { color: #f1c40f; }
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
.combine-toast {
  background: rgba(255, 215, 0, 0.12);
  border: 1px solid rgba(255, 215, 0, 0.5);
  color: #ffd700;
  font-size: 0.8rem;
  font-weight: bold;
  border-radius: 4px;
  padding: 6px 12px;
  margin-bottom: 8px;
  animation: toast-in 0.25s ease-out;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
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
.copies-badge {
  font-size: 0.62rem;
  font-weight: bold;
  color: #ffd700;
  background: rgba(255, 215, 0, 0.12);
  border: 1px solid rgba(255, 215, 0, 0.4);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
  vertical-align: middle;
}
.bench-full-note { color: #f0a500; font-size: 0.75rem; margin: 8px 0 0; }
.income-note { color: #666; font-size: 0.72rem; margin: 6px 0 0; }

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
  max-width: 640px;
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
  .status-bar { width: 100%; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
  .shop-panel { flex-direction: column; }
  .player-card { min-width: unset; width: 100%; flex-direction: row; align-items: center; gap: 8px; }
  .card-cost { font-size: 0.85rem; }
  .card-stats { font-size: 0.75rem; }
  .result-card { padding: 30px 20px; }
  .scheme-row { gap: 8px; }
}
.backup-ref-note {
  background: rgba(240, 165, 0, 0.1);
  border: 1px solid rgba(240, 165, 0, 0.45);
  color: #f0b93e;
  font-size: 0.8rem;
  border-radius: 4px;
  padding: 8px 12px;
  margin: 0 0 12px;
}
.backup-ref-note a { color: #ffd700; }
</style>

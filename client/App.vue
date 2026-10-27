<template>
  <div class="app" @pointerdown.capture="onAnyPointer" @click.capture="onAnyClick">
    <header class="top-bar">
      <h1>Hardwood Autochess</h1>
      <div class="status-bar" data-tour="status">
        <button
          v-if="phase === 'planning' || phase === 'result' || phase === 'fullcourt'"
          class="open-gym-btn"
          @click="openGym"
        >Open Gym</button>
        <button
          v-if="phase !== 'filmroom' && phase !== 'fullcourt'"
          class="film-room-btn"
          data-tour="filmroom"
          @click="openFilmRoom"
        >🎬 Film Room</button>
        <button
          class="sound-btn"
          :aria-pressed="!soundMuted"
          :aria-label="soundMuted ? 'Turn sound on' : 'Turn sound off'"
          @click="toggleSound"
        >{{ soundMuted ? '🔇' : '🔊' }}</button>
        <template v-if="phase !== 'filmroom' && phase !== 'gym' && phase !== 'fullcourt'">
          <span class="round-badge">Round {{ Math.min(round, 10) }}/10</span>
          <span class="record-badge">{{ wins }}W - {{ losses }}L</span>
          <span v-if="streakCount >= 2" class="streak-badge" :class="streakType">
            {{ streakCount }}{{ streakType === 'win' ? 'W' : 'L' }} streak
          </span>
          <SpringBar :value="health" />
          <span class="gold-badge" :class="{ bump: goldBump }" :title="incomeTooltip">{{ gold }}G</span>
        </template>
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

      <!-- Open Gym: the front door. What the game is, why play, how it works. -->
      <OpenGym
        v-if="phase === 'gym'"
        :in-run="inRun"
        :muted="soundMuted"
        :music-volume="musicVolume"
        :show-replay="tutorial.isOnboarded && tutorial.isOnboarded()"
        @run="onRunIt"
        @controls="onControls"
        @toggle-sound="toggleSound"
        @music-volume="onMusicVolume"
        @replay-tutorial="onReplayTutorial"
        @fullcourt="phase = 'fullcourt'"
      />

      <!-- Full Court: the same players, live, one of them yours (docs/design/full-court.md) -->
      <FullCourt
        v-if="phase === 'fullcourt'"
        @exit="openGym"
      />

      <!-- Coach Miller's Film Room (daily tactics puzzles) -->
      <FilmRoom
        v-if="phase === 'filmroom'"
        @exit="closeFilmRoom"
      />

      <!-- Draft + Plan (unified screen). v-show keeps PlanningPhase mounted so
           the court lineup persists across rounds; :key remounts it on reset. -->
      <div v-show="phase === 'planning'" class="planning-screen">

        <!-- Returning players can re-run the onboarding coach -->
        <div v-if="round === 1 && !tutorial.active" class="replay-tutorial-row">
          <button class="replay-tutorial-btn" @click="tutorial.replay()">↻ Replay tutorial</button>
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
        <div class="scheme-row" data-tour="schemes">
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
          @player-placed="onTutorialPlaced"
          @locked-in="onLockedIn"
        />

        <div class="shop-section" data-tour="shop">
          <div class="shop-header">
            <h3>Free Agents</h3>
            <span class="shop-odds" :title="'Odds of each cost tier appearing in a shop slot this round'">
              Rd {{ round }} odds:
              <template v-for="(w, c) in currentOdds" :key="c">
                <span v-if="w > 0" class="odds-entry" :class="`odds-${c}`">{{ c }}G {{ w }}%</span>
              </template>
            </span>
            <button class="reroll-btn" data-sfx="none" :disabled="gold < REROLL_COST" @click="onReroll">
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
            <button class="tipoff-btn" data-sfx="none" @click="startBattle">Tip Off</button>
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
        @coverage-opened="tutorial.onCoverageOpened"
        @coverage-selected="tutorial.onCoverageSelected"
        @fight-started="tutorial.onFightStarted"
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

      <!-- Front Office 101 — adaptive onboarding coach (rides the real screens) -->
      <CoachOverlay
        :active="tutorial.active && (phase === 'planning' || phase === 'sim')"
        :act="tutorial.act"
        :message="tutorial.message"
        :skill-tag="tutorial.skillTag"
        @skip="tutorial.skip"
      />

      <ControlsTour :active="tourActive" @done="tourActive = false" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, provide, markRaw, watch, nextTick } from 'vue';

import CourtCanvas from './components/CourtCanvas.vue';
import PlanningPhase from './components/PlanningPhase.vue';
import FilmRoom from './components/FilmRoom.vue';
import CoachOverlay from './components/CoachOverlay.vue';
import SpringBar from './components/SpringBar.vue';
import OpenGym from './components/OpenGym.vue';
import FullCourt from './components/FullCourt.vue';
import ControlsTour from './components/ControlsTour.vue';
import { sfx } from './audio/sfx.js';
import { useShop } from './composables/useShop.js';
import { useMatchmaking, API_BASE } from './composables/useMatchmaking.js';
import { useTutorial } from './composables/useTutorial.js';
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
const phase = ref('gym');          // Open Gym is the front door
const phaseBeforeFilmRoom = ref('planning');
const round = ref(1);
const health = ref(100);
const wins = ref(0);
const losses = ref(0);
const streakType = ref(null);   // 'win' | 'loss' | null
const streakCount = ref(0);
const engine = ref(null);
// PlanningPhase (and CourtCanvas as a fallback) reach the WASM engine via inject.
provide('engine', engine);
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

// Front Office 101 — adaptive onboarding coach (guides on the real screens).
const tutorial = useTutorial();
const onTutorialPlaced = (payload) => tutorial.onPlayerPlaced(payload || {});

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
      // markRaw: the embind GameManager keeps internal pointer bookkeeping
      // ($$.ptrType.registeredClass) that embind compares by object identity.
      // Storing it in a reactive ref wraps those internals in a Proxy, so the
      // identity check in upcastPointer fails ("Expected null or instance of
      // GameManager, got an instance of GameManager") on every method call.
      // markRaw keeps the raw instance out of Vue's reactivity system.
      engine.value = markRaw(new wasmModule.GameManager());
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
  sfx.play(!result ? 'broke' : result.star === 2 ? 'star' : 'buy');
  if (result) {
    tutorial.onPlayerBought(result, { goldLeft: gold.value, rosterCount: bench.value.length });
    if (result.star === 2) showCombineToast(result);
  }
};

const onReroll = () => {
  if (gold.value >= REROLL_COST) sfx.play('reroll');
  shopApi.reroll(round.value);
};

const onSellPlayer = (player) => { sfx.play('sell'); shopApi.sell(player); };

const onBenchUpdate = (newBench) => {
  bench.value = newBench;
  // Safety net: triples merge at buy/placement time now, but re-check after
  // any bench change so a missed merge can never linger.
  const merged = shopApi.combineTriples();
  if (merged) showCombineToast(merged);
};

// ── ghost helpers ───────────────────────────────────────────────────────────
// Bench-hero tags live only in the roster (the server rebuilds ghost units
// from it and drops extra fields), so both teams look them up by rosterId.
const benchHeroOf = (rosterId) => {
  const p = rosterRef.value.find(r => r.id === rosterId);
  return p && p.role === 'bench_hero' ? p : null;
};

const normalizeGhostUnits = (board) => {
  const units = Array.isArray(board?.units) ? board.units : [];
  return units.map((u, i) => ({
    id: typeof u.id === 'number' ? u.id : 900 + i,
    rosterId: u.rosterId ?? null,
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
      rosterId: p.id,
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
  sfx.play('whistle');
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

  sfx.play('whistle');
  sfx.play('crowd', { intensity: 0.35 });
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

  // Engine ids are lineup slots, not roster ids: two unmerged copies of the
  // same player share a roster id and would overwrite each other in-engine.
  courtLineup.value.forEach((u, slot) => {
    const eid = slot + 1;
    const shooting = Math.min(STAT_CAP, Math.round(u.stats.shooting * homeMult));
    if (hasNewBindings) {
      eng.SpawnUnit(eid, u.name, u.team || '', u.stats.speed, shooting, u.stats.defense);
    } else {
      eng.SpawnPlayer(eid, u.name, u.stats.speed, shooting);
    }
    eng.SetPlayerCoordinates(eid, u.courtX, u.courtY, u.courtX, u.courtY);
    const hero = benchHeroOf(u.rosterId);
    if (hero && typeof eng.SetBenchHero === 'function') {
      eng.SetBenchHero(eid, hero.ppg_mean ?? 0, hero.ppg_stddev ?? 0);
    }
    engineUids.add(eid);
  });

  if (hasNewBindings) {
    const scaledAway = theirUnits.value.map(g => {
      const hero = benchHeroOf(g.rosterId);
      return {
        id: g.id,
        name: g.name,
        x: g.courtX,
        y: g.courtY,
        stats: {
          ...g.stats,
          shooting: Math.min(STAT_CAP, Math.round(g.stats.shooting * awayMult)),
        },
        ...(hero ? { role: 'bench_hero', ppg_mean: hero.ppg_mean, ppg_stddev: hero.ppg_stddev } : {}),
      };
    });
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

  sfx.play(outcome === 'win' ? 'win' : 'loss');
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

const openFilmRoom = () => {
  phaseBeforeFilmRoom.value = phase.value;
  phase.value = 'filmroom';
};

const closeFilmRoom = () => {
  phase.value = phaseBeforeFilmRoom.value || 'planning';
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
  // Onboarding starts when the player presses Run It in Open Gym.
});

// ── Open Gym, sound and feel ────────────────────────────────────────────────
const soundMuted = ref(sfx.muted);
const musicVolume = ref(sfx.musicVolume);
const tourActive = ref(false);
const inRun = computed(() => round.value > 1 || bench.value.length > 0 || courtMirror.value.length > 0);
const MUSIC_PHASES = new Set(['gym', 'planning']);
const syncMusic = () => {
  if (!soundMuted.value && MUSIC_PHASES.has(phase.value)) sfx.music.start();
  else sfx.music.stop();
};
watch(phase, syncMusic);

// Browsers allow audio only after a gesture: the first press anywhere unlocks it.
const onAnyPointer = () => { if (sfx.unlock()) syncMusic(); };
// Every button and picker answers a click; ones with their own sound opt out.
const onAnyClick = (e) => {
  const el = e.target.closest && e.target.closest('button, select');
  if (el && !el.disabled && el.dataset.sfx !== 'none') sfx.play('tap');
};

const toggleSound = () => {
  sfx.unlock();
  sfx.setMuted(!soundMuted.value);
  soundMuted.value = sfx.muted;
  syncMusic();
};
const onMusicVolume = (v) => {
  sfx.setMusicVolume(v);
  musicVolume.value = sfx.musicVolume;
  syncMusic();
};

let tutorialOffered = false;
const onRunIt = () => {
  sfx.unlock();
  sfx.play('whistle');
  phase.value = 'planning';
  if (!tutorialOffered) { tutorialOffered = true; tutorial.maybeStart(); }
};
const onControls = async () => {
  phase.value = 'planning';
  tutorialOffered = true;          // the tour teaches the screen; don't stack the coach on it
  await nextTick();
  tourActive.value = true;
};
const onReplayTutorial = () => {
  tutorialOffered = true;
  phase.value = 'planning';
  tutorial.replay();
};
const openGym = () => { tourActive.value = false; phase.value = 'gym'; };

const goldBump = ref(false);
let goldBumpTimer = null;
watch(gold, (now, before) => {
  if (now === before) return;
  goldBump.value = false;
  clearTimeout(goldBumpTimer);
  requestAnimationFrame(() => { goldBump.value = true; });
  goldBumpTimer = setTimeout(() => { goldBump.value = false; }, 400);
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
.film-room-btn {
  background: #1e1e1e;
  color: #ffd700;
  border: 1px solid #8b5a2b;
  border-radius: 3px;
  padding: 4px 12px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.film-room-btn:hover { background: #2a2a2a; border-color: #d9534f; }
.open-gym-btn, .sound-btn {
  background: #1e1e1e;
  color: #f2b45f;
  border: 1px solid #8b5a2b;
  border-radius: 3px;
  padding: 4px 12px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.sound-btn { padding: 4px 9px; }
.open-gym-btn:hover, .sound-btn:hover { background: #2a2a2a; }
.gold-badge.bump { animation: gold-bump 0.4s ease-out; }
@keyframes gold-bump { 30% { transform: scale(1.25); color: #fff3b0; } }

/* Press feel: everything clickable gives a little under the finger. */
.app button:not(:disabled) { transition: transform 0.08s ease; }
.app button:not(:disabled):active { transform: scale(0.95); }
.player-card.affordable:active { transform: translateY(-2px) scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .gold-badge.bump { animation: none; }
  .app button:not(:disabled):active, .player-card.affordable:active { transform: none; }
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

/* Replay-tutorial affordance (returning players) */
.replay-tutorial-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.replay-tutorial-btn {
  background: transparent;
  color: #9a9a9a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.replay-tutorial-btn:hover { color: #ffd700; border-color: #8b5a2b; }

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
.shop-panel { display: flex; gap: 12px; flex-wrap: wrap; }

/* Collectible-card treatment for the draft shop. Each cost tier reads as a
   rarity: tier colour drives the top bar, border glow, and hover aura, and a
   holographic sheen sweeps across affordable cards on hover. */
.player-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 11px;
  min-width: 152px;
  border-radius: 10px;
  border: 1.5px solid #3a3a3a;
  background:
    linear-gradient(160deg, rgba(42,42,48,0.96) 0%, rgba(22,22,26,0.98) 58%, rgba(13,13,16,1) 100%);
  color: #ececec;
  cursor: not-allowed;
  opacity: 0.45;
  overflow: hidden;
  isolation: isolate;
  font-size: 0.85rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.4);
  transition: transform 0.18s cubic-bezier(.2,.7,.3,1), box-shadow 0.18s ease, border-color 0.18s ease, opacity 0.18s ease;
}
/* Rarity bar along the top edge */
.player-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--tier, #8a97a0);
  box-shadow: 0 0 10px var(--tier, #8a97a0);
  z-index: 3;
}
/* Holographic sheen, parked off-card until hover */
.player-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.16) 48%, rgba(255,255,255,0.03) 56%, transparent 72%);
  transform: translateX(-120%);
  transition: transform 0.6s ease;
  pointer-events: none;
  z-index: 2;
}
.player-card.affordable {
  cursor: pointer;
  opacity: 1;
  border-color: color-mix(in srgb, var(--tier, #8a97a0) 55%, #333);
}
.player-card.affordable:hover {
  transform: translateY(-5px) scale(1.02);
  border-color: var(--tier, #8a97a0);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 12px 28px rgba(0,0,0,0.55),
    0 0 22px color-mix(in srgb, var(--tier, #8a97a0) 45%, transparent);
}
.player-card.affordable:hover::after { transform: translateX(120%); }
.player-card strong { font-size: 0.92rem; letter-spacing: 0.01em; color: #fff; line-height: 1.15; }
.card-cost {
  align-self: flex-start;
  font-weight: 800;
  font-size: 0.7rem;
  color: #241a00;
  background: linear-gradient(180deg, #ffe680, #f1c40f);
  padding: 1px 9px;
  border-radius: 999px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.45);
}
.card-stats { color: #9a9a9a; font-size: 0.7rem; letter-spacing: 0.02em; }
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

/* Tier colours: keep border-color for the shared bench cards, add --tier for
   the shop's rarity styling above. */
.cost-1 { border-color: #7f8c8d; --tier: #8a97a0; }
.cost-2 { border-color: #27ae60; --tier: #2ecc71; }
.cost-3 { border-color: #2980b9; --tier: #3498db; }
.cost-4 { border-color: #9b59b6; --tier: #a569d6; }
.cost-5 { border-color: #f1c40f; --tier: #f1c40f; }

/* Supermax (cost 5): a warm foil field and a pulsing rarity bar. */
.player-card.cost-5 {
  background: linear-gradient(160deg, rgba(62,52,20,0.96) 0%, rgba(28,23,10,0.98) 58%, rgba(16,13,6,1) 100%);
}
.player-card.cost-5.affordable::before { animation: foil-pulse 2.2s ease-in-out infinite; }
@keyframes foil-pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }

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

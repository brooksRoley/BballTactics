<template>
  <section class="sa" aria-labelledby="sa-title">
    <header class="sa-head">
      <div>
        <p class="sa-kicker">Shootaround · no stakes</p>
        <h2 id="sa-title" class="sa-title">Try anything</h2>
        <p class="sa-line">Pick any five, place them, watch a scrimmage. No HP, no gold. Run it again as often as you like.</p>
      </div>
      <button class="sa-btn" @click="$emit('exit')">Back to Open Gym</button>
    </header>

    <p v-if="loadError" class="sa-error" role="alert">{{ loadError }}</p>

    <template v-else-if="ready">
      <!-- Place: the real planning court, with every player on the bench -->
      <div v-show="screen === 'place'" class="sa-place">
        <div class="sa-calls">
          <label class="sa-call">
            <span>Your offense</span>
            <select v-model="myOffense">
              <option v-for="o in schemeList.offenses" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </label>
          <label class="sa-call">
            <span>Your coverage</span>
            <select v-model="myCoverage">
              <option v-for="c in schemeList.coverages" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
        </div>
        <PlanningPhase
          :bench="bench"
          :max-on-court="SANDBOX_COURT_CAP"
          @update:bench="bench = $event"
          @locked-in="onLockedIn"
        />
      </div>

      <!-- Scrimmage -->
      <CourtCanvas
        v-if="screen === 'sim'"
        :key="'sa-' + seed"
        :court-lineup="lineup"
        :opponent-units="opponent"
        :home-multiplier="matchup.home.offenseMultiplier"
        :away-multiplier="matchup.away.offenseMultiplier"
        :coverage="myCoverage"
        :auto-start="true"
        @sim-complete="onSimComplete"
      />

      <!-- After -->
      <div v-if="screen === 'after' && summary" class="sa-after" aria-live="polite">
        <h3 class="sa-verdict">{{ summary.verdict }}</h3>
        <p v-if="summary.overtime" class="sa-note">It took overtime.</p>
        <ol v-if="summary.scorers.length" class="sa-scorers">
          <li v-for="s in summary.scorers" :key="s.name">{{ s.name }} <strong>{{ s.points }}</strong></li>
        </ol>
        <p class="sa-note">They ran {{ calls.offense.name }} and covered with {{ calls.coverage.name }}.</p>
        <div class="sa-actions">
          <button class="sa-go" data-sfx="none" @click="again">Run it again</button>
          <button class="sa-btn" @click="screen = 'place'">Change the lineup</button>
        </div>
      </div>
    </template>

    <p v-else class="sa-note">Loading the roster…</p>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, provide } from 'vue';
import PlanningPhase from './PlanningPhase.vue';
import CourtCanvas from './CourtCanvas.vue';
import { listSchemes, getScheme } from '../game/tactics.js';
import {
  SANDBOX_COURT_CAP, sandboxBench, scrimmageOpponent, scrimmageMatchups, summarizeScrimmage,
} from '../game/shootaround.js';

defineEmits(['exit']);

// The scrimmage runs on the JS backup ref (fallbackSim.js). Hide the run's WASM
// engine from the children so it is never loaded with a sandbox board.
provide('engine', ref(null));

const schemeList = listSchemes();
const myOffense = ref(schemeList.offenses[0].id);
const myCoverage = ref(schemeList.coverages[0].id);

const roster = ref([]);
const bench = ref([]);
const ready = ref(false);
const loadError = ref('');

const screen = ref('place'); // place | sim | after
const seed = ref(1);
const lineup = ref([]);
const opponent = ref([]);
const matchup = ref({ home: { offenseMultiplier: 1 }, away: { offenseMultiplier: 1 }, calls: {} });
const summary = ref(null);

const calls = computed(() => ({
  offense: getScheme(matchup.value.calls.offense) || { name: 'a set' },
  coverage: getScheme(matchup.value.calls.coverage) || { name: 'a coverage' },
}));

onMounted(async () => {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'engine_roster.json');
    roster.value = await res.json();
    bench.value = sandboxBench(roster.value);
    ready.value = true;
  } catch (e) {
    console.error('Shootaround: roster failed to load', e);
    loadError.value = 'The roster would not load. Back out and try again.';
  }
});

const setUp = () => {
  opponent.value = scrimmageOpponent(roster.value, lineup.value, seed.value);
  matchup.value = scrimmageMatchups({
    myOffense: myOffense.value, myCoverage: myCoverage.value,
    myUnits: lineup.value, theirUnits: opponent.value, seed: seed.value,
  });
  screen.value = 'sim';
};
const onLockedIn = (placed) => {
  lineup.value = (placed || []).map((u) => ({ ...u }));
  seed.value = (Date.now() % 100000) + 1;
  setUp();
};
const again = () => { seed.value += 1; setUp(); };
const onSimComplete = (result) => {
  summary.value = summarizeScrimmage(result, lineup.value);
  screen.value = 'after';
};
</script>

<style scoped>
.sa { border: 1px solid #3a4352; border-radius: 14px; background: #101b2b; padding: 18px; color: #e9e3d6; }
.sa-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.sa-kicker { margin: 0; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.28em; text-transform: uppercase; color: #f2b45f; }
.sa-title { margin: 6px 0 4px; font-size: clamp(1.6rem, 5vw, 2.4rem); line-height: 1; font-weight: 900; color: #fff; }
.sa-line, .sa-note { margin: 0; color: #c9c3b6; line-height: 1.5; font-size: 0.95rem; }
.sa-error { color: #ffb4a8; }
.sa-calls { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.sa-call { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: #c9c3b6; }
.sa-call select { min-height: 40px; background: #1a2638; color: #e9e3d6; border: 1px solid #3a4352; border-radius: 8px; padding: 6px 10px; }
.sa-btn, .sa-go { border-radius: 999px; font-weight: 800; cursor: pointer; min-height: 40px; }
.sa-btn { padding: 8px 18px; color: #e9e3d6; background: rgba(233, 227, 214, 0.08); border: 1px solid rgba(233, 227, 214, 0.3); }
.sa-go { padding: 10px 26px; border: none; color: #101b2b; background: #f2b45f; box-shadow: 0 4px 0 #a8642a; text-transform: uppercase; letter-spacing: 0.04em; }
.sa-btn:focus-visible, .sa-go:focus-visible, .sa-call select:focus-visible { outline: 3px solid #f2b45f; outline-offset: 3px; }
.sa-after { text-align: center; padding: 18px 0 6px; }
.sa-verdict { margin: 0 0 8px; font-size: 1.6rem; color: #fff; }
.sa-scorers { list-style: none; padding: 0; margin: 10px 0; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
.sa-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 14px; }
</style>

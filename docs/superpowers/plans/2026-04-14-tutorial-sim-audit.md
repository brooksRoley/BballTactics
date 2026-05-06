# Tutorial & Sim Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the tutorial to render inside the app container, replace mock data with the real roster, extend the sim clock and add a live event ticker, and extract a shared PlayerCard component.

**Architecture:** Four tasks in dependency order — sim ticker (independent), tutorial layout + roster unification (coupled), then shared card extraction (depends on roster unification). The tutorial currently owns its own full-viewport coordinate space and mock player data; after this plan, it's a normal in-flow component sharing data and card UI with the planning phase.

**Tech Stack:** Vue 3 (Options API in TutorialPhase1, Composition API elsewhere), HTML5 Canvas (CourtCanvas), no build changes required.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `client/components/CourtCanvas.vue` | Extend SIM_DURATION; add eventTicker reactive array; push events to ticker; render ticker in template |
| Modify | `client/components/TutorialPhase1.vue` | Remove 100vw layout; accept `roster` prop; build shopPool from real roster; display compact cards; remove all mock data |
| Modify | `client/App.vue` | Convert `allPlayers` to `ref`; pass `:roster="allPlayers"` to TutorialPhase1; remove player card styles (moved to PlayerCard) |
| Create | `client/components/PlayerCard.vue` | Shared card component: cost badge, name, SPD/SHT/DEF stats, affordability state, tutorial-target glow |

---

## Task 1: Extend SIM_DURATION + Add Event Ticker

**Files:**
- Modify: `client/components/CourtCanvas.vue`

- [ ] **Step 1.1 — Change the sim duration constant**

In `CourtCanvas.vue`, line 89, change:
```javascript
const SIM_DURATION = 10.0;
```
to:
```javascript
const SIM_DURATION = 24.0;
```

- [ ] **Step 1.2 — Add the eventTicker reactive array**

After the `eventLog` and `playerPoints` declarations (around line 57), add:
```javascript
const eventTicker = ref([]);
let tickerIdCounter = 0;
```

- [ ] **Step 1.3 — Push events into the ticker inside attributeScore**

Replace the existing `attributeScore` function with:
```javascript
const attributeScore = (pts, isHome) => {
  const possId = ball.value.possessorId;
  let tickerText;
  if (isHome) {
    const scorer = livePlayers.value.find(p => p.id === possId);
    const name = scorer?.name || `Player ${possId}`;
    playerPoints[possId] = (playerPoints[possId] || { id: possId, name, points: 0 });
    playerPoints[possId].points += pts;
    const label = pts === 3 ? 'Three!' : 'Score!';
    const shortName = name.split(' ').pop();
    tickerText = `${shortName} hits a ${pts === 3 ? 'three-pointer' : 'bucket'} (+${pts})`;
    eventLog.push(tickerText);
    spawnPopup(ball.value.x, ball.value.y - 20, `+${pts}`, 'score-home');
    statusText.value = `${shortName} — ${label}`;
  } else {
    tickerText = `Opponent scores (+${pts})`;
    eventLog.push(tickerText);
    spawnPopup(ball.value.x, ball.value.y - 20, `+${pts}`, 'score-away');
    statusText.value = 'Opponent scores...';
  }
  eventTicker.value = [
    ...eventTicker.value,
    { id: ++tickerIdCounter, text: tickerText, type: isHome ? 'home' : 'away' }
  ].slice(-5);
  setTimeout(() => { if (!simDone) statusText.value = ''; }, 1000);
};
```

- [ ] **Step 1.4 — Expose eventTicker from setup**

In the `return` statement of `CourtCanvas.vue` setup, add `eventTicker`:
```javascript
return { homeScore, awayScore, timeLeft, statusText, activePopups, eventTicker, courtScaler, courtCanvas, courtScale, COURT_W, COURT_H, dpr };
```

- [ ] **Step 1.5 — Add ticker to the template**

After the `<div class="sim-status">` element, add:
```html
<div class="event-ticker">
  <div
    v-for="ev in eventTicker"
    :key="ev.id"
    class="ticker-entry"
    :class="ev.type"
  >{{ ev.text }}</div>
  <div v-if="eventTicker.length === 0" class="ticker-empty">Tip-off…</div>
</div>
```

- [ ] **Step 1.6 — Add ticker CSS**

At the bottom of the `<style scoped>` block in `CourtCanvas.vue`, add:
```css
.event-ticker {
  width: 100%;
  max-width: 800px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 6px 12px;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ticker-entry {
  font-size: 0.78rem;
  color: #666;
  line-height: 1.3;
}
.ticker-entry.home { color: #d9534f; }
.ticker-entry.away { color: #5bc0de; }
.ticker-empty {
  font-size: 0.78rem;
  color: #444;
  font-style: italic;
}
```

- [ ] **Step 1.7 — Verify in browser**

Run `npm run dev` from the project root. Play through a round. Confirm:
- The sim runs for ~24 seconds
- The ticker below the court shows scored events in red (home) or cyan (away)
- At most 5 entries appear at once (older ones drop off)

- [ ] **Step 1.8 — Commit**

```bash
git add client/components/CourtCanvas.vue
git commit -m "feat: extend sim to 24s and add live event ticker"
```

---

## Task 2: Rework Tutorial Layout + Real Roster

**Files:**
- Modify: `client/components/TutorialPhase1.vue`
- Modify: `client/App.vue`

### 2a — Make allPlayers reactive in App.vue

- [ ] **Step 2a.1 — Convert allPlayers to a ref**

In `client/App.vue`, around line 188, change:
```javascript
let allPlayers = [];
```
to:
```javascript
const allPlayers = ref([]);
```

- [ ] **Step 2a.2 — Update allPlayers assignments in fetchRoster**

In `fetchRoster`, replace:
```javascript
allPlayers = await apiResponse.json();
```
with:
```javascript
allPlayers.value = await apiResponse.json();
```

And replace:
```javascript
allPlayers = await response.json();
```
with:
```javascript
allPlayers.value = await response.json();
```

- [ ] **Step 2a.3 — Update allPlayers reads**

In `refreshShop`:
```javascript
const available = allPlayers.value.filter(p =>
  !bench.value.find(b => b.id === p.id)
);
```

In `onTutorialComplete`:
```javascript
const rosterMatch = allPlayers.value.find(p =>
  p.name.toLowerCase() === tutorialPlayer.name.toLowerCase()
);
```

- [ ] **Step 2a.4 — Pass roster prop to TutorialPhase1**

In `App.vue` template, change:
```html
<TutorialPhase1
  v-if="phase === 'tutorial'"
  @phase-one-complete="onTutorialComplete"
/>
```
to:
```html
<TutorialPhase1
  v-if="phase === 'tutorial'"
  :roster="allPlayers"
  @phase-one-complete="onTutorialComplete"
/>
```

### 2b — Rework TutorialPhase1.vue

- [ ] **Step 2b.1 — Accept the roster prop and remove mock data**

Replace the entire `<script>` block with:
```html
<script>
import { ref, computed } from 'vue';

export default {
  name: 'TutorialPhaseOne',
  props: {
    roster: { type: Array, default: () => [] }
  },
  setup(props, { emit }) {
    const currentStep = ref(0);
    const draftCapital = ref(10);
    const purchasedPlayer = ref(null);
    const coachError = ref('');

    const tutorialText = [
      "You don't win championships with just money, but you sure as hell lose without it. Welcome to the Draft Shop.",
      "This is your Cap Space. You get a base amount every round, plus interest. Don't spend it all in one place.",
      "Players cost Draft Capital based on tier. Draft Alex Caruso to continue.",
      "Good. He's on your bench. Now you need a system."
    ];

    // Build a curated 5-player tutorial pool from the real roster.
    // Caruso (id 4, cost 3) is always included as the required pick.
    const shopPool = computed(() => {
      if (!props.roster.length) return [];
      const caruso   = props.roster.find(p => p.id === 4);
      const cost1    = props.roster.find(p => p.cost === 1 && p.id !== 4);
      const cost2    = props.roster.find(p => p.cost === 2 && p.id !== 4);
      const cost4    = props.roster.find(p => p.cost === 4 && p.id !== 4);
      const cost5    = props.roster.find(p => p.cost === 5 && p.id !== 4);
      return [cost1, cost2, caruso, cost4, cost5].filter(Boolean);
    });

    const advanceTutorial = () => { currentStep.value++; };

    const buyPlayer = (player) => {
      if (currentStep.value !== 2) return;
      if (player.id !== 4) {
        coachError.value = "I said draft Caruso, rookie. Pay attention.";
        setTimeout(() => { coachError.value = ''; }, 2500);
        return;
      }
      if (draftCapital.value >= player.cost) {
        draftCapital.value -= player.cost;
        purchasedPlayer.value = player;
        currentStep.value = 3;
        setTimeout(() => { emit('phase-one-complete', purchasedPlayer.value); }, 2500);
      }
    };

    return {
      currentStep, tutorialText, draftCapital,
      shopPool, purchasedPlayer, coachError,
      advanceTutorial, buyPlayer
    };
  }
}
</script>
```

- [ ] **Step 2b.2 — Rewrite the template**

Replace the entire `<template>` block with:
```html
<template>
  <div class="tutorial-wrapper">

    <!-- Dimming overlay (active from step 1 onward) -->
    <div class="tutorial-overlay" :class="{ active: currentStep > 0 }"></div>

    <!-- Coach dialogue -->
    <div class="dialogue-box" v-if="currentStep <= 3">
      <span class="coach-name">COACH MILLER</span>
      <p class="dialogue-text">{{ coachError || tutorialText[currentStep] }}</p>
      <button v-if="currentStep < 2" class="next-btn" @click="advanceTutorial">
        Continue
      </button>
    </div>

    <!-- Economy bar -->
    <div class="economy-bar" :class="{ 'highlight-pulse': currentStep === 1 }">
      <span class="label">Draft Capital</span>
      <span class="gold-amount">{{ draftCapital }}G</span>
    </div>

    <!-- Draft shop -->
    <div class="draft-shop" :class="{ 'highlight-target': currentStep === 2 }">
      <h3 class="shop-title">Available Free Agents</h3>
      <div class="cards-container">
        <div
          v-for="player in shopPool"
          :key="player.id"
          class="player-card affordable"
          :class="[
            `cost-${player.cost}`,
            { 'tutorial-target': currentStep === 2 && player.id === 4 }
          ]"
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

    <!-- Bench preview -->
    <div class="bench-area">
      <div class="bench-slot" v-for="n in 8" :key="n">
        <div v-if="n === 1 && purchasedPlayer" class="player-token">
          {{ purchasedPlayer.name.split(' ').pop() }}
        </div>
      </div>
    </div>

  </div>
</template>
```

- [ ] **Step 2b.3 — Rewrite the scoped styles**

Replace the entire `<style scoped>` block with:
```html
<style scoped>
.tutorial-wrapper {
  position: relative;
  min-height: 500px;
  padding-top: 120px; /* room for the absolute dialogue box */
}

.tutorial-overlay {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.65);
  z-index: 10;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
  border-radius: 4px;
}
.tutorial-overlay.active { opacity: 1; }

.dialogue-box {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(580px, 95%);
  background: #1e1e1e;
  border: 2px solid #8b5a2b;
  border-left: 6px solid #d9534f;
  padding: 16px 20px;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.7);
  border-radius: 4px;
}
.coach-name {
  display: block;
  font-weight: 900;
  color: #d9534f;
  letter-spacing: 2px;
  font-size: 0.75rem;
  margin-bottom: 8px;
}
.dialogue-text {
  font-size: 1rem;
  line-height: 1.5;
  margin: 0 0 12px;
  font-style: italic;
  color: #e0e0e0;
}
.next-btn {
  background: #333;
  color: white;
  border: 1px solid #555;
  padding: 6px 14px;
  cursor: pointer;
  border-radius: 3px;
  font-size: 0.85rem;
}
.next-btn:hover { background: #d9534f; border-color: #d9534f; }

.economy-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  background: #1f1f1f;
  padding: 10px 16px;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 1.1rem;
  margin-bottom: 12px;
  position: relative;
  z-index: 5;
}
.label { color: #888; font-size: 0.85rem; }
.gold-amount { font-weight: bold; color: #ffd700; }

.highlight-pulse {
  z-index: 50 !important;
  box-shadow: 0 0 16px 4px rgba(217, 83, 79, 0.5);
}
.highlight-target {
  position: relative;
  z-index: 50;
}

.shop-title {
  margin: 0 0 10px;
  font-size: 0.9rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.draft-shop { margin-bottom: 12px; }
.cards-container {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Tutorial-target glow (overrides the global player-card for Caruso) */
.tutorial-target {
  box-shadow: 0 0 14px 4px rgba(91, 192, 222, 0.8) !important;
  animation: pulse-border 1.5s infinite;
}
@keyframes pulse-border {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

.bench-area {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 60px;
  background: #111;
  border-top: 2px solid #8b5a2b;
  padding: 8px;
  border-radius: 0 0 4px 4px;
}
.bench-slot {
  width: 54px; height: 54px;
  border: 1px dashed #333;
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
}
.player-token {
  width: 44px; height: 44px;
  background: #d9534f;
  border-radius: 50%;
  font-size: 0.6rem;
  font-weight: bold;
  color: #fff;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
```

- [ ] **Step 2b.4 — Verify tutorial renders correctly**

Run `npm run dev`. On first load, confirm:
- Tutorial renders within the 900px `.app` container (no viewport bleed)
- Top-bar (HP/Gold/Round) is visible above the tutorial
- The 5 cards show real players (Patty Mills 1G, Draymond Green 2G, Alex Caruso 3G, etc.) with SPD/SHT/DEF stats
- Clicking wrong players shows Coach Miller error in the dialogue box
- Clicking Caruso advances to step 3 and transitions to planning after 2.5s

- [ ] **Step 2b.5 — Commit**

```bash
git add client/components/TutorialPhase1.vue client/App.vue
git commit -m "feat: rework tutorial layout in-flow and replace mock data with real roster"
```

---

## Task 3: Extract Shared PlayerCard Component

**Files:**
- Create: `client/components/PlayerCard.vue`
- Modify: `client/App.vue` (use PlayerCard in shop section, remove inline card styles)

- [ ] **Step 3.1 — Create PlayerCard.vue**

Create `/Users/brooks/Desktop/BballTactics/client/components/PlayerCard.vue`:
```vue
<template>
  <div
    class="player-card"
    :class="[
      `cost-${player.cost}`,
      { affordable: isAffordable, 'tutorial-target': isTutorialTarget }
    ]"
    @click="$emit('select', player)"
  >
    <span class="card-cost">{{ player.cost }}G</span>
    <strong class="card-name">{{ player.name }}</strong>
    <span class="card-stats">
      SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }} / DEF {{ player.stats.defense }}
    </span>
  </div>
</template>

<script>
export default {
  name: 'PlayerCard',
  props: {
    player:          { type: Object,  required: true },
    isAffordable:    { type: Boolean, default: true },
    isTutorialTarget:{ type: Boolean, default: false }
  },
  emits: ['select']
};
</script>

<style scoped>
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
  border-radius: 3px;
}
.player-card.affordable {
  cursor: pointer;
  opacity: 1;
}
.player-card.affordable:hover { transform: translateY(-3px); }
.card-cost  { color: #ffd700; font-weight: bold; font-size: 0.75rem; }
.card-name  { color: #e0e0e0; }
.card-stats { color: #777; font-size: 0.7rem; }

.cost-1 { border-color: #7f8c8d; }
.cost-2 { border-color: #27ae60; }
.cost-3 { border-color: #2980b9; }
.cost-4 { border-color: #9b59b6; }
.cost-5 { border-color: #f1c40f; }

.tutorial-target {
  box-shadow: 0 0 14px 4px rgba(91, 192, 222, 0.8) !important;
  animation: pulse-border 1.5s infinite;
}
@keyframes pulse-border {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.04); }
}
</style>
```

- [ ] **Step 3.2 — Import and use PlayerCard in App.vue shop section**

At the top of `<script setup>` in `App.vue`, add:
```javascript
import PlayerCard from './components/PlayerCard.vue';
```

In the template, replace the inline `.player-card` div block:
```html
<!-- REMOVE THIS: -->
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

<!-- REPLACE WITH: -->
<PlayerCard
  v-for="player in shop"
  :key="player.id"
  :player="player"
  :is-affordable="gold >= player.cost"
  @select="buyPlayer(player)"
/>
```

- [ ] **Step 3.3 — Remove the now-redundant card styles from App.vue**

In `App.vue`'s `<style>` block, remove the following rules entirely (they are now owned by `PlayerCard.vue`):
```css
/* DELETE these blocks from App.vue: */
.player-card { ... }
.player-card.affordable { ... }
.player-card.affordable:hover { ... }
.card-cost { ... }
.card-stats { ... }
.cost-1 { ... }
.cost-2 { ... }
.cost-3 { ... }
.cost-4 { ... }
.cost-5 { ... }
```

- [ ] **Step 3.4 — Use PlayerCard in TutorialPhase1.vue**

In `TutorialPhase1.vue`, import PlayerCard and replace the inline card div:

Add to `<script>`:
```javascript
import PlayerCard from './PlayerCard.vue';
// Add to components: { PlayerCard } or keep Options API and declare it:
```

Since TutorialPhase1 uses Options API, add `components` to the export:
```javascript
export default {
  name: 'TutorialPhaseOne',
  components: { PlayerCard },
  props: { ... },
  setup(...) { ... }
}
```

In the template, replace the inline card div in `.cards-container`:
```html
<!-- REMOVE: -->
<div
  v-for="player in shopPool"
  :key="player.id"
  class="player-card affordable"
  :class="[`cost-${player.cost}`, { 'tutorial-target': currentStep === 2 && player.id === 4 }]"
  @click="buyPlayer(player)"
>
  <span class="card-cost">{{ player.cost }}G</span>
  <strong>{{ player.name }}</strong>
  <span class="card-stats">SPD ... / SHT ... / DEF ...</span>
</div>

<!-- REPLACE WITH: -->
<PlayerCard
  v-for="player in shopPool"
  :key="player.id"
  :player="player"
  :is-affordable="true"
  :is-tutorial-target="currentStep === 2 && player.id === 4"
  @select="buyPlayer(player)"
/>
```

Remove the inline card styles from TutorialPhase1's `<style scoped>` — `.tutorial-target` and `@keyframes pulse-border` are now inside `PlayerCard.vue`.

- [ ] **Step 3.5 — Verify both contexts render correctly**

Run `npm run dev`. Confirm:
- Tutorial shop: same card layout as the planning phase shop (cost badge, name, SPD/SHT/DEF)
- Planning phase shop: unchanged appearance
- Caruso in tutorial shows cyan glow; other cards show normal
- Affordability dimming works in planning phase (dim cards you can't afford)

- [ ] **Step 3.6 — Commit**

```bash
git add client/components/PlayerCard.vue client/components/TutorialPhase1.vue client/App.vue
git commit -m "feat: extract shared PlayerCard component, unify tutorial and shop card design"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (tutorial in .app container): covered in Task 2b — `.tutorial-wrapper` becomes `position: relative; min-height: 500px; padding-top: 120px`, dialogue positioned within wrapper
- Item 3 (real roster in tutorial): covered in Task 2a+2b — `allPlayers` becomes a ref, passed as `:roster` prop, shopPool built from real IDs, mock data removed, buyPlayer checks `player.id === 4`
- Item 8 (24s sim + ticker): covered in Task 1 — `SIM_DURATION = 24`, `eventTicker` array, ticker template and CSS
- Item 13 (shared card): covered in Task 3 — `PlayerCard.vue` created, used in both App.vue shop and TutorialPhase1

**Placeholder scan:** No TBDs. All code blocks are complete. CSS is fully written out.

**Type consistency:**
- `shopPool` computed in TutorialPhase1 returns objects from `props.roster` — same shape as `{ id, name, cost, stats: { speed, shooting, defense } }` used in PlayerCard template — consistent
- `player.id === 4` (Caruso's real ID from roster) used in both shopPool curated list and buyPlayer guard — consistent
- `eventTicker` ref used in attributeScore push and in return/template — consistent
- PlayerCard emits `'select'` and callers use `@select="..."` — consistent in both App.vue and TutorialPhase1

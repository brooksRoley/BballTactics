<template>
  <div class="tutorial-wrapper">
    <div class="tutorial-overlay" :class="{ 'active': currentStep > 0 }"></div>

    <div class="dialogue-box" v-if="currentStep <= 3">
      <div class="coach-portrait">
        <span class="coach-name">COACH MILLER</span>
      </div>
      <p class="dialogue-text">{{ tutorialText[currentStep] }}</p>
      <button 
        v-if="currentStep < 2" 
        class="next-btn" 
        @click="advanceTutorial">
        Continue (Press Space)
      </button>
    </div>

    <div class="front-office-container">
      
      <div class="economy-bar" :class="{ 'highlight-pulse': currentStep === 1 }">
        <span class="label">Draft Capital</span>
        <span class="gold-amount">{{ draftCapital }}G</span>
      </div>

      <div class="draft-shop" :class="{ 'highlight-target': currentStep === 2 }">
        <h2>Available Free Agents</h2>
        <div class="cards-container">
          <div 
            v-for="(player, index) in shopPool" 
            :key="player.id"
            class="player-card"
            :class="[
              `cost-${player.cost}`, 
              { 'tutorial-target': currentStep === 2 && player.id === 'caruso_1' }
            ]"
            @click="buyPlayer(player)"
          >
            <div class="card-header">
              <span class="cost">{{ player.cost }}G</span>
            </div>
            <div class="card-body">
              <h3>{{ player.name }}</h3>
              <p class="role">{{ player.role }}</p>
            </div>
            <div class="card-footer">
              <span class="tag" v-for="tag in player.tags" :key="tag">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="bench-area">
        <div class="bench-slot" v-for="n in 8" :key="n">
          <div v-if="n === 1 && purchasedPlayer" class="player-token">
            {{ purchasedPlayer.name }}
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';

export default {
  name: 'TutorialPhaseOne',
  setup(props, { emit }) {
    // Tutorial State Machine
    const currentStep = ref(0);
    const draftCapital = ref(10);
    const purchasedPlayer = ref(null);

    const tutorialText = [
      "You don't win championships with just money, but you sure as hell lose without it. Welcome to the Draft Shop.",
      "This is your Cap Space. You get a base amount every round, plus interest if you hoard it. Don't spend it all in one place.",
      "Players cost Draft Capital based on their real-world salary. A gray border? Veteran minimum, costs 1G. A gold border? That’s a Supermax. Draft Alex Caruso to continue.",
      "Good. He's on your bench. Now you need a system."
    ];

    // Mock Shop Data for the tutorial
    const shopPool = ref([
      { id: 'random_1', name: 'Udonis Haslem', cost: 1, role: 'Enforcer', tags: ['Heat', 'Locker Room'] },
      { id: 'random_2', name: 'PJ Tucker', cost: 2, role: 'Corner Threat', tags: ['Corner Specialist', 'Hustle'] },
      { id: 'caruso_1', name: 'Alex Caruso', cost: 1, role: 'Guard', tags: ['Bulls', 'Perimeter Lockdown'] },
      { id: 'random_3', name: 'Steph Curry', cost: 5, role: 'Superstar', tags: ['Warriors', 'Splash Family'] },
      { id: 'random_4', name: 'Rudy Gobert', cost: 4, role: 'Center', tags: ['Timberwolves', 'Paint Protector'] }
    ]);

    const advanceTutorial = () => {
      currentStep.value++;
    };

    const buyPlayer = (player) => {
      // Enforce tutorial rules: They MUST click Caruso to proceed
      if (currentStep.value === 2) {
        if (player.id !== 'caruso_1') {
          // Play a buzz/error sound here in full production
          console.log("Coach Miller: 'I said draft Caruso, rookie. Pay attention.'");
          return;
        }
        
        // Process the transaction
        if (draftCapital.value >= player.cost) {
          draftCapital.value -= player.cost;
          purchasedPlayer.value = player;
          
          // Remove from shop
          shopPool.value = shopPool.value.filter(p => p.id !== player.id);
          
          // Advance the tutorial to the next dialogue
          currentStep.value = 3;
          
          // Emit an event after a short delay to trigger Phase 2 (The Locker Room)
          setTimeout(() => {
            emit('phase-one-complete', purchasedPlayer.value);
          }, 2500);
        }
      }
    };

    return {
      currentStep,
      tutorialText,
      draftCapital,
      shopPool,
      purchasedPlayer,
      advanceTutorial,
      buyPlayer
    };
  }
}
</script>

<style scoped>
/* Core Typography and Colors */
.tutorial-wrapper {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #e0e0e0;
  height: 100vh;
  width: 100vw;
  background-color: #121212; /* Deep slate */
  position: relative;
  overflow: hidden;
}

/* The Z-Index Magic for the Tutorial Overlay */
.tutorial-overlay {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.tutorial-overlay.active { opacity: 1; }

/* Coach Miller's Dialogue */
.dialogue-box {
  position: absolute;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  background: #1e1e1e;
  border: 2px solid #8b5a2b; /* Hardwood accent */
  border-left: 8px solid #d9534f;
  padding: 20px;
  z-index: 100;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
}
.coach-name {
  font-weight: 900;
  color: #d9534f;
  letter-spacing: 2px;
  font-size: 0.9rem;
}
.dialogue-text {
  font-size: 1.2rem;
  line-height: 1.5;
  margin: 15px 0;
  font-style: italic;
}
.next-btn {
  background: #333;
  color: white;
  border: 1px solid #555;
  padding: 8px 16px;
  cursor: pointer;
}
.next-btn:hover { background: #d9534f; border-color: #d9534f; }

/* The UI Elements */
.front-office-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  z-index: 5;
}

/* Highlighting Logic */
.highlight-pulse {
  z-index: 50 !important;
  position: relative;
  box-shadow: 0 0 20px 5px rgba(217, 83, 79, 0.6);
  background: #2a2a2a !important;
  border-radius: 4px;
}
.highlight-target {
  z-index: 50 !important;
  position: relative;
}
.tutorial-target {
  box-shadow: 0 0 15px 5px rgba(91, 192, 222, 0.8); /* Cyan glow for the correct click */
  animation: pulse-border 1.5s infinite;
  cursor: pointer !important;
}

@keyframes pulse-border {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* Economy Bar */
.economy-bar {
  align-self: flex-end;
  background: #1f1f1f;
  padding: 15px 25px;
  border: 1px solid #333;
  font-size: 1.4rem;
}
.gold-amount { font-weight: bold; color: #ffd700; margin-left: 10px; }

/* Draft Shop */
.draft-shop {
  margin-top: auto;
  margin-bottom: 20px;
}
.cards-container {
  display: flex;
  gap: 15px;
  justify-content: center;
}

/* Player Cards - The Visual Economy */
.player-card {
  width: 180px;
  height: 250px;
  background: #1a1a1a;
  border: 2px solid #444; /* Default gray for 1-cost */
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease;
  cursor: not-allowed; /* Disabled until tutorial says so */
}
.player-card.tutorial-target { cursor: pointer; }
.player-card:hover { transform: translateY(-5px); }

/* Border colors mapped to cost */
.cost-1 { border-color: #7f8c8d; } /* Minimum */
.cost-2 { border-color: #27ae60; } /* Rotation */
.cost-3 { border-color: #2980b9; } /* Starter */
.cost-4 { border-color: #9b59b6; } /* All-Star */
.cost-5 { border-color: #f1c40f; } /* Supermax/Legendary */

.card-header { padding: 10px; text-align: right; border-bottom: 1px solid #333; }
.cost { font-weight: bold; color: #ffd700; }
.card-body { padding: 15px; flex-grow: 1; text-align: center; }
.card-body h3 { margin: 0 0 5px 0; font-size: 1.1rem; }
.role { color: #888; font-size: 0.9rem; margin: 0; }
.card-footer { padding: 10px; display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; }
.tag { font-size: 0.7rem; background: #333; padding: 3px 6px; border-radius: 2px; }

/* Bench (Simplified for Phase 1) */
.bench-area {
  display: flex;
  gap: 10px;
  height: 80px;
  background: #111;
  border-top: 2px solid #8b5a2b; /* Hardwood */
  padding: 10px;
}
.bench-slot {
  width: 60px; height: 60px;
  border: 1px dashed #444;
  display: flex; align-items: center; justify-content: center;
}
.player-token {
  width: 50px; height: 50px;
  background: #2980b9;
  border-radius: 50%;
  font-size: 0.6rem;
  text-align: center;
  line-height: 50px;
  overflow: hidden;
}
</style>
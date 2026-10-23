<template>
  <div class="htp-backdrop" @click.self="$emit('close')">
    <div class="htp" role="dialog" aria-modal="true" aria-labelledby="htp-title" @keydown="onKey" ref="root" tabindex="-1">
      <p class="htp-step">{{ index + 1 }} / {{ cards.length }}</p>
      <h3 id="htp-title" class="htp-title">{{ card.title }}</h3>

      <!-- One picture per idea, drawn from the same numbers as the text. -->
      <svg class="htp-art" viewBox="0 0 300 110" aria-hidden="true">
        <g v-if="card.art === 'hp'">
          <rect x="20" y="40" width="260" height="22" rx="11" fill="#22252c" stroke="#3a4352" />
          <rect x="22" y="42" :width="256 * 0.8" height="18" rx="9" fill="#5cb85c" />
          <rect :x="22 + 256 * 0.8" y="42" :width="256 * 0.2" height="18" rx="9" fill="#d9534f" class="htp-pulse" />
          <text x="150" y="90" text-anchor="middle" class="htp-svg-text">a loss costs {{ LOSS_DAMAGE }} of {{ START_HP }}</text>
        </g>
        <g v-else-if="card.art === 'shop'">
          <g v-for="i in SHOP_SIZE" :key="i" :transform="`translate(${(i - 1) * 56 + 14} 20)`">
            <rect width="48" height="64" rx="7" :fill="['#4a5668', '#2f6f4e', '#2b4f8a', '#6b3fa0', '#a8642a'][i - 1]" class="htp-card" :style="{ animationDelay: (i * 0.08) + 's' }" />
            <text x="24" y="40" text-anchor="middle" class="htp-svg-text big">{{ i }}G</text>
          </g>
        </g>
        <g v-else-if="card.art === 'gold'">
          <g v-for="i in 6" :key="i">
            <ellipse :cx="70 + (i % 3) * 8" :cy="80 - i * 9" rx="26" ry="8" fill="#f2b45f" stroke="#a8642a" stroke-width="2" />
          </g>
          <text x="150" y="50" class="htp-svg-text big">+{{ BASE_INCOME }} a round</text>
          <text x="150" y="76" class="htp-svg-text">+ interest + streak</text>
        </g>
        <g v-else-if="card.art === 'court'">
          <g v-for="r in 5" :key="'r' + r">
            <rect v-for="c in 5" :key="'c' + c" :x="85 + (c - 1) * 26" :y="3 + (r - 1) * 21" width="24" height="19" rx="3"
                  fill="#22252c" stroke="#3a4352" />
          </g>
          <circle v-for="(p, i) in [[1, 2], [3, 2], [2, 4]]" :key="'p' + i"
                  :cx="85 + p[0] * 26 + 12" :cy="3 + p[1] * 21 + 9" r="8" fill="#f2b45f" class="htp-drop" :style="{ animationDelay: (i * 0.2) + 's' }" />
        </g>
        <g v-else-if="card.art === 'stars'">
          <circle v-for="i in 3" :key="i" :cx="40 + i * 40" cy="55" r="16" fill="#4a5668" stroke="#e9e3d6" class="htp-merge" />
          <text x="185" y="62" class="htp-svg-text big">→</text>
          <circle cx="245" cy="55" r="22" fill="#f2b45f" stroke="#fff" stroke-width="2" />
          <text x="245" y="61" text-anchor="middle" class="htp-svg-text dark">★★</text>
        </g>
        <g v-else-if="card.art === 'schemes'">
          <rect x="16" y="28" width="118" height="50" rx="10" fill="#2b4f8a" />
          <text x="75" y="58" text-anchor="middle" class="htp-svg-text">your offense</text>
          <text x="150" y="58" text-anchor="middle" class="htp-svg-text big">vs</text>
          <rect x="166" y="28" width="118" height="50" rx="10" fill="#a8642a" />
          <text x="225" y="58" text-anchor="middle" class="htp-svg-text">their coverage</text>
        </g>
      </svg>

      <p class="htp-body">{{ card.body }}</p>

      <div class="htp-dots" role="tablist" aria-label="Cards">
        <button v-for="(c, i) in cards" :key="c.id" role="tab" :aria-selected="i === index"
                :aria-label="`Card ${i + 1}: ${c.title}`" :class="{ on: i === index }" @click="go(i)"></button>
      </div>
      <div class="htp-nav">
        <button class="htp-btn" :disabled="index === 0" @click="go(index - 1)">← Back</button>
        <button v-if="index < cards.length - 1" class="htp-btn primary" @click="go(index + 1)">Next →</button>
        <button v-else class="htp-btn primary" @click="$emit('close')">Got it</button>
      </div>
      <button class="htp-close" aria-label="Close How to Play" @click="$emit('close')">×</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { howToPlayCards, START_HP, LOSS_DAMAGE } from '../game/howToPlay.js';
import { SHOP_SIZE, BASE_INCOME } from '../game/economy.js';
import { sfx } from '../audio/sfx.js';

const emit = defineEmits(['close']);
const cards = howToPlayCards();
const index = ref(0);
const card = computed(() => cards[index.value]);
const root = ref(null);

const go = (i) => {
  if (i < 0 || i >= cards.length || i === index.value) return;
  index.value = i;
  sfx.play('open');
};
const onKey = (e) => {
  if (e.key === 'ArrowRight') go(index.value + 1);
  else if (e.key === 'ArrowLeft') go(index.value - 1);
  else if (e.key === 'Escape') emit('close');
};
onMounted(() => root.value && root.value.focus());
</script>

<style scoped>
.htp-backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(8, 12, 20, 0.72);
}
.htp {
  position: relative;
  width: min(460px, 100%);
  padding: 26px 24px 20px;
  border-radius: 16px;
  background: #16202f;
  border: 1px solid #3a4352;
  color: #e9e3d6;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  outline: none;
}
.htp-step { margin: 0; font-size: 0.75rem; letter-spacing: 0.2em; color: #f2b45f; font-weight: 800; }
.htp-title { margin: 6px 0 10px; font-size: 1.45rem; color: #fff; font-weight: 900; }
.htp-art { width: 100%; height: auto; margin: 4px 0 8px; }
.htp-svg-text { fill: #e9e3d6; font-size: 12px; font-weight: 700; font-family: inherit; }
.htp-svg-text.big { font-size: 20px; }
.htp-svg-text.dark { fill: #101b2b; font-size: 14px; }
.htp-body { margin: 0 0 16px; line-height: 1.55; min-height: 5.5em; }
.htp-dots { display: flex; gap: 8px; justify-content: center; margin-bottom: 14px; }
.htp-dots button { width: 10px; height: 10px; border-radius: 50%; border: none; background: #3a4352; cursor: pointer; padding: 0; }
.htp-dots button.on { background: #f2b45f; transform: scale(1.25); }
.htp-nav { display: flex; justify-content: space-between; gap: 10px; }
.htp-btn {
  padding: 10px 18px; border-radius: 999px; font-weight: 800; cursor: pointer;
  border: 1px solid #3a4352; background: transparent; color: #e9e3d6;
}
.htp-btn:disabled { opacity: 0.35; cursor: default; }
.htp-btn.primary { background: #f2b45f; color: #101b2b; border-color: #f2b45f; }
.htp-btn:active:not(:disabled) { transform: scale(0.96); }
.htp-btn:focus-visible, .htp-dots button:focus-visible, .htp-close:focus-visible { outline: 3px solid #f2b45f; outline-offset: 2px; }
.htp-close {
  position: absolute; top: 10px; right: 12px;
  background: none; border: none; color: #9aa3ae; font-size: 1.6rem; cursor: pointer; line-height: 1;
}
.htp-card { animation: htp-deal 0.45s ease-out both; }
@keyframes htp-deal { from { transform: translateY(-14px); opacity: 0; } }
.htp-drop { animation: htp-drop 0.5s ease-out both; }
@keyframes htp-drop { from { transform: translateY(-18px); opacity: 0; } }
.htp-pulse { animation: htp-pulse 1.4s ease-in-out infinite; }
@keyframes htp-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .htp-card, .htp-drop, .htp-pulse { animation: none; }
}
</style>

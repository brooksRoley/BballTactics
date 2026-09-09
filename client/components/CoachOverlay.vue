<template>
  <transition name="coach-fade">
    <div v-if="active" class="coach-overlay" :class="'act-' + act">
      <div class="coach-bubble">
        <div class="coach-head">
          <span class="coach-name">COACH MILLER</span>
          <span class="coach-act">{{ actLabel }}</span>
          <button class="coach-skip" @click="$emit('skip')">Skip ✕</button>
        </div>
        <p class="coach-message">{{ message }}</p>
        <p v-if="skillTag" class="coach-skill">🎓 {{ skillTag }}</p>
      </div>
    </div>
  </transition>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'CoachOverlay',
  props: {
    active: { type: Boolean, default: false },
    act: { type: String, default: 'draft' },
    message: { type: String, default: '' },
    skillTag: { type: String, default: '' },
  },
  emits: ['skip'],
  setup(props) {
    const LABELS = {
      draft: 'Act 1 · The Draft',
      placement: 'Act 2 · The Lineup',
      coverage: 'Act 3 · The Coverage',
      done: '',
    };
    const actLabel = computed(() => LABELS[props.act] || '');
    return { actLabel };
  },
};
</script>

<style scoped>
/* Non-modal coach bubble pinned to the bottom — the player can keep drafting,
   placing, and clicking coverage while the coach talks over the real screen. */
.coach-overlay {
  position: fixed;
  left: 50%;
  top: 64px;
  transform: translateX(-50%);
  width: min(680px, 94vw);
  z-index: 200;
  pointer-events: none; /* whole overlay is click-through... */
}
.coach-bubble {
  pointer-events: none; /* ...including the bubble, so it never blocks the game */
  background: linear-gradient(160deg, #232323 0%, #1a1a1a 100%);
  border: 2px solid #8b5a2b;         /* hardwood accent */
  border-left: 8px solid #d9534f;    /* Coach Miller red */
  border-radius: 8px;
  padding: 14px 18px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.7);
}
.coach-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.coach-name {
  font-weight: 900;
  color: #d9534f;
  letter-spacing: 2px;
  font-size: 0.78rem;
}
.coach-act {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #121212;
  background: #ffd700;
  padding: 2px 8px;
  border-radius: 3px;
}
.coach-skip {
  margin-left: auto;
  pointer-events: auto; /* the only interactive part of the overlay */
  background: transparent;
  color: #9a9a9a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.coach-skip:hover { color: #fff; border-color: #6b6b6b; }
.coach-message {
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
  color: #ececec;
}
.coach-skill {
  margin: 10px 0 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #7fd18a;
  border-top: 1px solid #2a2a2a;
  padding-top: 8px;
}

.coach-fade-enter-active,
.coach-fade-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.coach-fade-enter-from,
.coach-fade-leave-to { opacity: 0; transform: translate(-50%, -12px); }

@media (max-width: 600px) {
  .coach-message { font-size: 0.92rem; }
  .coach-overlay { top: 96px; } /* clear the taller wrapped header on mobile */
}
</style>

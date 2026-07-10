import { ref, computed } from "vue";
import {
  STARTING_GOLD,
  BENCH_CAP,
  REROLL_COST,
  rollShop,
  goldIncome,
  sellValue,
  makeUnit,
  planCombine,
} from "../game/economy.js";

/**
 * Shop + bench + gold state for the autochess loop.
 *
 * @param {import('vue').Ref<Array>} rosterRef active roster entries
 * @param {import('vue').Ref<Array>} courtMirrorRef read-only mirror of the
 *        units currently on court (PlanningPhase owns the real court state and
 *        reports it via update:court). Used for copy counting and for finding
 *        cross-zone triples — the actual court mutations go through the ops
 *        registered with setCourtOps().
 */
export function useShop(rosterRef, courtMirrorRef) {
  const gold = ref(STARTING_GOLD);
  const shop = ref([]);
  const bench = ref([]);
  const lastCombine = ref(null); // 2-star unit from the most recent merge (for UI toast)

  // Court mutation ops, registered by App.vue and backed by PlanningPhase:
  // { remove(uids) => boolean, place(unit, courtX, courtY) => boolean }.
  // Both return false when the court isn't available to mutate.
  let courtOps = null;
  const setCourtOps = (ops) => { courtOps = ops; };

  const benchFull = computed(() => bench.value.length >= BENCH_CAP);

  /** 1-star copies of each rosterId owned across bench + court. */
  const ownedCopies = computed(() => {
    const counts = {};
    for (const u of [...bench.value, ...(courtMirrorRef?.value || [])]) {
      if (u.star === 1) counts[u.rosterId] = (counts[u.rosterId] || 0) + 1;
    }
    return counts;
  });

  /** Free shop refresh (used at round start). */
  const roll = (round) => {
    shop.value = rollShop(rosterRef.value, round).map((p, i) => ({ ...p, slot: i }));
  };

  /** Paid reroll. */
  const reroll = (round) => {
    if (gold.value < REROLL_COST) return false;
    gold.value -= REROLL_COST;
    roll(round);
    return true;
  };

  /**
   * Merge 1-star triples into a 2-star wherever the copies sit — court, bench,
   * or a mix. Loops until no triple remains. When a consumed copy was on
   * court, the 2-star replaces it in that cell (via the registered court ops);
   * an all-bench triple merges onto the bench as before.
   */
  const combineTriples = () => {
    let merged = null;
    for (;;) {
      // Only reach onto the court when we can actually mutate it.
      const court = courtOps ? courtMirrorRef?.value || [] : [];
      const plan = planCombine(bench.value, court);
      if (!plan) break;
      // Consume the court copies first; abort cleanly if the court refused
      // (e.g. PlanningPhase not mounted) so no copies are lost.
      if (plan.courtUids.length && !courtOps.remove(plan.courtUids)) break;
      bench.value = bench.value.filter((u) => !plan.benchUids.includes(u.uid));
      // Prefer the consumed court copy's cell; bench the 2-star otherwise.
      const placedOnCourt = plan.placement
        ? courtOps.place(plan.twoStar, plan.placement.courtX, plan.placement.courtY)
        : false;
      if (!placedOnCourt) bench.value = [...bench.value, plan.twoStar];
      merged = plan.twoStar;
    }
    if (merged) lastCombine.value = merged;
    return merged;
  };

  /**
   * Buy a shop slot. Returns the owned unit (or the 2-star it merged into),
   * or null if it can't be bought.
   */
  const buy = (slotIndex) => {
    const entry = shop.value[slotIndex];
    if (!entry) return null;
    if (gold.value < entry.cost) return null;
    if (benchFull.value) return null;

    gold.value -= entry.cost;
    const unit = makeUnit(entry);
    bench.value = [...bench.value, unit];
    shop.value = shop.value.filter((_, i) => i !== slotIndex);

    return combineTriples() || unit;
  };

  /** Sell a unit off the bench for its full cost (2-star refunds 3 copies). */
  const sell = (unit) => {
    if (!bench.value.find((u) => u.uid === unit.uid)) return false;
    gold.value += sellValue(unit);
    bench.value = bench.value.filter((u) => u.uid !== unit.uid);
    return true;
  };

  /** Round income: base + interest + streak. Returns the breakdown for the UI. */
  const collectIncome = (round, streak = 0) => {
    const income = goldIncome(round, gold.value, streak);
    gold.value += income.total;
    return income;
  };

  const reset = () => {
    gold.value = STARTING_GOLD;
    bench.value = [];
    shop.value = [];
    lastCombine.value = null;
  };

  return {
    gold,
    shop,
    bench,
    benchFull,
    ownedCopies,
    lastCombine,
    roll,
    reroll,
    buy,
    sell,
    collectIncome,
    combineTriples,
    setCourtOps,
    reset,
  };
}

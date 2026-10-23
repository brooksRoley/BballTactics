/**
 * howToPlay.js — the words of Open Gym (docs/design/open-gym.md).
 *
 * Every number comes from the module that owns it, so a balance change can't
 * leave the cards teaching an old rule. Pure data: safe under plain `node`.
 */
import {
  SHOP_SIZE, BENCH_CAP, REROLL_COST, BASE_INCOME, INTEREST_CAP, STARTING_GOLD, MAX_ROUNDS, STAR_MULTIPLIER,
  teamSizeCap, interestOn, streakBonus,
} from './economy.js';
import schemes from './schemes.json' with { type: 'json' };

export const START_HP = 100;
export const LOSS_DAMAGE = 20;

/** The pitch: why a first-time player should stay. */
export const PITCH = {
  kicker: 'Open Gym',
  title: 'Hardwood Autochess',
  line: 'Draft five. Call the play. Watch real basketball decide it.',
  why: [
    'Every result has a basketball reason: spacing, shot value, the right coverage against the right offense.',
    `${MAX_ROUNDS} rounds against other players' recorded teams. Lose one and the Film Room shows you why.`,
    'No twitch skill needed. You win by reading the game.',
  ],
};

const capRounds = () => {
  const firstAt = (n) => {
    for (let r = 1; r <= MAX_ROUNDS; r++) if (teamSizeCap(r) >= n) return r;
    return null;
  };
  return { start: teamSizeCap(1), max: teamSizeCap(MAX_ROUNDS), fullAt: firstAt(teamSizeCap(MAX_ROUNDS)) };
};

const streakTiers = () => {
  const tiers = [];
  let last = 0;
  for (let s = 1; s <= 10; s++) {
    const b = streakBonus(s);
    if (b > last) { tiers.push({ streak: s, gold: b }); last = b; }
  }
  return tiers;
};

/** The six cards, one idea each. `art` names the picture HowToPlay draws. */
export function howToPlayCards() {
  const cap = capRounds();
  const tiers = streakTiers();
  const interestPer = (() => { for (let g = 1; g <= 100; g++) if (interestOn(g) === 1) return g; return 10; })();
  return [
    {
      id: 'front-office',
      art: 'hp',
      title: 'You run the front office',
      body: `You draft the players and call the plan; your team plays the game itself. ${MAX_ROUNDS} rounds, ${START_HP} HP. Lose a round and you lose ${LOSS_DAMAGE} HP. Reach 0 and the run is over.`,
    },
    {
      id: 'shop',
      art: 'shop',
      title: 'The shop',
      body: `${SHOP_SIZE} free agents each round. Tap one to buy it. Reroll for ${REROLL_COST} gold to see five more. Your bench holds ${BENCH_CAP}.`,
    },
    {
      id: 'gold',
      art: 'gold',
      title: 'Gold',
      body: `You start with ${STARTING_GOLD}. Each round pays ${BASE_INCOME}, plus 1 interest for every ${interestPer} you've banked (up to ${INTEREST_CAP}), plus a streak bonus of ${tiers.map((t) => t.gold).join('–')} for ${tiers.map((t) => `${t.streak}+`).join(', ')} straight wins or losses. Saving is a strategy.`,
    },
    {
      id: 'court',
      art: 'court',
      title: 'The court',
      body: `Drag or tap players onto the 5×5 grid. You can play ${cap.start} at the start and ${cap.max} by round ${cap.fullAt}. Where they stand is where they start.`,
    },
    {
      id: 'stack',
      art: 'stars',
      title: 'Stack and star',
      body: `Three copies of a player merge into a ★★ with ×${STAR_MULTIPLIER} stats. Two or more from one NBA team make a Franchise bonus. Three shooters at 85+ make Splash Family.`,
    },
    {
      id: 'call',
      art: 'schemes',
      title: 'Call the game',
      body: `Pick an offense (${schemes.offenses.map((o) => o.name).join(', ')}) and a coverage (${schemes.coverages.map((c) => c.name).join(', ')}). Scout the other team, adjust, then tip off.`,
    },
  ];
}

/**
 * The controls tour: each stop points at a real element on the planning
 * screen by its `data-tour` attribute, so it can't drift from the layout.
 */
export const CONTROLS_TOUR = [
  { target: 'status', title: 'Your run', text: 'Round, record, HP and gold. Next round’s income is listed under the shop.' },
  { target: 'schemes', title: 'Your calls', text: 'Offense and coverage. The line under each says what it does in plain words.' },
  { target: 'court', title: 'The court', text: 'Tap or drag players here. Placement is where they start the fight.' },
  { target: 'bench', title: 'The bench', text: `Bought players wait here (up to ${BENCH_CAP}). The × sells one back for its full cost.` },
  { target: 'shop', title: 'Free agents', text: `Tap a card to buy. Reroll costs ${REROLL_COST} gold. The odds line shows which costs can appear this round.` },
  { target: 'lockin', title: 'Lock In & Fight', text: 'When the court looks right, lock in. You’ll see the other team before tip-off and can change your coverage.' },
  { target: 'filmroom', title: 'Film Room', text: 'Coach Miller’s daily tactics puzzles. Practice reads without risking HP.' },
];

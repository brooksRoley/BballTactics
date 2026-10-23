# Open Gym: the front door (spec, 2026-10-23)

*Status: OG1 (Open Gym, How to Play, Controls tour) and OG2 (sound) built 2026-10-23 — `client/components/OpenGym.vue`, `HowToPlay.vue`, `ControlsTour.vue`, `client/audio/sfx.js`, words in `client/game/howToPlay.js`. OG3 (art pass) and OG4 (Shootaround) are next. Companion to `fun-brief.md`, `build-review-2026-10-20.md`
and the tutorial design in `docs/superpowers/specs/`.*

## The problem

The game boots straight into the planning screen (`App.vue`: `phase = ref('planning')`).
A first-time player lands on a shop, a 5×5 grid, two scheme dropdowns, a gold count and
an HP bar, and nothing says where they are or what winning looks like. "Front Office
101" (the `CoachOverlay` tutorial) helps once you're inside, but it rides the real
screens. There is no place to step back and learn the game, and no sound at all
(build review, item 64).

## What Open Gym is

One screen before the planning phase. The game opens on it. It also comes back from a
small "Open Gym" button in the header, and that button never interrupts a fight. It
has five things and no more:

| Item | What it does |
|---|---|
| **Run It** | Starts a 10-round run (today's game). This click also unlocks audio (see Audio). |
| **How to Play** | The spec of the game on six cards, one idea each (below). Swipe/arrow through; ~60 seconds total. |
| **Controls** | The planning screen shown dimmed with numbered hotspots: shop, reroll, bench, court, sell, schemes, Lock In. Tap a number for one line about it. Built on the real `PlanningPhase` layout, not a screenshot, so it can't drift. |
| **Shootaround** | A no-stakes court: pick any five, place them, watch a scrimmage. No HP and no gold, and it replays instantly. This is where placement and schemes get learned by doing (George Fan's rule: teach in a sandbox, visuals over words). |
| **Sound** | On / off, plus a music volume slider, persisted in `localStorage` (wrapped in try/catch). |

"Replay tutorial" moves here from the round-1 planning row.

### How to Play: the six cards (numbers come from the code; keep them in sync)

1. **You're the front office.** You draft and set the plan; your team plays the game itself. 10 rounds, 100 HP. Lose a round, lose 20 HP. Reach 0 and the run ends.
2. **The shop.** Five players are offered each round (`SHOP_SIZE`). Buy with gold. Reroll for 2 (`REROLL_COST`). Your bench holds 8 (`BENCH_CAP`).
3. **Gold.** You start with 10. Each round pays 5, plus 1 interest per 10 banked (max 5), plus a streak bonus of 1–3 for 2+, 4+ or 6+ straight results. Saving is a strategy.
4. **The court.** Drag players onto the 5×5 grid. The court holds 3 in rounds 1–2 and grows by one every two rounds, to 5 (`teamSizeCap`). Where they stand is where they start.
5. **Stack and star.** Three copies of a player make a 2-star. Two or more from one NBA team make a *Franchise* bonus (+5 shooting per pair). Three shooters at 85+ make *Splash Family*.
6. **Call the game.** Pick an offense (Spread Pick-and-Roll, Spain Pick-and-Roll, Zoom, Delay 5-Out, Seven Seconds or Less) and a coverage (Drop, ICE, Switch Everything, Blitz, 2-3 Zone); the names come from `schemes.json`. Scout the opponent, then Lock In & Fight. Afterwards, the Film Room shows why it went the way it did.

Each card has one picture drawn by the real renderer (a court diagram or a shop row),
never a wall of text. If a number in `economy.js`, `synergies.js` or `schemes.json`
changes, the card changes with it: import the constants, don't retype them.

## Art direction: inspired by NBA Street Vol. 2

NBA Street Vol. 2 (EA Sports BIG, 2003) is the reference, because it made a menu feel
like arriving at a court. Take its *ideas*, never its assets:

- **The court has a place.** Its menus sat on real-feeling playgrounds. Ours: Open Gym is
  a court at golden hour. Painted asphalt lines, a chain net, the fence's shadow across
  the key. It's drawn in the existing Pixi renderer, and the court in play stays the
  clean hardwood.
- **Type with attitude.** Big, chunky, slightly tilted display headings with a sticker or
  stencil edge, set against calm body text. Use a free display font (Google Fonts,
  OFL-licensed), and one is enough.
- **Saturated and warm.** Orange court, deep navy shadow, one hot accent for actions.
  Keep the 4.5:1 contrast check on all text.
- **Save the biggest moment for the rarest event.** Their *Gamebreaker* was the one
  screen-filling moment. Ours is an overtime winner or a run-saving win at low HP: the
  only place for a full-screen flash, crowd swell and big type. Everything else stays
  small (the Vlambeer hierarchy rule in `fun-brief.md`).

## Audio direction (the main ask)

What made that game sound alive: a beat under every menu, a streetball MC calling the
action, and court sounds you could feel. Our version:

- **Menu bed.** A short original loop (8–16 bars, boom-bap tempo ~90 BPM) under Open Gym
  and planning. It ducks under UI sounds and fades out at tip-off. During the fight,
  the crowd and the court take over.
- **The MC, as text first.** Short callouts on big plays ("Corner three!", "Swat!",
  "Off the glass!", "Ballgame!") as animated type. Voice is optional and later: record
  your own voice, or use a TTS voice the licence allows. Never clip the original
  announcer. Keep 3–4 lines per event and never repeat the same line twice in a row.
- **Court foley.** Dribble, sneaker squeak on a cut, swish, chain-net rattle (Open Gym
  only), rim clank on a miss, crowd swell scaled to the moment. Fire them from the
  engine events `events.js` already detects (make, miss, steal, block): no new
  plumbing.
- **UI sounds.** Buy = register ka-ching, reroll = card shuffle, place = soft court thud,
  sell = coin drop, Lock In = whistle. Each lands within 100 ms of the click (Swink's
  threshold, already a checklist item in `fun-brief.md`).
- **Implementation.** One `client/audio/` module on the Web Audio API: an
  `AudioContext` created on the Run It click (browsers block audio before a user
  gesture), a master gain, music and SFX buses, and `play(name, {gain, rate})` with a
  little random pitch so repeats don't sound robotic. Sounds are synthesized in code
  where possible (clank, thud, whistle), or CC0 samples with each source and licence
  listed in `client/audio/CREDITS.md`. Total audio under 500 KB. If audio fails to
  load, the game plays silent and never breaks.
- **Respect the player.** Off by default on the embedded site build (`/hardwood/` on
  brooksroley.com). There, a speaker button turns it on. On in the standalone and
  launcher builds. The mute choice is remembered.

## The originality rule

No samples, music, voice clips, fonts, logos, art or names from NBA Street or EA. It is
cited here as inspiration only, and the words "NBA Street" never appear in the UI. Every
asset is original, synthesized, or CC0 with a credit line.

## Build order (each one a PR)

1. **OG1: Open Gym screen + How to Play + Controls.** New phase `'gym'` as the
   initial phase. The header button returns to it between rounds. The cards import their
   numbers.
2. **OG2: Audio pass.** `client/audio/`, the menu bed, UI sounds, court foley from
   `events.js`, the Sound panel and the embedded-site default.
3. **OG3: Art pass.** The golden-hour Open Gym court, the display type, and the OT-winner
   moment.
4. **OG4: Shootaround.** The sandbox court, reusing `CourtCanvas` with HP and gold off.

## Acceptance (every PR)

- `.claude-tools/game-check.mjs` and any headless check click **Run It** first. Update
  them in OG1, or every check after it breaks.
- A first-time player reaches a fight in two clicks (Run It → Lock In & Fight are
  enough; the tutorial still guides).
- No layout shift at 390 px. Open Gym and the cards work with keyboard only (arrows,
  Enter, Esc) and with a screen reader (cards are headings + text, hotspots are
  buttons with labels).
- All client tests pass. New tests: the cards' numbers equal the constants they
  import; the audio module no-ops without an `AudioContext`.
- After merge, re-vendor into zero-next `public/hardwood/` per its `SOURCE_COMMIT.txt`.

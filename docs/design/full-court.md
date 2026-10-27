# Full Court — design note

*2026-10-26. A second mode for BballTactics: control one player, live, in a 5v5 full-court game.
Hardwood Autochess is this game's TFT; Full Court is its League.*

## The idea

Riot built Teamfight Tactics out of League of Legends: the same champions, moved from a real-time
5v5 where you pilot one of them into an auto-battler where you arrange them. We built ours in the
opposite order. Hardwood Autochess already exists, with NBA players as pieces on a 5×5 board. Full
Court is the game those pieces came from: you pick one player, right-click to move, and use four
abilities on cooldowns while nine AI players run the rest of the floor.

Basketball is already a five-a-side real-time team game, so most of the MOBA vocabulary has a
basketball meaning. The design work is choosing which parts of the metaphor to keep.

## What maps, and what doesn't

| League | Full Court | Kept in |
|---|---|---|
| Champion with a four-ability kit | A roster player; Q/W/E/R derived from shooting, speed and defense | M0 |
| Right-click to move, QWER to cast, skillshots aimed at the cursor | Same scheme; the step-back and closeout aim at the cursor | M0 |
| Mana | Stamina: abilities cost it, it regenerates | M0 |
| Auto-attack | Left-click: pass to a teammate, or reach for the ball on defense | M0 |
| Allied and enemy AI | Spacing, man-to-man defense, drive-or-shoot carriers | M0 |
| Gold and items | Gold from rebounds, steals and assists; gear bought at quarter breaks | M1 |
| Champion levels inside a match | "Heat": makes raise shooting, misses cool it | M1 |
| Dragon and Baron | Scoring runs grant a team buff; a late "clutch" objective | M2 |
| Champion select and bans | Draft against an AI captain, from the Hardwood roster | M2 |
| Towers, minion waves, the nexus | **Dropped.** The hoop is the objective, and possessions already pace the game the way waves do | — |
| A 30-minute laning phase | **Dropped.** Four short quarters; a match is about five minutes | — |

The link to Hardwood is deliberate: the same 29 players, the same stats, the same names. A player
who learns that Wembanyama's kit is built on his defense in Full Court has learned why he anchors a
Hardwood board.

## Kits from stats

Every player gets the same four ability slots. Their numbers come from that player's stats, so
29 players give 29 different kits without hand-authoring 116 abilities.

- **Q, Step-back** (shooting): a short dash away from the cursor; the next shot within 1.5 s ignores
  some of the contest. Distance and the contest discount scale with shooting.
- **W, Burst** (speed): a speed boost for 2 s, on offense or defense. Size scales with speed.
- **E, Closeout** (defense): dash toward the cursor; if it ends near the ball carrier, their next
  shot is heavily contested and a steal is likelier. Dash length scales with defense.
- **R, signature** (the player's highest stat):
  - shooting → *Limitless Range*: 6 s of threes from anywhere with no distance penalty
  - speed → *Fast Break*: 6 s of team-wide speed
  - defense → *The Wall*: 6 s of a zone where opponents shoot far worse

## Decisions and tradeoffs

**Rules in JavaScript first, the C++ engine later.** The shared C++ engine runs a fully autonomous
sim and has no notion of a controlled player, cooldowns or stamina. Adding them there means
rebuilding WebAssembly and touching a library three projects share, before anyone knows whether the
mode is fun. M0 writes the rules as a pure, seeded JS module (`client/moba/`), the same pattern
as `fallbackSim.js`: no DOM, no Vue, testable in plain Node. Once the numbers settle (M2), the rules
port to `shared-core` and the JS module becomes the reference the C++ tests are checked against.
Cost: two implementations for a while. Benefit: the risky question, "is it fun?", is answered in
days, not weeks.

**Reuse the existing renderer.** `CourtRenderer` already draws `{players, bots, ball}` frames with
game feel. Full Court emits the same state shape and adds a transparent 2D overlay for what only
this mode has: the move marker, the controlled player's ring, ability ranges and zones.

**5v5 full court, the first time.** 3v3 half-court would have been less AI work; we chose 5v5
because it is the real game and the closest match to League. The AI cost lands on defense, so M0
keeps defense simple: strict man-to-man, with the human guarding their own man. Leaving your man
open is the first lesson the game teaches.

**Right-click to move.** League players already know it, and a mouse-first scheme leaves the
keyboard free for the four abilities. Space shoots.

## Milestones

- **M0 (this PR): playable.** Pick a player, play a 4 × 45 s game against AI, see a box line.
  Kits from stats, stamina, steals, passes, interceptions, a shot clock, rebounds.
- **M1: the economy.** Gold, quarter-break shop, three items per player, heat.
- **M2: draft and objectives.** Captain's draft, scoring-run buffs, clutch time; port rules to C++.
- **M3: feel and teaching.** Ability art, sound, a Film Room replay of your possessions.
- **M4: release.** Ship through the launcher as a second mode of the same client.

## How we'll know it works

Logged per match, locally first: time to first score, share of possessions where the human
touches the ball, ability casts per minute, and whether the match was finished. A match that is
abandoned before the fourth quarter is the clearest sign something is wrong.

## Not ours to use

The mode borrows League's structure, not its property: no Riot names, champions, terms of art
that are trademarks, or art. Player names come from the existing Hardwood roster.

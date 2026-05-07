# Changelog

## 2026-05-07 — Conference Semifinals Meta Update

### Meta Weights (data/meta_weights.json)

- **Created meta tier system** for team synergy weighting based on playoff status.
- **Eliminated team debuffs**: BOS (S->X), HOU (A->X), MIL, DEN, MEM, IND, MIA, DAL all dropped to X tier. Players on these teams receive -2 shooting, -2 defense, -1 speed.
  - BOS 3pt synergy was previously S-tier dominant; eliminated R1 proves the meta shifted.
  - HOU transition speed synergy couldn't sustain playoff pace.
- **Playoff survivor rankings**:
  - S: OKC (5-0, depth-first dominance)
  - A: SAS (Wemby anchor), NYK (three-headed attack), DET (Cunningham breakout)
  - B: MIN (down 1 after blowout loss), CLE (D. Mitchell solo carry)
  - C: PHI (no Embiid), LAL (no Luka)
- Rationale: Meta freshness keeps the game's autochess draft interesting. Players on eliminated teams should feel slightly weaker to reflect real-world momentum loss, incentivizing roster adaptation.

### Injury Flags (shared-core, scraper.py, engine_roster.json)

- Added `is_active`, `injury_status`, and `team` fields to player cards.
- Luka Doncic (LAL): flagged Out — Hamstring (~4 weeks). Card excluded from active roster.
- Joel Embiid (PHI): flagged Out — Knee (series). Card excluded from active roster.
- Engine (`GameManager::LoadRosterJSON`) now skips `is_active: false` players during roster load.

### Wembanyama Card + Defense Cap (shared-core)

- Added Victor Wembanyama to roster (SAS, cost 5, defense 88).
- Added `MAX_DEFENSE_MULTIPLIER = 1.8x` board average in `ShotProbability`. Prevents a single high-defense card from producing non-fun runaway outcomes (the SAS +38 blowout scenario).
- Contest penalty now scales by defender's effective defense stat relative to league-average 50.

### Depth-Build Synergy (SynergyEngine)

- Added "Balanced Roster" synergy: triggers when 4+ players have overall rating >= 55. Tier 1 (4 solid): +3/+3/+2 shooting/defense/speed. Tier 2 (5 solid): +6/+6/+4.
- Expanded bot opponents from 3 to 5 players with depth-oriented stats, enabling bots to trigger this synergy.
- Reflects OKC's 5-0 playoff run using depth over star power.

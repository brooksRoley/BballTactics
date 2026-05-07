"""
meta_evaluator.py — Applies playoff meta weights to player cards.

Reads data/meta_weights.json and adjusts team synergy buffs based on
current playoff form. Eliminated teams get debuffed; dominant teams
get small stat boosts to their franchise synergy.

Usage:
    from meta_evaluator import apply_meta_weights
    roster = apply_meta_weights(roster)  # mutates and returns roster
"""

import json
from pathlib import Path

META_WEIGHTS_PATH = Path(__file__).resolve().parent.parent / "data" / "meta_weights.json"


def load_meta_weights(path: Path = META_WEIGHTS_PATH) -> dict:
    with open(path) as f:
        return json.load(f)


def get_team_tier(team_abbr: str, meta: dict) -> tuple[str, dict]:
    """Returns (tier, tier_buffs) for a given team abbreviation."""
    tier_buffs = meta.get("tier_buffs", {})

    # Check playoff survivors first
    for abbr, info in meta.get("playoff_survivors", {}).items():
        if abbr == team_abbr:
            tier = info["tier"]
            return tier, tier_buffs.get(tier, {})

    # Check eliminated teams
    for abbr, info in meta.get("eliminated_round1", {}).items():
        if abbr == team_abbr:
            tier = info["tier"]
            return tier, tier_buffs.get(tier, {})

    # Unknown team — neutral
    return "C", tier_buffs.get("C", {})


def apply_meta_weights(
    roster: list[dict],
    meta_path: Path = META_WEIGHTS_PATH,
) -> list[dict]:
    """Applies meta tier buffs/debuffs to a roster based on team affiliation.

    Each player's stats are adjusted by their team's current meta tier.
    Players on eliminated teams get stat penalties; playoff contenders
    get small boosts reflecting current form advantage.
    """
    meta = load_meta_weights(meta_path)

    for player in roster:
        team = player.get("team", "")
        if not team:
            continue

        tier, buffs = get_team_tier(team, meta)
        if not buffs:
            continue

        stats = player.get("stats", {})
        stats["shooting"] = max(1, min(99, stats.get("shooting", 50) + buffs.get("shooting", 0)))
        stats["defense"] = max(1, min(99, stats.get("defense", 50) + buffs.get("defense", 0)))
        stats["speed"] = max(1, min(99, stats.get("speed", 50) + buffs.get("speed", 0)))

    return roster


def print_meta_summary(meta_path: Path = META_WEIGHTS_PATH):
    """Pretty-prints current meta tier rankings."""
    meta = load_meta_weights(meta_path)

    print("=== Playoff Meta Tiers ===\n")
    print("SURVIVORS:")
    for abbr, info in meta.get("playoff_survivors", {}).items():
        print(f"  [{info['tier']}] {abbr:4s} — {info['synergy_focus']:20s} | {info['form']}")

    print("\nELIMINATED (Round 1):")
    for abbr, info in meta.get("eliminated_round1", {}).items():
        prev = info.get("previous_tier", "?")
        print(f"  [{prev}->{info['tier']}] {abbr:4s} — {info['synergy_focus']:20s} | {info['drop_reason']}")

    print(f"\nMeta version: {meta.get('_version', 'unknown')}")


if __name__ == "__main__":
    print_meta_summary()

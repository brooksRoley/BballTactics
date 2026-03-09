"""
simulate.py — Runs the C++ game_runner for every matchup combination
and returns a pandas DataFrame (one row per game).

Usage:
    from simulate import run_simulation
    df = run_simulation(roster_path="../../public/engine_roster.json", games_per_matchup=200)
"""

import itertools
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent
RUNNER = ROOT / "engine_runner" / "game_runner"
DEFAULT_ROSTER = ROOT.parent.parent / "public" / "engine_roster.json"

# Simulation constants
TICKS_PER_GAME = 3600        # 60 seconds @ 60 fps
DT = 1.0 / 60.0
TEAM_SIZE = 5


def load_roster(path: str | Path = DEFAULT_ROSTER) -> list[dict]:
    with open(path) as f:
        return json.load(f)


def _place_team(players: list[dict]) -> list[dict]:
    """Assigns default court positions (0-4 grid) to a list of players."""
    default_positions = [
        (1, 1), (3, 1), (2, 3), (4, 2), (2, 5),
    ]
    team = []
    for i, p in enumerate(players):
        entry = dict(p)
        cx, cy = default_positions[i % len(default_positions)]
        entry["courtX"] = cx
        entry["courtY"] = cy
        team.append(entry)
    return team


def _run_game(home: list[dict], away: list[dict], seed: int) -> dict:
    """Calls game_runner once and returns the parsed JSON result."""
    payload = json.dumps({
        "seed": seed,
        "ticks": TICKS_PER_GAME,
        "dt": DT,
        "home_team": _place_team(home),
        "away_team": _place_team(away),
    })
    result = subprocess.run(
        [str(RUNNER)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"game_runner failed: {result.stderr}")
    return json.loads(result.stdout.strip())


def _team_key(players: list[dict]) -> str:
    """Stable identifier for a team composition."""
    return "+".join(sorted(p["name"] for p in players))


def _team_cost(players: list[dict]) -> int:
    return sum(p["cost"] for p in players)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_tier_teams(roster: list[dict]) -> dict[str, list[dict]]:
    """Creates representative teams grouped by total cost tier.

    Returns a dict mapping a label to a 5-player list.
    Tiers: budget (cost<=8), mid (9-15), star (16-21), super (22+).
    """
    by_cost = sorted(roster, key=lambda p: p["cost"])
    teams: dict[str, list[dict]] = {}

    # Budget: cheapest 5
    teams["budget"] = by_cost[:TEAM_SIZE]
    # Star: most expensive 5
    teams["star"] = by_cost[-TEAM_SIZE:]
    # Mid: middle 5
    mid_start = len(by_cost) // 2 - TEAM_SIZE // 2
    teams["mid"] = by_cost[mid_start : mid_start + TEAM_SIZE]

    # Mixed: alternate cheap/expensive
    mixed = []
    lo, hi = 0, len(by_cost) - 1
    while len(mixed) < TEAM_SIZE:
        if len(mixed) % 2 == 0 and hi >= 0:
            mixed.append(by_cost[hi]); hi -= 1
        elif lo < len(by_cost):
            mixed.append(by_cost[lo]); lo += 1
    teams["mixed"] = mixed[:TEAM_SIZE]

    return teams


def generate_player_spotlight_teams(
    roster: list[dict], target_id: int
) -> tuple[list[dict], list[dict]]:
    """Builds a team featuring *target_id* + 4 median-cost fillers,
    and a baseline opponent of 5 median-cost players."""
    target = next(p for p in roster if p["id"] == target_id)
    fillers = sorted(
        [p for p in roster if p["id"] != target_id],
        key=lambda p: abs(p["cost"] - 3),
    )
    team = [target] + fillers[:TEAM_SIZE - 1]
    baseline = fillers[:TEAM_SIZE]
    return team, baseline


def run_simulation(
    roster_path: str | Path = DEFAULT_ROSTER,
    games_per_matchup: int = 200,
    mode: str = "tiers",
) -> pd.DataFrame:
    """Main entry point.  Returns a DataFrame with columns:
        home_team, away_team, home_cost, away_cost,
        home_score, away_score, winner, seed
    """
    roster = load_roster(roster_path)
    rng = np.random.default_rng(seed=0)

    matchups: list[tuple[str, list[dict], str, list[dict]]] = []

    if mode == "tiers":
        teams = generate_tier_teams(roster)
        for (la, ta), (lb, tb) in itertools.combinations(teams.items(), 2):
            matchups.append((la, ta, lb, tb))
        # Also mirror matchups (A vs B AND B vs A) to measure home advantage
        mirrored = [(lb, tb, la, ta) for la, ta, lb, tb in matchups]
        matchups.extend(mirrored)

    elif mode == "players":
        for player in roster:
            team, baseline = generate_player_spotlight_teams(roster, player["id"])
            matchups.append((
                _team_key(team), team,
                _team_key(baseline), baseline,
            ))

    seeds = rng.integers(0, 2**31, size=games_per_matchup)
    rows: list[dict] = []

    total = len(matchups) * games_per_matchup
    with tqdm(total=total, desc="Simulating") as pbar:
        for home_label, home, away_label, away in matchups:
            for seed in seeds:
                result = _run_game(home, away, int(seed))
                rows.append({
                    "home_team": home_label,
                    "away_team": away_label,
                    "home_cost": _team_cost(home),
                    "away_cost": _team_cost(away),
                    "home_score": result["homeScore"],
                    "away_score": result["awayScore"],
                    "winner": result["winner"],
                    "seed": int(seed),
                })
                pbar.update(1)

    return pd.DataFrame(rows)

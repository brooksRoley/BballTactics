#!/usr/bin/env python3
"""
run_analysis.py — Entrypoint: simulate → analyze → save charts.

Usage:
    # Tier matchups (default, fast)
    python run_analysis.py

    # Per-player spotlight
    python run_analysis.py --mode players

    # Custom games per matchup
    python run_analysis.py --games 50

    # Custom roster
    python run_analysis.py --roster /path/to/roster.json
"""

import argparse
import sys
from pathlib import Path

from simulate import run_simulation
from analyze import run_analysis


def main():
    parser = argparse.ArgumentParser(description="BballTactics Balance Analysis")
    parser.add_argument(
        "--mode", choices=["tiers", "players"], default="tiers",
        help="Simulation mode: 'tiers' tests cost-tier matchups, "
             "'players' tests each player individually (default: tiers)",
    )
    parser.add_argument(
        "--games", type=int, default=200,
        help="Number of games per matchup (default: 200)",
    )
    parser.add_argument(
        "--roster", type=str, default=None,
        help="Path to roster JSON (default: public/engine_roster.json)",
    )
    args = parser.parse_args()

    roster_path = args.roster or (
        Path(__file__).resolve().parent.parent.parent / "public" / "engine_roster.json"
    )

    print(f"Mode: {args.mode}  |  Games/matchup: {args.games}  |  Roster: {roster_path}\n")

    # Step 1: Simulate
    df = run_simulation(
        roster_path=roster_path,
        games_per_matchup=args.games,
        mode=args.mode,
    )
    print(f"\nSimulation complete: {len(df)} total games\n")

    # Step 2: Analyze + save charts
    run_analysis(df, mode=args.mode)


if __name__ == "__main__":
    main()

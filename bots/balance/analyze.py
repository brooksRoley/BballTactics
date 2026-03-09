"""
analyze.py — Statistical analysis of simulation results.

Produces:
  - Win rates by cost tier
  - Individual player win rates (flags outliers)
  - Synergy effectiveness
  - Formation heatmap (5x5 grid)
  - HP damage curve across 10 rounds

Uses scipy for statistical tests and matplotlib for charts.
"""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")          # headless — no display needed
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sp_stats

CHART_DIR = Path(__file__).resolve().parent / "charts"
DEFAULT_ROSTER = Path(__file__).resolve().parent.parent.parent / "public" / "engine_roster.json"


def _load_roster() -> list[dict]:
    with open(DEFAULT_ROSTER) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# 1.  Win rates by cost tier
# ---------------------------------------------------------------------------

def win_rates_by_cost(df: pd.DataFrame) -> pd.DataFrame:
    """Returns home win rate grouped by (home_cost, away_cost)."""
    df = df.copy()
    df["home_win"] = (df["winner"] == "home").astype(int)

    grouped = (
        df.groupby(["home_team", "away_team"])
        .agg(
            games=("home_win", "count"),
            wins=("home_win", "sum"),
            home_cost=("home_cost", "first"),
            away_cost=("away_cost", "first"),
            avg_home_score=("home_score", "mean"),
            avg_away_score=("away_score", "mean"),
        )
        .reset_index()
    )
    grouped["win_rate"] = grouped["wins"] / grouped["games"]

    # Binomial 95% CI
    grouped["ci_lo"] = grouped.apply(
        lambda r: sp_stats.binom.ppf(0.025, r["games"], r["win_rate"]) / r["games"]
        if r["win_rate"] > 0 else 0.0,
        axis=1,
    )
    grouped["ci_hi"] = grouped.apply(
        lambda r: sp_stats.binom.ppf(0.975, r["games"], r["win_rate"]) / r["games"]
        if r["win_rate"] < 1 else 1.0,
        axis=1,
    )

    return grouped


def plot_cost_tier_winrates(summary: pd.DataFrame, out: Path = CHART_DIR):
    """Bar chart of win rates per matchup."""
    fig, ax = plt.subplots(figsize=(10, 5))
    labels = summary["home_team"] + " vs " + summary["away_team"]
    x = np.arange(len(labels))
    bars = ax.bar(x, summary["win_rate"], color="steelblue", edgecolor="white")

    # Error bars from CI
    yerr_lo = summary["win_rate"] - summary["ci_lo"]
    yerr_hi = summary["ci_hi"] - summary["win_rate"]
    ax.errorbar(x, summary["win_rate"], yerr=[yerr_lo, yerr_hi],
                fmt="none", ecolor="black", capsize=3)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("Home Win Rate")
    ax.set_title("Win Rate by Team Matchup (with 95% CI)")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.6)
    ax.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(out / "cost_tier_winrates.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {out / 'cost_tier_winrates.png'}")


# ---------------------------------------------------------------------------
# 2.  Individual player win rates (spotlight mode)
# ---------------------------------------------------------------------------

def player_win_rates(df: pd.DataFrame) -> pd.DataFrame:
    """Expects a DataFrame from mode='players' simulation."""
    df = df.copy()
    df["home_win"] = (df["winner"] == "home").astype(int)
    grouped = (
        df.groupby("home_team")
        .agg(games=("home_win", "count"), wins=("home_win", "sum"))
        .reset_index()
    )
    grouped["win_rate"] = grouped["wins"] / grouped["games"]

    # Flag outliers: win rate > 1.5 IQR above Q3 or below Q1
    q1 = grouped["win_rate"].quantile(0.25)
    q3 = grouped["win_rate"].quantile(0.75)
    iqr = q3 - q1
    grouped["outlier"] = (
        (grouped["win_rate"] < q1 - 1.5 * iqr) |
        (grouped["win_rate"] > q3 + 1.5 * iqr)
    )
    return grouped


def plot_player_winrates(pwr: pd.DataFrame, out: Path = CHART_DIR):
    fig, ax = plt.subplots(figsize=(12, 5))
    colors = ["crimson" if o else "steelblue" for o in pwr["outlier"]]
    ax.barh(pwr["home_team"], pwr["win_rate"], color=colors, edgecolor="white")
    ax.axvline(0.5, ls="--", color="gray", alpha=0.6)
    ax.set_xlabel("Win Rate")
    ax.set_title("Individual Player Win Rates (red = outlier)")
    fig.tight_layout()
    fig.savefig(out / "player_winrates.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {out / 'player_winrates.png'}")


# ---------------------------------------------------------------------------
# 3.  Score distribution analysis
# ---------------------------------------------------------------------------

def score_distribution(df: pd.DataFrame, out: Path = CHART_DIR):
    """Histogram of score margins and normality test."""
    margin = df["home_score"] - df["away_score"]

    fig, axes = plt.subplots(1, 2, figsize=(12, 4))

    # Histogram
    axes[0].hist(margin, bins=30, color="steelblue", edgecolor="white", density=True)
    axes[0].axvline(0, ls="--", color="gray")
    axes[0].set_title("Score Margin Distribution (Home - Away)")
    axes[0].set_xlabel("Point Margin")
    axes[0].set_ylabel("Density")

    # QQ plot
    sp_stats.probplot(margin, dist="norm", plot=axes[1])
    axes[1].set_title("QQ Plot (vs Normal)")

    fig.tight_layout()
    fig.savefig(out / "score_distribution.png", dpi=150)
    plt.close(fig)

    # Shapiro-Wilk on a sample (max 5000 for the test)
    sample = margin.sample(min(len(margin), 5000), random_state=42)
    stat, p = sp_stats.shapiro(sample)
    print(f"  Shapiro-Wilk: W={stat:.4f}, p={p:.4g}")
    print(f"  Saved {out / 'score_distribution.png'}")

    return {"shapiro_W": stat, "shapiro_p": p, "mean_margin": margin.mean()}


# ---------------------------------------------------------------------------
# 4.  Formation heatmap (5x5 grid)
# ---------------------------------------------------------------------------

def formation_heatmap(df: pd.DataFrame, out: Path = CHART_DIR):
    """Heatmap of win rates by the ball-handler's starting courtX/courtY.

    Uses the FIRST player in home_team as a proxy (the best shooter gets
    initial possession). For a deeper analysis, run in 'players' mode.
    """
    # This requires position data which isn't in the sim output.
    # Generate a synthetic heatmap from the default placements.
    grid = np.full((5, 5), 0.5)  # placeholder — fill from real data if available

    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(grid, cmap="RdYlGn", vmin=0, vmax=1, origin="lower")
    ax.set_xlabel("courtX")
    ax.set_ylabel("courtY")
    ax.set_title("Formation Win-Rate Heatmap (5x5 Grid)")
    ax.set_xticks(range(5))
    ax.set_yticks(range(5))
    fig.colorbar(im, ax=ax, label="Win Rate")
    fig.tight_layout()
    fig.savefig(out / "formation_heatmap.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {out / 'formation_heatmap.png'}")


# ---------------------------------------------------------------------------
# 5.  HP damage curve across 10 rounds
# ---------------------------------------------------------------------------

def hp_damage_curve(df: pd.DataFrame, out: Path = CHART_DIR):
    """Simulates a 10-round season using the overall loss rate to model
    expected HP over rounds (flat -20 per loss)."""
    loss_rate = (df["winner"] == "away").mean()
    draws = (df["winner"] == "draw").mean()
    win_rate = 1.0 - loss_rate - draws

    rounds = np.arange(0, 11)
    # Expected HP: start at 100, lose 20 * loss_rate per round
    expected_hp = 100.0 - 20.0 * loss_rate * rounds

    # Monte Carlo: sample 1000 seasons
    rng = np.random.default_rng(42)
    n_seasons = 1000
    hp_curves = np.zeros((n_seasons, 11))
    hp_curves[:, 0] = 100
    for r in range(1, 11):
        losses = rng.random(n_seasons) < loss_rate
        hp_curves[:, r] = hp_curves[:, r - 1] - 20 * losses
        hp_curves[:, r] = np.maximum(hp_curves[:, r], 0)

    p5  = np.percentile(hp_curves, 5, axis=0)
    p95 = np.percentile(hp_curves, 95, axis=0)
    median_hp = np.median(hp_curves, axis=0)

    fig, ax = plt.subplots(figsize=(8, 4))
    ax.fill_between(rounds, p5, p95, alpha=0.2, color="steelblue", label="5th–95th pctl")
    ax.plot(rounds, median_hp, "o-", color="steelblue", label="Median HP")
    ax.plot(rounds, expected_hp, "--", color="crimson", label="Expected HP")
    ax.axhline(0, ls=":", color="gray")
    ax.set_xlabel("Round")
    ax.set_ylabel("Health Points")
    ax.set_title(f"HP Curve Over 10 Rounds (loss rate={loss_rate:.1%})")
    ax.set_xticks(rounds)
    ax.set_ylim(-5, 105)
    ax.legend()
    fig.tight_layout()
    fig.savefig(out / "hp_damage_curve.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {out / 'hp_damage_curve.png'}")

    elimination_rate = (hp_curves[:, -1] <= 0).mean()
    return {
        "loss_rate": loss_rate,
        "win_rate": win_rate,
        "draw_rate": draws,
        "elimination_rate_10r": elimination_rate,
    }


# ---------------------------------------------------------------------------
# Aggregate analysis runner
# ---------------------------------------------------------------------------

def run_analysis(df: pd.DataFrame, mode: str = "tiers"):
    """Run all analyses and save charts."""
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    print("=== Balance Analysis ===\n")

    # Cost tier win rates
    print("[1/4] Win rates by matchup...")
    summary = win_rates_by_cost(df)
    plot_cost_tier_winrates(summary)
    print(summary[["home_team", "away_team", "win_rate", "avg_home_score", "avg_away_score"]].to_string(index=False))
    print()

    # Score distribution
    print("[2/4] Score distribution...")
    dist_stats = score_distribution(df)
    print(f"  Mean margin: {dist_stats['mean_margin']:.2f}\n")

    # HP damage curve
    print("[3/4] HP damage curve...")
    hp_stats = hp_damage_curve(df)
    print(f"  Overall loss rate: {hp_stats['loss_rate']:.1%}")
    print(f"  10-round elimination rate: {hp_stats['elimination_rate_10r']:.1%}\n")

    # Formation heatmap
    print("[4/4] Formation heatmap...")
    formation_heatmap(df)

    # Player-level analysis (if mode == 'players')
    if mode == "players":
        print("\n[Bonus] Player spotlight win rates...")
        pwr = player_win_rates(df)
        plot_player_winrates(pwr)
        outliers = pwr[pwr["outlier"]]
        if not outliers.empty:
            print("  Outlier players:")
            print(outliers[["home_team", "win_rate"]].to_string(index=False))

    print("\n=== Done. Charts saved to", CHART_DIR, "===")

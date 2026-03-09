"""
E2E tests for HP math and status transitions:
  - Health decrements on loss (-20 HP per loss)
  - Win preserves health
  - 'won' / 'lost' terminal states
  - Resolving a closed run returns 400
"""

import httpx
import pytest

from .board_fixtures import MIXED_BOARD


class TestHealthDecrements:
    """Each loss should subtract exactly 20 HP; wins cause no damage."""

    def test_single_loss(self, api: httpx.Client, run_id: str):
        api.post("/api/match/submit-and-fetch", json={
            "run_id": run_id,
            "round_number": 1,
            "board_data": MIXED_BOARD,
        })
        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "loss",
        })
        assert resp.status_code == 200
        assert resp.json()["health"] == 80

    def test_win_preserves_health(self, api: httpx.Client, run_id: str):
        api.post("/api/match/submit-and-fetch", json={
            "run_id": run_id,
            "round_number": 1,
            "board_data": MIXED_BOARD,
        })
        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "win",
        })
        assert resp.status_code == 200
        assert resp.json()["health"] == 100

    def test_cumulative_losses(self, api: httpx.Client, run_id: str):
        """Three losses should leave health at 40."""
        for round_num in range(1, 4):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "loss",
            })
            assert resp.status_code == 200

        assert resp.json()["health"] == 40
        assert resp.json()["status"] == "active"

    def test_mixed_results_hp(self, api: httpx.Client, run_id: str):
        """Win, loss, win, loss  →  100, 80, 80, 60 HP."""
        results = ["win", "loss", "win", "loss"]
        expected_hp = [100, 80, 80, 60]

        for i, result in enumerate(results):
            round_num = i + 1
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": result,
            })
            assert resp.status_code == 200
            assert resp.json()["health"] == expected_hp[i], (
                f"Round {round_num} ({result}): "
                f"expected HP {expected_hp[i]}, got {resp.json()['health']}"
            )


class TestTerminalStates:
    """Runs should transition to 'won' or 'lost' at the right moments."""

    def test_won_after_ten_wins(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 11):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "win",
            })
            assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "won"
        assert data["health"] == 100
        assert data["current_round"] == 11

    def test_lost_at_zero_hp(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 6):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "loss",
            })
            assert resp.status_code == 200

        data = resp.json()
        assert data["status"] == "lost"
        assert data["health"] == 0


class TestClosedRunRejects:
    """Resolving a match on a completed run should return 400."""

    def test_resolve_closed_won_run(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 11):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "win",
            })

        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "win",
        })
        assert resp.status_code == 400
        assert "not found or already ended" in resp.json()["detail"].lower()

    def test_resolve_closed_lost_run(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 6):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": MIXED_BOARD,
            })
            api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "loss",
            })

        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "loss",
        })
        assert resp.status_code == 400
        assert "not found or already ended" in resp.json()["detail"].lower()

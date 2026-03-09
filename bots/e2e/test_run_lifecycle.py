"""
E2E tests for the full run lifecycle:
  - 10-round win run  → status='won'
  - 5-loss elimination → health=0, status='lost'
  - HP math assertions
  - 400 on dead run
"""

import uuid

import httpx
import pytest

from .board_fixtures import STAR_BOARD, BUDGET_BOARD, MIXED_BOARD, ALL_BOARDS


class TestWinRun:
    """A full 10-round all-win run should reach status='won' with full HP."""

    def test_ten_wins(self, api: httpx.Client, run_id: str):
        boards = ALL_BOARDS
        health = 100

        for round_num in range(1, 11):
            board = boards[round_num % len(boards)]

            # Submit board and fetch opponent
            resp = api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": board,
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "opponent_board" in data

            # Resolve as win
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "win",
            })
            assert resp.status_code == 200
            data = resp.json()

            # Wins don't damage health
            assert data["health"] == health

            if round_num < 10:
                assert data["status"] == "active"
                assert data["current_round"] == round_num + 1
            else:
                assert data["status"] == "won"
                assert data["current_round"] == 11


class TestLossElimination:
    """Five consecutive losses should drop HP from 100 to 0."""

    def test_five_losses(self, api: httpx.Client, run_id: str):
        health = 100

        for round_num in range(1, 6):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": BUDGET_BOARD,
            })

            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "loss",
            })
            assert resp.status_code == 200
            data = resp.json()

            health -= 20
            assert data["health"] == health

            if health > 0:
                assert data["status"] == "active"
            else:
                assert data["status"] == "lost"

        assert health == 0


class TestDeadRunReturns400:
    """Resolving a match on a finished run should return 400."""

    def test_resolve_after_win(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 11):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": STAR_BOARD,
            })
            resp = api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "win",
            })
            assert resp.status_code == 200

        # Run is now 'won' — resolving again should 400
        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "win",
        })
        assert resp.status_code == 400

    def test_resolve_after_elimination(self, api: httpx.Client, run_id: str):
        for round_num in range(1, 6):
            api.post("/api/match/submit-and-fetch", json={
                "run_id": run_id,
                "round_number": round_num,
                "board_data": BUDGET_BOARD,
            })
            api.post("/api/match/resolve", json={
                "run_id": run_id,
                "result": "loss",
            })

        # Run is now 'lost' — resolving again should 400
        resp = api.post("/api/match/resolve", json={
            "run_id": run_id,
            "result": "loss",
        })
        assert resp.status_code == 400

"""
E2E tests for ghost matchmaking:
  - Bot fallback when no other opponent exists for the round
  - Two independent runs pairing as ghosts
  - board_data string-vs-dict handling (SQLite vs Postgres)
"""

import json
import uuid

import httpx
import pytest

from .board_fixtures import STAR_BOARD, MIXED_BOARD


class TestBotFallback:
    """When no other player has submitted a board for a given round,
    the API should return the hardcoded bot team."""

    def test_first_submit_gets_bot_or_ghost(self, api: httpx.Client, run_id: str):
        """A fresh run submitting to a high round may get a bot (empty DB)
        or a ghost (populated DB). Either is valid; if bot, validate structure."""
        resp = api.post("/api/match/submit-and-fetch", json={
            "run_id": run_id,
            "round_number": 10,
            "board_data": STAR_BOARD,
        })
        assert resp.status_code == 200
        data = resp.json()
        opponent = data["opponent_board"]

        # Normalize string → dict (SQLite returns raw JSON string)
        if isinstance(opponent, str):
            opponent = json.loads(opponent)

        assert isinstance(opponent, dict)

        if opponent.get("is_bot"):
            assert opponent["team_name"] == "Rookie AI"
            assert len(opponent["units"]) >= 1
            unit = opponent["units"][0]
            assert "name" in unit
            assert "stats" in unit
        else:
            # Real ghost — should have units array
            assert "units" in opponent


class TestGhostPairing:
    """Two independent runs submitting for the same round should pair as ghosts."""

    def test_two_runs_pair(self, api: httpx.Client):
        # Start two fresh runs
        run_a = api.post("/api/run/start", json={
            "player_id": str(uuid.uuid4()),
        }).json()["run_id"]

        run_b = api.post("/api/run/start", json={
            "player_id": str(uuid.uuid4()),
        }).json()["run_id"]

        round_number = 1

        # Run A submits first
        resp_a = api.post("/api/match/submit-and-fetch", json={
            "run_id": run_a,
            "round_number": round_number,
            "board_data": STAR_BOARD,
        })
        assert resp_a.status_code == 200

        # Run B submits second — should get Run A's board as ghost
        resp_b = api.post("/api/match/submit-and-fetch", json={
            "run_id": run_b,
            "round_number": round_number,
            "board_data": MIXED_BOARD,
        })
        assert resp_b.status_code == 200
        opponent = resp_b.json()["opponent_board"]

        # Normalize string → dict (SQLite returns raw JSON string)
        if isinstance(opponent, str):
            opponent = json.loads(opponent)

        assert isinstance(opponent, dict)
        # The opponent should be a real board (not necessarily Run A's exact board
        # if other boards exist), but it must have a units array
        assert "units" in opponent
        assert len(opponent["units"]) >= 1


class TestBoardDataFormat:
    """opponent_board from SQLite is a raw JSON string;
    from Postgres it is a parsed dict. Tests must handle both."""

    def test_opponent_board_is_usable(self, api: httpx.Client):
        # Create two runs so we can guarantee a real ghost
        run_a = api.post("/api/run/start", json={
            "player_id": str(uuid.uuid4()),
        }).json()["run_id"]

        run_b = api.post("/api/run/start", json={
            "player_id": str(uuid.uuid4()),
        }).json()["run_id"]

        round_number = 2

        # Submit from run A
        api.post("/api/match/submit-and-fetch", json={
            "run_id": run_a,
            "round_number": round_number,
            "board_data": MIXED_BOARD,
        })

        # Fetch from run B — should get run A's board
        resp = api.post("/api/match/submit-and-fetch", json={
            "run_id": run_b,
            "round_number": round_number,
            "board_data": STAR_BOARD,
        })
        assert resp.status_code == 200
        opponent = resp.json()["opponent_board"]

        # Normalize: if string, parse it
        if isinstance(opponent, str):
            opponent = json.loads(opponent)

        # After normalization, validate the board structure
        assert isinstance(opponent, dict)
        assert "units" in opponent
        for unit in opponent["units"]:
            assert "id" in unit
            assert "name" in unit
            assert "cost" in unit
            assert "stats" in unit

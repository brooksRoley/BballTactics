"""
Pytest fixtures for BballTactics E2E API tests.

Configure via environment variables:
    BBALL_API_URL  - Base URL of the running server (default: http://localhost:8000)
"""

import os
import uuid

import httpx
import pytest

BASE_URL = os.getenv("BBALL_API_URL", "http://localhost:8000")


@pytest.fixture(scope="session")
def api() -> httpx.Client:
    """Session-scoped httpx client with generous timeout for Fly.io cold starts."""
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as client:
        # Health ping — wakes up Fly.io if sleeping
        resp = client.get("/api/roster")
        assert resp.status_code == 200, f"Server unreachable at {BASE_URL}"
        yield client


@pytest.fixture(scope="session")
def roster(api: httpx.Client) -> list[dict]:
    """Fetches the engine roster once per session."""
    resp = api.get("/api/roster")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list) and len(data) > 0
    return data


@pytest.fixture()
def run_id(api: httpx.Client) -> str:
    """Starts a fresh run and returns its run_id."""
    player_id = str(uuid.uuid4())
    resp = api.post("/api/run/start", json={"player_id": player_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["health"] == 100
    assert data["current_round"] == 1
    return data["run_id"]

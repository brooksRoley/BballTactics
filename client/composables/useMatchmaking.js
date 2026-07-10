import { ref } from "vue";

// Configurable backend base URL. The zero-next repo (brooksroley.com) hosts
// the /api/bball/* endpoints; local dev runs it on :3000.
const API_BASE = (
  import.meta.env.VITE_API_BASE ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");

export { API_BASE };

async function postJSON(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return response.json();
}

export function useMatchmaking() {
  const isSearching = ref(false);
  const searchError = ref(null);

  /**
   * Start a new run on the server.
   * @returns {{run_id, health, current_round}|null} null when the backend is unreachable.
   */
  const startRun = async (playerId) => {
    try {
      searchError.value = null;
      return await postJSON("/api/bball/run/start", { player_id: playerId });
    } catch (err) {
      console.warn("Matchmaking: could not start run —", err.message);
      searchError.value = err.message;
      return null;
    }
  };

  /**
   * Submit the local board and fetch a ghost opponent for this round.
   * @returns opponent board ({team_name, units: [...]}) or null on failure.
   */
  const submitAndFetchOpponent = async (runId, roundNumber, boardData) => {
    isSearching.value = true;
    searchError.value = null;
    try {
      const data = await postJSON("/api/bball/match/submit-and-fetch", {
        run_id: runId,
        round_number: roundNumber,
        board_data: boardData,
      });
      return data.opponent_board || null;
    } catch (err) {
      console.warn("Matchmaking: submit-and-fetch failed —", err.message);
      searchError.value = err.message;
      return null;
    } finally {
      isSearching.value = false;
    }
  };

  /**
   * Report the sim result. Server owns HP (-20 per loss) and run status.
   * round_number binds the resolve to the run's current round server-side,
   * so a stale or repeated report is rejected (409) instead of re-applied.
   * @returns {{health, current_round, status}|null}
   */
  const resolveMatch = async (runId, roundNumber, matchResult) => {
    try {
      return await postJSON("/api/bball/match/resolve", {
        run_id: runId,
        round_number: roundNumber,
        result: matchResult,
      });
    } catch (err) {
      console.warn("Matchmaking: resolve failed —", err.message);
      searchError.value = err.message;
      return null;
    }
  };

  return {
    isSearching,
    searchError,
    startRun,
    submitAndFetchOpponent,
    resolveMatch,
  };
}

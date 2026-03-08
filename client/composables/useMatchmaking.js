import { ref } from 'vue';

export function useMatchmaking() {
  const isSearching = ref(false);
  const searchError = ref(null);

  /**
   * Submits the local Vue board and fetches a ghost opponent.
   * * @param {string} runId - The UUID of the current active run.
   * @param {number} roundNumber - The current round (1-10).
   * @param {Object} localBoardData - The serialized Vue state (grid coords, units).
   * @returns {Object} A formatted payload ready for the C++ Wasm Engine.
   */
  const submitAndFetchOpponent = async (runId, roundNumber, localBoardData) => {
    isSearching.value = true;
    searchError.value = null;

    try {
      const response = await fetch('/api/match/submit-and-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          round_number: roundNumber,
          board_data: localBoardData
        })
      });

      if (!response.ok) {
        throw new Error('Failed to communicate with matchmaking server.');
      }

      const data = await response.json();

      // Format the exact payload our C++ GameManager expects
      const wasmPayload = {
        home_team: localBoardData,
        away_team: data.opponent_board
      };

      return wasmPayload;

    } catch (err) {
      console.error(err);
      searchError.value = err.message;
      return null;
    } finally {
      isSearching.value = false;
    }
  };

  /**
   * Reports the results of the Wasm simulation back to the server to update health.
   */
  const resolveMatch = async (runId, matchResult) => {
    try {
      const response = await fetch('/api/match/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          result: matchResult // 'win' or 'loss'
        })
      });
      return await response.json();
    } catch (err) {
      console.error("Failed to resolve match state", err);
    }
  };

  return {
    isSearching,
    searchError,
    submitAndFetchOpponent,
    resolveMatch
  };
}
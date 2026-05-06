import json
import statistics
from typing import List, Dict

SALARY_CAP = 151_000_000

class NBADatasetProcessor:
    def __init__(self):
        # In production, this gets populated by requests.get()
        self.raw_players = []
        self.processed_roster = []

    def fetch_mock_data(self):
        """Simulating an API pull of raw NBA stats and salary percentages."""
        self.raw_players = [
            {"id": 1, "name": "Steph Curry", "pts": 29.4, "spd": 8.5, "def_ws": 0.110, "cap_pct": 0.35},
            {"id": 2, "name": "De'Aaron Fox", "pts": 25.0, "spd": 9.8, "def_ws": 0.080, "cap_pct": 0.25},
            {"id": 3, "name": "Rudy Gobert", "pts": 14.0, "spd": 4.5, "def_ws": 0.180, "cap_pct": 0.30},
            {"id": 4, "name": "Alex Caruso", "pts": 9.0, "spd": 7.5, "def_ws": 0.150, "cap_pct": 0.08},
            {"id": 5, "name": "Udonis Haslem", "pts": 2.0, "spd": 3.0, "def_ws": 0.010, "cap_pct": 0.02}
        ]

    def _calculate_z_scores(self, stat_key: str) -> Dict[int, int]:
        """Calculates standard deviations and maps to a 1-99 game scale."""
        values = [p[stat_key] for p in self.raw_players if stat_key in p]
        
        if len(values) < 2:
            return {p["id"]: 50 for p in self.raw_players} # Failsafe
            
        mu = statistics.mean(values)
        sigma = statistics.stdev(values)
        
        mapped_stats = {}
        for p in self.raw_players:
            val = p.get(stat_key, 0)
            # Z-Score formula: (X - Mean) / Standard Deviation
            z_score = (val - mu) / sigma if sigma > 0 else 0
            
            # Center at 50. Each standard deviation is worth 20 stat points.
            scaled_value = int(round(50 + (z_score * 20)))
            
            # Clamp between 1 and 99
            mapped_stats[p["id"]] = max(1, min(99, scaled_value))
            
        return mapped_stats

    def _determine_cost(self, cap_pct: float) -> int:
        """Maps salary cap percentage to our 1-5 Gold economy.
        Thresholds must match GameEconomy.cpp:CalculateDraftCost() -- keep in sync."""
        if cap_pct >= 0.25: return 5
        if cap_pct >= 0.15: return 4
        if cap_pct >= 0.08: return 3
        if cap_pct >= 0.03: return 2
        return 1

    def build_engine_payload(self):
        """Compiles all calculated stats into the final C++ consumable format."""
        if not self.raw_players:
            self.fetch_mock_data()
            
        shooting_map = self._calculate_z_scores("pts")
        speed_map = self._calculate_z_scores("spd")
        defense_map = self._calculate_z_scores("def_ws")
        
        for p in self.raw_players:
            pid = p["id"]
            self.processed_roster.append({
                "id": pid,
                "name": p["name"],
                "cost": self._determine_cost(p.get("cap_pct", 0)),
                "stats": {
                    "shooting": shooting_map.get(pid, 50),
                    "speed": speed_map.get(pid, 50),
                    "defense": defense_map.get(pid, 50)
                }
            })

    def export_json(self, filepath: str = "engine_roster.json"):
        """Dumps the pristine roster to disk for the Vue app to load."""
        with open(filepath, 'w') as f:
            json.dump(self.processed_roster, f, indent=4)
        print(f"Exported {len(self.processed_roster)} players to {filepath}")
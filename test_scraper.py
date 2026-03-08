import unittest
from scraper import NBADatasetProcessor

class TestNBAPipeline(unittest.TestCase):
    def setUp(self):
        # Initialize a fresh processor before each test
        self.processor = NBADatasetProcessor()
        # Feed it highly skewed mock data to test the clamps
        self.processor.raw_players = [
            {"id": 1, "name": "God Tier", "pts": 50.0, "spd": 15.0, "def_ws": 0.5, "cap_pct": 0.40},
            {"id": 2, "name": "Average Joe", "pts": 15.0, "spd": 5.0, "def_ws": 0.1, "cap_pct": 0.10},
            {"id": 3, "name": "Bench Warmer", "pts": 2.0, "spd": 1.0, "def_ws": 0.0, "cap_pct": 0.01}
        ]

    def test_z_score_clamping(self):
        """Ensures stats don't exceed 99 or drop below 1."""
        shooting_stats = self.processor._calculate_z_scores("pts")
        
        # 'God Tier' is so far above the mean his raw scaled score would be > 100
        self.assertEqual(shooting_stats[1], 99) 
        
        # 'Bench Warmer' is so low his score should hit the floor
        self.assertTrue(shooting_stats[3] >= 1)

    def test_economy_tiers(self):
        """Verifies the salary cap percentages map to the correct 1-5 Gold cost."""
        self.assertEqual(self.processor._determine_cost(0.40), 5) # Supermax = 5g
        self.assertEqual(self.processor._determine_cost(0.10), 3) # Rotation = 3g
        self.assertEqual(self.processor._determine_cost(0.01), 1) # Minimum = 1g

    def test_payload_generation(self):
        """Ensures the final JSON structure matches the C++ engine's expectations."""
        self.processor.build_engine_payload()
        self.assertEqual(len(self.processor.processed_roster), 3)
        
        first_player = self.processor.processed_roster[0]
        self.assertIn("id", first_player)
        self.assertIn("cost", first_player)
        self.assertIn("shooting", first_player["stats"])

if __name__ == '__main__':
    unittest.main()
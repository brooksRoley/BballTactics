"""
Realistic board_data payloads matching the Vue onCourt array schema.

Each unit: {id, name, cost, stats: {shooting, speed, defense}, courtX, courtY}
"""


def make_board(units: list[dict]) -> dict:
    """Wraps a list of units into the board_data dict the API expects."""
    return {"units": units}


# --- Prebuilt boards using real roster players ---

BUDGET_BOARD = make_board([
    {"id": 5,  "name": "Udonis Haslem",  "cost": 1, "stats": {"shooting": 25, "speed": 24, "defense": 21}, "courtX": 1, "courtY": 1},
    {"id": 14, "name": "Patty Mills",    "cost": 1, "stats": {"shooting": 45, "speed": 48, "defense": 25}, "courtX": 3, "courtY": 1},
    {"id": 15, "name": "Kevon Looney",   "cost": 1, "stats": {"shooting": 28, "speed": 32, "defense": 52}, "courtX": 2, "courtY": 3},
    {"id": 20, "name": "Jose Alvarado",  "cost": 1, "stats": {"shooting": 40, "speed": 62, "defense": 55}, "courtX": 4, "courtY": 2},
    {"id": 10, "name": "Draymond Green", "cost": 2, "stats": {"shooting": 30, "speed": 45, "defense": 70}, "courtX": 2, "courtY": 5},
])

STAR_BOARD = make_board([
    {"id": 1,  "name": "Steph Curry",  "cost": 5, "stats": {"shooting": 74, "speed": 63, "defense": 51}, "courtX": 3, "courtY": 1},
    {"id": 16, "name": "Nikola Jokic",  "cost": 5, "stats": {"shooting": 70, "speed": 40, "defense": 55}, "courtX": 2, "courtY": 5},
    {"id": 6,  "name": "Jalen Brunson", "cost": 4, "stats": {"shooting": 68, "speed": 58, "defense": 45}, "courtX": 1, "courtY": 3},
    {"id": 8,  "name": "Bam Adebayo",   "cost": 4, "stats": {"shooting": 50, "speed": 52, "defense": 68}, "courtX": 4, "courtY": 4},
    {"id": 17, "name": "Jrue Holiday",   "cost": 4, "stats": {"shooting": 55, "speed": 58, "defense": 66}, "courtX": 3, "courtY": 3},
])

MIXED_BOARD = make_board([
    {"id": 1,  "name": "Steph Curry",   "cost": 5, "stats": {"shooting": 74, "speed": 63, "defense": 51}, "courtX": 3, "courtY": 1},
    {"id": 7,  "name": "Mikal Bridges",  "cost": 3, "stats": {"shooting": 55, "speed": 60, "defense": 62}, "courtX": 1, "courtY": 2},
    {"id": 9,  "name": "Tyler Herro",    "cost": 3, "stats": {"shooting": 62, "speed": 55, "defense": 35}, "courtX": 4, "courtY": 2},
    {"id": 13, "name": "Bobby Portis",   "cost": 2, "stats": {"shooting": 48, "speed": 42, "defense": 44}, "courtX": 2, "courtY": 4},
    {"id": 15, "name": "Kevon Looney",   "cost": 1, "stats": {"shooting": 28, "speed": 32, "defense": 52}, "courtX": 3, "courtY": 5},
])

# Convenience list for tests that iterate over boards
ALL_BOARDS = [BUDGET_BOARD, STAR_BOARD, MIXED_BOARD]

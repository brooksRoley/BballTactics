from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
import json
import os
import uuid

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///bballtactics.db")

engine = create_async_engine(DATABASE_URL)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        yield session


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://brooksroley.github.io"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Pydantic Schemas for Request Validation
class StartRunRequest(BaseModel):
    player_id: str

class SubmitBoardRequest(BaseModel):
    run_id: str
    round_number: int
    board_data: dict

class ResolveMatchRequest(BaseModel):
    run_id: str
    result: str # 'win' or 'loss'

@app.post("/api/run/start")
async def start_run(req: StartRunRequest, db: AsyncSession = Depends(get_db)):
    """Initializes a fresh 100 HP run."""
    run_id = str(uuid.uuid4())
    query = text("""
        INSERT INTO runs (id, player_id, current_round, health, status)
        VALUES (:id, :player_id, 1, 100, 'active')
    """)
    await db.execute(query, {"id": run_id, "player_id": req.player_id})
    await db.commit()
    return {"run_id": run_id, "health": 100, "current_round": 1}

@app.post("/api/match/submit-and-fetch")
async def submit_and_fetch(req: SubmitBoardRequest, db: AsyncSession = Depends(get_db)):
    """Saves the player's board and fetches a random ghost from the same round."""
    # 1. Save the player's current board state
    insert_query = text("""
        INSERT INTO board_states (run_id, round_number, board_data)
        VALUES (:run_id, :round_number, :board_data)
    """)
    await db.execute(insert_query, {
        "run_id": req.run_id,
        "round_number": req.round_number,
        "board_data": json.dumps(req.board_data)
    })
    
    # 2. Fetch a random opponent's board from the exact same round
    fetch_query = text("""
        SELECT board_data FROM board_states 
        WHERE round_number = :round_number AND run_id != :run_id
        ORDER BY RANDOM() LIMIT 1
    """)
    result = await db.execute(fetch_query, {"round_number": req.round_number, "run_id": req.run_id})
    opponent = result.fetchone()
    
    await db.commit()

    # 3. Fallback logic: If no opponent exists yet, serve the Bot
    if not opponent:
        bot_board = {
            "is_bot": True,
            "team_name": "Rookie AI",
            "units": [
                {"id": "bot_1", "name": "Bench Warmer", "cost": 1, "x": 2, "y": 3, "stats": {"shooting": 40, "defense": 40, "speed": 40}}
            ]
        }
        return {"opponent_board": bot_board}

    return {"opponent_board": opponent[0]}

@app.post("/api/match/resolve")
async def resolve_match(req: ResolveMatchRequest, db: AsyncSession = Depends(get_db)):
    """Updates run state after the local Wasm simulation finishes."""
    # Fetch current run state
    run_query = text("SELECT health, current_round FROM runs WHERE id = :run_id AND status = 'active'")
    result = await db.execute(run_query, {"run_id": req.run_id})
    run = result.fetchone()
    
    if not run:
        raise HTTPException(status_code=400, detail="Run not found or already ended.")
        
    new_health = run.health
    new_round = run.current_round + 1
    status = 'active'
    
    # Apply damage on loss (e.g., flat 20 damage per loss for simplicity)
    if req.result == 'loss':
        new_health -= 20
        
    if new_health <= 0:
        status = 'lost'
    elif new_round > 10: # Define max rounds to win
        status = 'won'
        
    update_query = text("""
        UPDATE runs 
        SET health = :health, current_round = :round, status = :status
        WHERE id = :run_id
    """)
    await db.execute(update_query, {"health": new_health, "round": new_round, "status": status, "run_id": req.run_id})
    await db.commit()
    
    return {"health": new_health, "current_round": new_round, "status": status}

@app.get("/api/roster")
async def get_roster():
    """Serves the engine roster JSON from the public directory."""
    roster_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "engine_roster.json")
    if not os.path.exists(roster_path):
        raise HTTPException(status_code=404, detail="Roster file not found.")
    with open(roster_path, "r") as f:
        roster = json.load(f)
    return roster

# Serve the built frontend (must be mounted after all API routes)
_dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
if os.path.exists(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="static")
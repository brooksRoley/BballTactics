#include "Court.h"
#include "ShotProbability.h"
#include <cmath>
#include <algorithm>
#include <limits>

// Pixel-space court: 800 x 400. Hoops centred at x=30 and x=770, mid-height.
static const Vector2D HOME_HOOP{30.0f,  200.0f};
static const Vector2D AWAY_HOOP{770.0f, 200.0f};

// Distance from hoop at which a player will attempt a shot
static const float SHOT_RANGE   = 100.0f;
// Distance at which a player picks up a loose ball
static const float PICKUP_RANGE = 30.0f;
// Pixel-to-feet ratio so ShotProbability (designed in feet) stays accurate
static const float PX_PER_FT    = 8.25f;

// ── Helpers ──────────────────────────────────────────────────────────────────

void Court::AddPlayer(std::shared_ptr<PlayerEntity> p, bool isHome) {
    if (isHome) homeTeam.push_back(p);
    else         awayTeam.push_back(p);
}

void Court::Clear() {
    homeTeam.clear();
    awayTeam.clear();
    ball = Basketball{};
    homeScore = 0;
    awayScore = 0;
}

void Court::InitPossession() {
    if (homeTeam.empty()) return;
    // Ball starts with the home player who has the best shooting
    auto best = std::max_element(homeTeam.begin(), homeTeam.end(),
        [](const auto& a, const auto& b) {
            return a->stats.shooting < b->stats.shooting;
        });
    ball.isPossessed  = true;
    ball.possessorId  = (*best)->id;
    ball.position     = {(*best)->pos.x, (*best)->pos.y, 0.0f};
}

void Court::MovePlayerToward(PlayerEntity& p, Vector2D target, float dt) {
    Vector2D dir  = target - p.pos;
    float    dist = dir.Magnitude();
    if (dist < 2.0f) return;
    // Max speed 200 px/s scaled by the player's speed stat
    float step = (p.stats.speed / 100.0f) * 200.0f * dt;
    p.pos = p.pos + dir.Normalize() * std::min(step, dist);
}

std::shared_ptr<PlayerEntity> Court::FindNearestDefender(
    const std::shared_ptr<PlayerEntity>& attacker, bool isHomeAttacker)
{
    auto& defenders = isHomeAttacker ? awayTeam : homeTeam;
    std::shared_ptr<PlayerEntity> nearest;
    float minDist = std::numeric_limits<float>::max();
    for (auto& d : defenders) {
        float dist = attacker->pos.DistanceTo(d->pos);
        if (dist < minDist) { minDist = dist; nearest = d; }
    }
    return nearest;
}

// ── Shot attempt ─────────────────────────────────────────────────────────────

void Court::AttemptShot(std::shared_ptr<PlayerEntity>& shooter, bool isHomeTeam) {
    Vector2D targetHoop = isHomeTeam ? AWAY_HOOP : HOME_HOOP;
    auto defender = FindNearestDefender(shooter, isHomeTeam);

    // ShotProbability formula was designed for feet; scale pixel positions down
    float prob;
    if (defender) {
        PlayerEntity scaledS = *shooter;
        PlayerEntity scaledD = *defender;
        scaledS.pos = {shooter->pos.x / PX_PER_FT, shooter->pos.y / PX_PER_FT};
        scaledD.pos = {defender->pos.x / PX_PER_FT, defender->pos.y / PX_PER_FT};
        Vector2D hoopFt{targetHoop.x / PX_PER_FT, targetHoop.y / PX_PER_FT};
        prob = CalculateShotProbability(&scaledS, &scaledD, hoopFt);
    } else {
        prob = (shooter->stats.shooting / 100.0f) * 0.5f;
    }

    // 3-pointer if shot is taken from beyond 200px of the hoop (~24 ft)
    float distToHoop = shooter->pos.DistanceTo(targetHoop);
    int   points     = distToHoop > 200.0f ? 3 : 2;

    std::uniform_real_distribution<float> roll(0.0f, 1.0f);
    bool made = roll(rng) < prob;

    if (made) {
        if (isHomeTeam) homeScore += points;
        else             awayScore += points;
        // Hand ball to the other team at mid-court
        ball.position  = {400.0f, 200.0f, 0.0f};
        ball.velocity  = {0.0f,   0.0f,   0.0f};
        auto& nextTeam = isHomeTeam ? awayTeam : homeTeam;
        if (!nextTeam.empty()) {
            ball.isPossessed = true;
            ball.possessorId = nextTeam[0]->id;
        } else {
            ball.isPossessed = false;
        }
    } else {
        // Miss: drop ball near the hoop for a rebound contest
        std::uniform_real_distribution<float> spread(-50.0f, 50.0f);
        ball.isPossessed = false;
        ball.position    = {targetHoop.x + spread(rng), targetHoop.y + spread(rng), 0.0f};
        ball.velocity    = {0.0f, 0.0f, 0.0f};
    }
}

// ── Rebound ───────────────────────────────────────────────────────────────────

void Court::AssignRebound(float dt) {
    Vector2D ballPos{ball.position.x, ball.position.y};
    std::shared_ptr<PlayerEntity> nearest;
    float minAdj = std::numeric_limits<float>::max();

    auto check = [&](std::vector<std::shared_ptr<PlayerEntity>>& team) {
        for (auto& p : team) {
            float dist      = p->pos.DistanceTo(ballPos);
            // Taller players get a virtual distance bonus
            float heightAdj = dist - (p->stats.height_inches - 72) * 2.0f;
            if (heightAdj < minAdj) { minAdj = heightAdj; nearest = p; }
        }
    };
    check(homeTeam);
    check(awayTeam);

    if (!nearest) return;

    if (nearest->pos.DistanceTo(ballPos) < PICKUP_RANGE) {
        ball.isPossessed = true;
        ball.possessorId = nearest->id;
    } else {
        MovePlayerToward(*nearest, ballPos, dt);
    }
}

// ── Main sim step ─────────────────────────────────────────────────────────────

void Court::UpdateSimulationStep(float dt) {
    if (!ball.isPossessed) {
        AssignRebound(dt);
        return;
    }

    // Home team: carrier drives to away basket, others spread to open spots
    for (size_t i = 0; i < homeTeam.size(); i++) {
        auto& p = homeTeam[i];
        if (p->id == ball.possessorId) {
            MovePlayerToward(*p, AWAY_HOOP, dt);
            ball.position = {p->pos.x, p->pos.y, 0.0f};
            if (p->pos.DistanceTo(AWAY_HOOP) < SHOT_RANGE) {
                AttemptShot(p, true);
                return;
            }
        } else {
            // Spread to staggered spots in the offensive zone
            Vector2D spot{480.0f + float(i % 3) * 80.0f, 80.0f + float(i) * 100.0f};
            MovePlayerToward(*p, spot, dt);
        }
    }

    // Away team: carrier drives to home basket, others defend nearest attacker
    for (size_t i = 0; i < awayTeam.size(); i++) {
        auto& p = awayTeam[i];
        if (p->id == ball.possessorId) {
            MovePlayerToward(*p, HOME_HOOP, dt);
            ball.position = {p->pos.x, p->pos.y, 0.0f};
            if (p->pos.DistanceTo(HOME_HOOP) < SHOT_RANGE) {
                AttemptShot(p, false);
                return;
            }
        } else {
            // Guard: position between the closest home attacker and the home hoop
            if (!homeTeam.empty()) {
                std::shared_ptr<PlayerEntity> mark;
                float minD = std::numeric_limits<float>::max();
                for (auto& h : homeTeam) {
                    float d = p->pos.DistanceTo(h->pos);
                    if (d < minD) { minD = d; mark = h; }
                }
                if (mark) {
                    Vector2D toHoop = HOME_HOOP - mark->pos;
                    float    mag    = toHoop.Magnitude();
                    Vector2D guardSpot = mag > 0
                        ? mark->pos + toHoop.Normalize() * std::min(30.0f, mag)
                        : mark->pos;
                    MovePlayerToward(*p, guardSpot, dt);
                }
            }
        }
    }
}

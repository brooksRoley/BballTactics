/**
 * game_runner.cpp — Headless C++ game simulation for balance analysis.
 *
 * Reads a JSON matchup from stdin, ticks the Court simulation for a
 * configurable number of frames, and writes the result to stdout.
 *
 * Bypasses GameManager::StartRound() / SpawnBotOpponents() so that
 * BOTH teams can be supplied externally for true team-vs-team analysis.
 *
 * stdin format:
 *   {
 *     "seed": 12345,
 *     "ticks": 3600,
 *     "dt": 0.016667,
 *     "home_team": [ {id, name, cost, stats:{shooting,speed,defense}, courtX, courtY}, ... ],
 *     "away_team": [ ... ]
 *   }
 *
 * stdout:
 *   {"homeScore":X,"awayScore":Y,"winner":"home"|"away"|"draw"}
 */

#include <iostream>
#include <sstream>
#include <string>
#include <memory>
#include "json.hpp"
#include "Court.h"
#include "SynergyEngine.h"

using json = nlohmann::json;

static std::shared_ptr<PlayerEntity> MakePlayer(const json& j) {
    int   id       = j.at("id").get<int>();
    std::string name = j.at("name").get<std::string>();
    float shooting = j.at("stats").at("shooting").get<float>();
    float speed    = j.at("stats").at("speed").get<float>();
    float defense  = j.at("stats").at("defense").get<float>();
    int   cost     = j.value("cost", 1);

    auto p = std::make_shared<PlayerEntity>(id, name, speed, shooting);
    p->stats.defense = defense;
    p->cost = cost;
    p->ClampStats();

    // Map planning-grid placement (0-4) to sim coordinates (same as GameManager)
    float cx = j.value("courtX", 2.0f);
    float cy = j.value("courtY", 2.0f);
    p->pos = {cx * 70.0f + 40.0f, cy * 70.0f + 40.0f};

    return p;
}

int main() {
    // Read entire stdin into a string
    std::ostringstream buf;
    buf << std::cin.rdbuf();
    std::string input = buf.str();

    json cfg;
    try {
        cfg = json::parse(input);
    } catch (const json::exception& e) {
        std::cerr << "JSON parse error: " << e.what() << "\n";
        return 1;
    }

    uint32_t seed = cfg.value("seed", 42u);
    int      ticks = cfg.value("ticks", 3600);
    float    dt    = cfg.value("dt", 1.0f / 60.0f);

    Court court;
    court.Reseed(seed);

    SynergyEngine synergy;

    // --- Load home team ---
    std::vector<std::shared_ptr<PlayerEntity>> homePlayers;
    for (auto& entry : cfg.at("home_team")) {
        auto p = MakePlayer(entry);
        homePlayers.push_back(p);
    }

    // Apply synergy buffs to home team
    synergy.AnalyzeRoster(homePlayers);
    auto homeBuffs = synergy.GetActiveBuffs();
    for (auto& p : homePlayers) {
        for (const auto& buff : homeBuffs) {
            p->stats.speed    += buff.speedBuff;
            p->stats.shooting += buff.shootingBuff;
            p->stats.defense  += buff.defenseBuff;
            p->ClampStats();
        }
        court.AddPlayer(p, true);
    }

    // --- Load away team ---
    std::vector<std::shared_ptr<PlayerEntity>> awayPlayers;
    for (auto& entry : cfg.at("away_team")) {
        auto p = MakePlayer(entry);
        // Offset away team to the right side of the court
        p->pos.x = 800.0f - p->pos.x;
        awayPlayers.push_back(p);
    }

    // Apply synergy buffs to away team
    synergy.AnalyzeRoster(awayPlayers);
    auto awayBuffs = synergy.GetActiveBuffs();
    for (auto& p : awayPlayers) {
        for (const auto& buff : awayBuffs) {
            p->stats.speed    += buff.speedBuff;
            p->stats.shooting += buff.shootingBuff;
            p->stats.defense  += buff.defenseBuff;
            p->ClampStats();
        }
        court.AddPlayer(p, false);
    }

    court.InitPossession();

    // --- Run simulation ---
    for (int t = 0; t < ticks; ++t) {
        court.UpdateSimulationStep(dt);
    }

    // --- Output result ---
    std::string winner = "draw";
    if (court.homeScore > court.awayScore) winner = "home";
    else if (court.awayScore > court.homeScore) winner = "away";

    std::cout << "{\"homeScore\":" << court.homeScore
              << ",\"awayScore\":" << court.awayScore
              << ",\"winner\":\"" << winner << "\"}" << std::endl;

    return 0;
}

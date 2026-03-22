#include "httplib.h"
#include "json.hpp"
#include "engine.h"

#include <atomic>
#include <string>
#include <vector>

using json = nlohmann::json;
using namespace checkers;

// ── helpers: Board ↔ 8×8 int array ──────────────────────────────────

// Format: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
static int pieceToInt(PieceType pt, Color c) {
    if (pt == NONE)  return 0;
    if (c == WHITE)  return (pt == PAWN) ? 1 : 2;
    return (pt == PAWN) ? 3 : 4;
}

static json boardToArray(const Board& b) {
    json arr = json::array();
    for (int row = 0; row < 8; ++row) {
        json rowArr = json::array();
        for (int col = 0; col < 8; ++col) {
            rowArr.push_back(pieceToInt(b.getPiece(row, col), b.getColor(row, col)));
        }
        arr.push_back(rowArr);
    }
    return arr;
}

static Board arrayToBoard(const json& arr, Color turn) {
    Board b;
    b.whitePieces = 0;
    b.whiteKings  = 0;
    b.blackPieces = 0;
    b.blackKings  = 0;
    b.currentTurn = turn;

    for (int row = 0; row < 8; ++row) {
        for (int col = 0; col < 8; ++col) {
            int v = arr[row][col].get<int>();
            if (v == 0) continue;
            Bitboard mask = squareToMask(row, col);
            switch (v) {
                case 1: b.whitePieces |= mask; break;
                case 2: b.whiteKings  |= mask; break;
                case 3: b.blackPieces |= mask; break;
                case 4: b.blackKings  |= mask; break;
            }
        }
    }
    return b;
}

// ── game state → JSON ───────────────────────────────────────────────

static std::string colorStr(Color c) { return (c == WHITE) ? "white" : "black"; }

static json gameStateJson(Engine& eng) {
    const Board& b = eng.getBoard();
    GameResult r = eng.getResult();

    std::string winner = "null";
    bool gameOver = (r != ONGOING);
    if (r == WHITE_WIN) winner = "white";
    else if (r == BLACK_WIN) winner = "black";
    else if (r == DRAW) winner = "draw";

    json j;
    j["board"]    = boardToArray(b);
    j["turn"]     = colorStr(b.currentTurn);
    j["gameOver"] = gameOver;
    if (winner == "null") j["winner"] = nullptr;
    else                  j["winner"] = winner;
    return j;
}

static json moveToJson(const Move& m) {
    json j;
    j["from"] = json::array({m.from.row, m.from.col});
    j["to"]   = json::array({m.to.row,   m.to.col});
    json caps = json::array();
    for (auto& c : m.captures) caps.push_back(json::array({c.row, c.col}));
    j["captures"] = caps;
    return j;
}

// ── server ──────────────────────────────────────────────────────────

namespace checkers_api {

Engine engine;
std::atomic<int> gamesPlayed{0};

void registerRoutes(httplib::Server& svr) {

    // GET /api/status
    svr.Get("/api/status", [](const httplib::Request&, httplib::Response& res) {
        json j;
        j["ready"]       = true;
        j["gamesPlayed"] = gamesPlayed.load();
        res.set_content(j.dump(), "application/json");
    });

    // POST /api/game/start
    svr.Post("/api/game/start", [](const httplib::Request&, httplib::Response& res) {
        engine.reset();
        gamesPlayed++;
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // GET /api/game/state
    svr.Get("/api/game/state", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // GET /api/legal-moves
    svr.Get("/api/legal-moves", [](const httplib::Request&, httplib::Response& res) {
        auto moves = engine.getLegalMoves();
        json arr = json::array();
        for (auto& m : moves) arr.push_back(moveToJson(m));
        json j;
        j["moves"] = arr;
        res.set_content(j.dump(), "application/json");
    });

    // POST /api/move   body: {"from":[r,c],"to":[r,c]}
    svr.Post("/api/move", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            int fr = body["from"][0].get<int>();
            int fc = body["from"][1].get<int>();
            int tr = body["to"][0].get<int>();
            int tc = body["to"][1].get<int>();

            auto legal = engine.getLegalMoves();
            Move chosen;
            bool found = false;
            for (auto& m : legal) {
                if (m.from.row == fr && m.from.col == fc &&
                    m.to.row   == tr && m.to.col   == tc) {
                    chosen = m;
                    found = true;
                    break;           // first match — captures are unique per (from,to)
                }
            }
            if (!found) {
                json err;
                err["error"] = "illegal move";
                res.status = 400;
                res.set_content(err.dump(), "application/json");
                return;
            }
            engine.makeMove(chosen);
            res.set_content(gameStateJson(engine).dump(), "application/json");
        } catch (...) {
            json err;
            err["error"] = "invalid json";
            res.status = 400;
            res.set_content(err.dump(), "application/json");
        }
    });

    // POST /api/game/reset
    svr.Post("/api/game/reset", [](const httplib::Request&, httplib::Response& res) {
        engine.reset();
        gamesPlayed++;
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // POST /api/board/set  body: {"board":[[...]],"turn":"white|black"}
    svr.Post("/api/board/set", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            Color turn = (body["turn"].get<std::string>() == "white") ? WHITE : BLACK;
            Board b = arrayToBoard(body["board"], turn);
            engine.getBoard() = b;
            res.set_content(gameStateJson(engine).dump(), "application/json");
        } catch (...) {
            json err;
            err["error"] = "invalid json";
            res.status = 400;
            res.set_content(err.dump(), "application/json");
        }
    });
}

} // namespace checkers_api

#include "httplib.h"
#include "json.hpp"
#include "engine.h"

#include <atomic>
#include <string>
#include <vector>
#include <unordered_map>

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
    int grid[8][8] = {};
    Bitboard bb;
    bb = b.whitePieces;
    while (bb) { int bit = __builtin_ctzll(bb); grid[bit / 8][bit % 8] = 1; bb &= bb - 1; }
    bb = b.whiteKings;
    while (bb) { int bit = __builtin_ctzll(bb); grid[bit / 8][bit % 8] = 2; bb &= bb - 1; }
    bb = b.blackPieces;
    while (bb) { int bit = __builtin_ctzll(bb); grid[bit / 8][bit % 8] = 3; bb &= bb - 1; }
    bb = b.blackKings;
    while (bb) { int bit = __builtin_ctzll(bb); grid[bit / 8][bit % 8] = 4; bb &= bb - 1; }
    json arr = json::array();
    for (int row = 0; row < 8; ++row) {
        json rowArr = json::array();
        for (int col = 0; col < 8; ++col) {
            rowArr.push_back(grid[row][col]);
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
    json pathArr = json::array();
    for (auto& s : m.path) pathArr.push_back(json::array({s.row, s.col}));
    j["path"] = pathArr;
    return j;
}

// ── server ──────────────────────────────────────────────────────────

namespace checkers_api {

Engine engine;
std::mutex engineMutex;
std::atomic<int> gamesPlayed{0};

void registerRoutes(httplib::Server& svr) {

    // GET /api/status
    svr.Get("/api/status", [](const httplib::Request&, httplib::Response& res) {
        json j;
        j["ready"]       = true;
        j["gamesPlayed"] = gamesPlayed.load();
        res.set_content(j.dump(), "application/json");
    });

    // POST /api/game/start?first=white|black
    svr.Post("/api/game/start", [](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(engineMutex);
        engine.reset();
        // Alternate who starts (odd games = black first)
        if (gamesPlayed % 2 == 1) {
            engine.getBoard().currentTurn = BLACK;
        }
        gamesPlayed++;
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // GET /api/game/state
    svr.Get("/api/game/state", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(engineMutex);
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // GET /api/legal-moves
    svr.Get("/api/legal-moves", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(engineMutex);
        auto moves = engine.getLegalMoves();
        json arr = json::array();
        for (auto& m : moves) arr.push_back(moveToJson(m));
        json j;
        j["moves"] = arr;
        res.set_content(j.dump(), "application/json");
    });

    // POST /api/move   body: {"from":[r,c],"to":[r,c],"captures":[[r,c],...]}
    svr.Post("/api/move", [](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(engineMutex);
        try {
            auto body = json::parse(req.body);
            int fr = body["from"][0].get<int>();
            int fc = body["from"][1].get<int>();
            int tr = body["to"][0].get<int>();
            int tc = body["to"][1].get<int>();

            auto legal = engine.getLegalMoves();

            // Build hash map for O(1) lookup by from/to coordinates
            struct MoveKey { int r1, c1, r2, c2; };
            struct KeyHash {
                size_t operator()(const MoveKey& k) const {
                    return ((k.r1 * 8 + k.c1) * 64 + (k.r2 * 8 + k.c2));
                }
            };
            struct KeyEq {
                bool operator()(const MoveKey& a, const MoveKey& b) const {
                    return a.r1 == b.r1 && a.c1 == b.c1 && a.r2 == b.r2 && a.c2 == b.c2;
                }
            };
            std::unordered_map<MoveKey, std::vector<size_t>, KeyHash, KeyEq> moveMap;
            for (size_t i = 0; i < legal.size(); i++) {
                MoveKey key{legal[i].from.row, legal[i].from.col,
                            legal[i].to.row, legal[i].to.col};
                moveMap[key].push_back(i);
            }

            Move chosen;
            bool found = false;
            MoveKey query{fr, fc, tr, tc};
            auto it = moveMap.find(query);
            if (it != moveMap.end()) {
                for (size_t idx : it->second) {
                    auto& m = legal[idx];
                    // If captures provided, match them exactly
                    if (body.contains("captures") && body["captures"].is_array()) {
                        auto caps = body["captures"];
                        if (m.captures.size() != caps.size()) continue;
                        bool match = true;
                        for (size_t i = 0; i < m.captures.size(); i++) {
                            if (m.captures[i].row != caps[i][0].get<int>() ||
                                m.captures[i].col != caps[i][1].get<int>()) {
                                match = false;
                                break;
                            }
                        }
                        if (!match) continue;
                    }
                    chosen = m;
                    found = true;
                    break;
                }
            }
            if (!found) {
                json err;
                err["error"] = "illegal move";
                res.status = 400;
                res.set_content(err.dump(), "application/json");
                return;
            }
            engine.makeMoveUnchecked(chosen);
            // Return game state with captures and path from the executed move
            json response = gameStateJson(engine);
            json caps = json::array();
            for (auto& c : chosen.captures) caps.push_back(json::array({c.row, c.col}));
            response["captures"] = caps;
            json pathArr = json::array();
            for (auto& s : chosen.path) pathArr.push_back(json::array({s.row, s.col}));
            response["path"] = pathArr;
            res.set_content(response.dump(), "application/json");
        } catch (...) {
            json err;
            err["error"] = "invalid json";
            res.status = 400;
            res.set_content(err.dump(), "application/json");
        }
    });

    // POST /api/game/reset
    svr.Post("/api/game/reset", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(engineMutex);
        engine.reset();
        gamesPlayed++;
        res.set_content(gameStateJson(engine).dump(), "application/json");
    });

    // POST /api/board/set  body: {"board":[[...]],"turn":"white|black"}
    svr.Post("/api/board/set", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            // Validate turn
            if (!body.contains("turn") || !body["turn"].is_string()) {
                json err; err["error"] = "missing or invalid 'turn' field";
                res.status = 400; res.set_content(err.dump(), "application/json"); return;
            }
            std::string turnStr = body["turn"].get<std::string>();
            if (turnStr != "white" && turnStr != "black") {
                json err; err["error"] = "'turn' must be 'white' or 'black'";
                res.status = 400; res.set_content(err.dump(), "application/json"); return;
            }
            Color turn = (turnStr == "white") ? WHITE : BLACK;
            // Validate board dimensions
            if (!body.contains("board") || !body["board"].is_array()) {
                json err; err["error"] = "missing or invalid 'board' field";
                res.status = 400; res.set_content(err.dump(), "application/json"); return;
            }
            auto& boardArr = body["board"];
            if (boardArr.size() != 8) {
                json err; err["error"] = "board must have 8 rows";
                res.status = 400; res.set_content(err.dump(), "application/json"); return;
            }
            for (int r = 0; r < 8; r++) {
                if (!boardArr[r].is_array() || boardArr[r].size() != 8) {
                    json err; err["error"] = "each board row must have 8 columns";
                    res.status = 400; res.set_content(err.dump(), "application/json"); return;
                }
                for (int c = 0; c < 8; c++) {
                    int v = boardArr[r][c].get<int>();
                    if (v < 0 || v > 4) {
                        json err; err["error"] = "board values must be 0-4";
                        res.status = 400; res.set_content(err.dump(), "application/json"); return;
                    }
                }
            }
            std::lock_guard<std::mutex> lock(engineMutex);
            Board b = arrayToBoard(boardArr, turn);
            engine.getBoard() = b;
            res.set_content(gameStateJson(engine).dump(), "application/json");
        } catch (json::parse_error& e) {
            json err; err["error"] = std::string("invalid json: ") + e.what();
            res.status = 400; res.set_content(err.dump(), "application/json");
        } catch (json::type_error& e) {
            json err; err["error"] = std::string("invalid type in request: ") + e.what();
            res.status = 400; res.set_content(err.dump(), "application/json");
        } catch (std::exception& e) {
            json err; err["error"] = e.what();
            res.status = 500; res.set_content(err.dump(), "application/json");
        } catch (...) {
            json err; err["error"] = "internal error";
            res.status = 500; res.set_content(err.dump(), "application/json");
        }
    });
}

} // namespace checkers_api

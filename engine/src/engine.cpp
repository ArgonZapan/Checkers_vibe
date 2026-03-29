#include "engine.h"
#include <algorithm>
#include <cstring>
#include <sstream>

namespace checkers {

static bool capturesEqual(const Move& a, const Move& b) {
    if (a.numCaptures != b.numCaptures) return false;
    for (int i = 0; i < a.numCaptures; i++) {
        if (a.captures[i] != b.captures[i]) return false;
    }
    return true;
}

Engine::Engine() {
    reset();
}

void Engine::reset() {
    board_.reset();
    history_.clear();
    movesWithoutCapture_ = 0;
    positionHistory_.clear();
    positionHistory_[getBoardHash()] = 1;
}

std::string Engine::getBoardHash() const {
    std::ostringstream os;
    os << board_.whitePieces << "," << board_.whiteKings << ","
       << board_.blackPieces << "," << board_.blackKings << ","
       << board_.currentTurn;
    return os.str();
}

bool Engine::hasInsufficientMaterial() const {
    int whiteKings = __builtin_popcountll(board_.whiteKings);
    int blackKings = __builtin_popcountll(board_.blackKings);
    int whitePawns = __builtin_popcountll(board_.whitePieces);
    int blackPawns = __builtin_popcountll(board_.blackPieces);

    if (whitePawns > 0 || blackPawns > 0) return false;

    if (whiteKings == 1 && blackKings == 1) return true;
    if (whiteKings == 2 && blackKings == 1) return false;
    if (whiteKings == 1 && blackKings == 2) return false;
    if (whiteKings == 2 && blackKings == 2) return false;

    return false;
}

const Board& Engine::getBoard() const {
    return board_;
}

Board& Engine::getBoard() {
    return board_;
}

std::vector<Move> Engine::getLegalMoves() const {
    return MoveGenerator::generateAll(board_, board_.currentTurn);
}

std::vector<Move> Engine::getLegalMoves(Color color) const {
    return MoveGenerator::generateAll(board_, color);
}

bool Engine::makeMove(Move& move) {
    auto legalMoves = getLegalMoves();
    bool found = false;
    for (auto& m : legalMoves) {
        if (m.from == move.from && m.to == move.to && capturesEqual(m, move)) {
            found = true;
            break;
        }
    }
    if (!found) return false;

    board_.makeMove(move);
    history_.push_back(move);
    if (move.numCaptures == 0) movesWithoutCapture_++; else movesWithoutCapture_ = 0;

    std::string hash = getBoardHash();
    positionHistory_[hash]++;

    return true;
}

void Engine::makeMoveUnchecked(Move& move) {
    board_.makeMove(move);
    history_.push_back(move);
    if (move.numCaptures == 0) movesWithoutCapture_++; else movesWithoutCapture_ = 0;

    std::string hash = getBoardHash();
    positionHistory_[hash]++;
}

bool Engine::isLegal(const Move& move) const {
    auto legalMoves = getLegalMoves();
    for (auto& m : legalMoves) {
        if (m.from == move.from && m.to == move.to && capturesEqual(m, move)) {
            return true;
        }
    }
    return false;
}

GameResult Engine::getResult() const {
    if (!MoveGenerator::hasAnyMove(board_, board_.currentTurn)) {
        return (board_.currentTurn == WHITE) ? BLACK_WIN : WHITE_WIN;
    }

    if (movesWithoutCapture_ >= 50) {
        return DRAW;
    }

    std::string hash = getBoardHash();
    auto it = positionHistory_.find(hash);
    if (it != positionHistory_.end() && it->second >= 3) {
        return DRAW;
    }

    if (hasInsufficientMaterial()) {
        return DRAW;
    }

    return ONGOING;
}

bool Engine::isGameOver() const {
    return getResult() != ONGOING;
}

const std::vector<Move>& Engine::getHistory() const {
    return history_;
}

bool Engine::undoLastMove() {
    if (history_.empty()) return false;

    std::string hash = getBoardHash();
    auto it = positionHistory_.find(hash);
    if (it != positionHistory_.end()) {
        if (it->second <= 1) {
            positionHistory_.erase(it);
        } else {
            it->second--;
        }
    }

    board_.undoMove(history_.back());
    history_.pop_back();

    movesWithoutCapture_ = 0;
    for (size_t i = history_.size(); i > 0; i--) {
        if (history_[i - 1].isCapture()) break;
        movesWithoutCapture_++;
    }

    return true;
}

MinimaxResult Engine::getBestMove(Color turn, int depth) {
    return minimaxSearch(board_, turn, depth);
}

} // namespace checkers

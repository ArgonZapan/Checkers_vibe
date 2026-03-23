#include "engine.h"
#include <algorithm>
#include <cstring>

namespace checkers {

// Helper: compare two Move captures arrays
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
    // Sprawdź czy ruch jest legalny
    auto legalMoves = getLegalMoves();
    bool found = false;
    for (auto& m : legalMoves) {
        if (m.from == move.from && m.to == move.to && capturesEqual(m, move)) {
            found = true;
            break;
        }
    }
    if (!found) return false;

    // Wykonaj
    board_.makeMove(move);
    history_.push_back(move);
    if (move.numCaptures == 0) movesWithoutCapture_++; else movesWithoutCapture_ = 0;

    return true;
}

void Engine::makeMoveUnchecked(Move& move) {
    board_.makeMove(move);
    history_.push_back(move);
    if (move.numCaptures == 0) movesWithoutCapture_++; else movesWithoutCapture_ = 0;
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
        // Obecny gracz nie ma ruchów — przegrywa
        return (board_.currentTurn == WHITE) ? BLACK_WIN : WHITE_WIN;
    }

    // Sprawdź remis: 20 ruchów bez bicia (O(1) zamiast O(n))
    if (movesWithoutCapture_ >= 40) { // 40 pół-ruchów = 20 pełnych ruchów
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

    board_.undoMove(history_.back());
    history_.pop_back();

    // Rebuild movesWithoutCapture_ from remaining history
    movesWithoutCapture_ = 0;
    for (int i = history_.size() - 1; i >= 0; i--) {
        if (history_[i].isCapture()) break;
        movesWithoutCapture_++;
    }

    return true;
}

} // namespace checkers

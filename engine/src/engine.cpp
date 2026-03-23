#include "engine.h"
#include <algorithm>

namespace checkers {

Engine::Engine() {
    reset();
}

void Engine::reset() {
    board_.reset();
    history_.clear();
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
        if (m.from == move.from && m.to == move.to && m.captures == move.captures) {
            found = true;
            break;
        }
    }
    if (!found) return false;

    // Wykonaj
    board_.makeMove(move);
    history_.push_back(move);

    return true;
}

void Engine::makeMoveUnchecked(Move& move) {
    board_.makeMove(move);
    history_.push_back(move);
}

bool Engine::isLegal(const Move& move) const {
    auto legalMoves = getLegalMoves();
    for (auto& m : legalMoves) {
        if (m.from == move.from && m.to == move.to && m.captures == move.captures) {
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

    // Sprawdź remis: 20 ruchów bez bicia
    int movesWithoutCapture = 0;
    for (int i = history_.size() - 1; i >= 0; i--) {
        if (history_[i].isCapture()) break;
        movesWithoutCapture++;
    }
    if (movesWithoutCapture >= 40) { // 40 pół-ruchów = 20 pełnych ruchów
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

    return true;
}

} // namespace checkers

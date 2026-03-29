#pragma once
#include "board.h"
#include "movegen.h"
#include "minimax.h"
#include <unordered_map>
#include <string>

namespace checkers {

enum GameResult { ONGOING, WHITE_WIN, BLACK_WIN, DRAW };

class Engine {
public:
    Engine();

    void reset();

    const Board& getBoard() const;
    Board& getBoard();

    std::vector<Move> getLegalMoves() const;
    std::vector<Move> getLegalMoves(Color color) const;

    bool makeMove(Move& move);
    void makeMoveUnchecked(Move& move);

    bool isLegal(const Move& move) const;

    GameResult getResult() const;
    bool isGameOver() const;

    const std::vector<Move>& getHistory() const;
    bool undoLastMove();

    int getMovesWithoutCapture() const { return movesWithoutCapture_; }

    MinimaxResult getBestMove(Color turn, int depth = 4);

private:
    std::string getBoardHash() const;
    bool hasInsufficientMaterial() const;

    Board board_;
    std::vector<Move> history_;
    int movesWithoutCapture_ = 0;
    std::unordered_map<std::string, int> positionHistory_;
};

} // namespace checkers

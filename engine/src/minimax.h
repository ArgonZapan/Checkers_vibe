#pragma once
#include "board.h"
#include "movegen.h"
#include <limits>
#include <vector>

namespace checkers {

// Piece values: encoding 1=white pawn, 2=white king, 3=black pawn, 4=black king
inline double pieceValue(int encoding) {
    switch (encoding) {
        case 0: return 0;
        case 1: return 1;  // white pawn
        case 2: return 3;  // white king
        case 3: return 1;  // black pawn
        case 4: return 3;  // black king
        default: return 0;
    }
}

// Evaluate board from perspective of 'turn' (WHITE or BLACK)
double evaluate(const Board& board, Color turn);

// Minimax result
struct MinimaxResult {
    double score;
    Move move;
    bool hasMove;
};

// Top-level search: find best move for given turn
MinimaxResult minimaxSearch(Board& board, Color turn, int depth = 4);

} // namespace checkers

#include "minimax.h"
#include <cmath>
#include <algorithm>

namespace checkers {

// Convert Board to flat 64-element array
// 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
static void boardToFlat(const Board& board, int flat[64]) {
    for (int row = 0; row < 8; row++) {
        for (int col = 0; col < 8; col++) {
            int idx = row * 8 + col;
            if (!isDarkSquare(row, col)) {
                flat[idx] = 0;
                continue;
            }
            Bitboard mask = squareToMask(row, col);
            if (board.whitePieces & mask) flat[idx] = 1;
            else if (board.whiteKings & mask) flat[idx] = 2;
            else if (board.blackPieces & mask) flat[idx] = 3;
            else if (board.blackKings & mask) flat[idx] = 4;
            else flat[idx] = 0;
        }
    }
}

// Evaluate from WHITE's perspective (positive = WHITE ahead)
static double evalWhitePerspective(const Board& board) {
    int flat[64];
    boardToFlat(board, flat);
    double score = 0;

    for (int i = 0; i < 64; i++) {
        int val = flat[i];
        if (val == 0) continue;
        int row = i / 8, col = i % 8;
        bool isWhite = (val == 1 || val == 2);
        double pieceVal = pieceValue(val);
        double posBonus = 0;

        if (val == 1 || val == 3) {
            int advance = isWhite ? row : (7 - row);
            posBonus = advance * 0.05;
            if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.1;
        } else {
            if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.3;
            else posBonus -= 0.1;
        }

        double pieceScore = pieceVal + posBonus;
        if (isWhite) score += pieceScore;
        else score -= pieceScore;
    }
    return score;
}

double evaluate(const Board& board, Color perspective) {
    double s = evalWhitePerspective(board);
    return (perspective == BLACK) ? -s : s;
}

static MinimaxResult minimaxRec(Board& board, int depth, double alpha, double beta,
                                bool maximizing, Color maxPlayer, Color currentTurn) {
    MinimaxResult result;
    result.hasMove = false;
    result.move = Move();

    std::vector<Move> moves = MoveGenerator::generateAll(board, currentTurn);

    if (depth == 0 || moves.empty()) {
        result.score = evaluate(board, maxPlayer);
        result.hasMove = !moves.empty();
        if (!moves.empty()) result.move = moves[0];
        return result;
    }

    result.hasMove = true;
    result.move = moves[0];

    if (maximizing) {
        double maxEval = -1e9;
        for (const Move& move : moves) {
            Board snapshot = board;
            board.makeMove(const_cast<Move&>(move));
            bool isCapture = move.isCapture();
            bool extraTurn = isCapture && MoveGenerator::hasAnyMove(board, currentTurn);
            Color nextTurn = extraTurn ? currentTurn : ((currentTurn == WHITE) ? BLACK : WHITE);
            bool nextMax = extraTurn ? true : (nextTurn == maxPlayer);
            double eval = minimaxRec(board, depth - 1, alpha, beta, nextMax, maxPlayer, nextTurn).score;
            board = snapshot;
            if (eval > maxEval) {
                maxEval = eval;
                result.move = move;
            }
            alpha = std::max(alpha, eval);
            if (beta <= alpha) break;
        }
        result.score = maxEval;
    } else {
        double minEval = 1e9;
        for (const Move& move : moves) {
            Board snapshot = board;
            board.makeMove(const_cast<Move&>(move));
            bool isCapture = move.isCapture();
            bool extraTurn = isCapture && MoveGenerator::hasAnyMove(board, currentTurn);
            Color nextTurn = extraTurn ? currentTurn : ((currentTurn == WHITE) ? BLACK : WHITE);
            bool nextMax = extraTurn ? false : (nextTurn == maxPlayer);
            double eval = minimaxRec(board, depth - 1, alpha, beta, nextMax, maxPlayer, nextTurn).score;
            board = snapshot;
            if (eval < minEval) {
                minEval = eval;
                result.move = move;
            }
            beta = std::min(beta, eval);
            if (beta <= alpha) break;
        }
        result.score = minEval;
    }

    return result;
}

MinimaxResult minimaxSearch(Board& board, Color turn, int depth) {
    bool maximizing = (turn == WHITE);
    return minimaxRec(board, depth, -1e9, 1e9, maximizing, turn, turn);
}

} // namespace checkers

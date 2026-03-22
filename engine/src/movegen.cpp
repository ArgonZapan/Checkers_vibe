#include "movegen.h"
#include <algorithm>

namespace checkers {

constexpr int MoveGenerator::WHITE_DIRS[2][2];
constexpr int MoveGenerator::BLACK_DIRS[2][2];
constexpr int MoveGenerator::ALL_DIRS[4][2];

std::vector<Move> MoveGenerator::generateAll(const Board& board, Color color) {
    auto captures = generateCaptures(board, color);
    if (!captures.empty()) {
        return captures;
    }

    std::vector<Move> moves;
    Bitboard myPieces = board.pieces(color);
    Bitboard pawns = (color == WHITE) ? board.whitePieces : board.blackPieces;
    Bitboard kings = (color == WHITE) ? board.whiteKings : board.blackKings;

    for (int row = 0; row < 8; row++) {
        for (int col = 0; col < 8; col++) {
            if (!(myPieces & squareToMask(row, col))) continue;
            if (pawns & squareToMask(row, col)) {
                auto m = generatePawnMoves(board, row, col, color);
                moves.insert(moves.end(), m.begin(), m.end());
            } else {
                auto m = generateKingMoves(board, row, col, color);
                moves.insert(moves.end(), m.begin(), m.end());
            }
        }
    }

    return moves;
}

std::vector<Move> MoveGenerator::generateCaptures(const Board& board, Color color) {
    std::vector<Move> allCaptures;
    Bitboard myPieces = board.pieces(color);
    Bitboard pawns = (color == WHITE) ? board.whitePieces : board.blackPieces;
    Bitboard kings = (color == WHITE) ? board.whiteKings : board.blackKings;

    // Single copy for all pieces — multiCapture mutates board in place
    Board temp = board;

    for (int row = 0; row < 8; row++) {
        for (int col = 0; col < 8; col++) {
            if (!(myPieces & squareToMask(row, col))) continue;
            if (pawns & squareToMask(row, col)) {
                auto caps = generatePawnCaptures(temp, row, col, color);
                allCaptures.insert(allCaptures.end(), caps.begin(), caps.end());
            } else {
                auto caps = generateKingCaptures(temp, row, col, color);
                allCaptures.insert(allCaptures.end(), caps.begin(), caps.end());
            }
        }
    }

    return allCaptures;
}

bool MoveGenerator::hasMoves(const Board& board, Color color) {
    return !generateAll(board, color).empty();
}

std::vector<Move> MoveGenerator::generatePawnMoves(const Board& board, int row, int col, Color color) {
    std::vector<Move> moves;
    auto& dirs = (color == WHITE) ? WHITE_DIRS : BLACK_DIRS;

    for (auto& d : dirs) {
        int nr = row + d[0];
        int nc = col + d[1];
        if (Board::inBounds(nr, nc) && board.isEmpty(nr, nc)) {
            Move m;
            m.from = Square(row, col);
            m.to = Square(nr, nc);
            moves.push_back(m);
        }
    }

    return moves;
}

std::vector<Move> MoveGenerator::generateKingMoves(const Board& board, int row, int col, Color color) {
    std::vector<Move> moves;

    for (auto& d : ALL_DIRS) {
        int nr = row + d[0];
        int nc = col + d[1];
        while (Board::inBounds(nr, nc) && board.isEmpty(nr, nc)) {
            Move m;
            m.from = Square(row, col);
            m.to = Square(nr, nc);
            moves.push_back(m);
            nr += d[0];
            nc += d[1];
        }
    }

    return moves;
}

// Helper: rekurencyjne bicie wielokrotne z oryginalną pozycją startową
static void multiCapture(Board& board, int origR, int origC, int curR, int curC,
                          Color color, bool isKing, std::vector<Square>& captures,
                          std::vector<Move>& result) {
    Bitboard myPieces = board.pieces(color);
    Bitboard oppPieces = board.pieces((color == WHITE) ? BLACK : WHITE);
    bool foundAny = false;

    for (auto& d : MoveGenerator::ALL_DIRS) {
        if (isKing) {
            // Damka: szukaj przeciwnika po drodze, potem puste pole za nim
            int nr = curR + d[0];
            int nc = curC + d[1];
            bool foundOpp = false;
            int oppR = -1, oppC = -1;

            while (Board::inBounds(nr, nc)) {
                Bitboard mask = squareToMask(nr, nc);
                if (oppPieces & mask) {
                    if (foundOpp) break;
                    foundOpp = true;
                    oppR = nr;
                    oppC = nc;
                } else if (myPieces & mask) {
                    break;
                } else if (foundOpp) {
                    // Sprawdź czy nie zbity już
                    Square cap(oppR, oppC);
                    bool already = false;
                    for (auto& c : captures) {
                        if (c == cap) { already = true; break; }
                    }
                    if (!already) {
                        // Mutate board in place, save state for rollback
                        Bitboard capMask = squareToMask(oppR, oppC);
                        Bitboard fromMask = squareToMask(curR, curC);
                        Bitboard toMask = squareToMask(nr, nc);
                        Bitboard savedOpp, savedOppKings, savedMyKings;
                        if (color == WHITE) {
                            savedOpp = board.blackPieces;
                            savedOppKings = board.blackKings;
                            savedMyKings = board.whiteKings;
                            board.blackPieces &= ~capMask;
                            board.blackKings &= ~capMask;
                            board.whiteKings &= ~fromMask;
                            board.whiteKings |= toMask;
                        } else {
                            savedOpp = board.whitePieces;
                            savedOppKings = board.whiteKings;
                            savedMyKings = board.blackKings;
                            board.whitePieces &= ~capMask;
                            board.whiteKings &= ~capMask;
                            board.blackKings &= ~fromMask;
                            board.blackKings |= toMask;
                        }

                        captures.push_back(cap);
                        foundAny = true;
                        multiCapture(board, origR, origC, nr, nc, color, true, captures, result);
                        captures.pop_back();

                        // Rollback board state
                        if (color == WHITE) {
                            board.blackPieces = savedOpp;
                            board.blackKings = savedOppKings;
                            board.whiteKings = savedMyKings;
                        } else {
                            board.whitePieces = savedOpp;
                            board.whiteKings = savedOppKings;
                            board.blackKings = savedMyKings;
                        }
                    }
                }
                nr += d[0];
                nc += d[1];
            }
        } else {
            // Pionek: przeskok o 2
            int mr = curR + d[0];
            int mc = curC + d[1];
            int nr = curR + d[0] * 2;
            int nc = curC + d[1] * 2;

            if (!Board::inBounds(nr, nc) || !Board::inBounds(mr, mc)) continue;

            Bitboard midMask = squareToMask(mr, mc);
            Bitboard endMask = squareToMask(nr, nc);

            if (!(oppPieces & midMask) || (board.allPieces() & endMask)) continue;

            Square cap(mr, mc);
            bool already = false;
            for (auto& c : captures) {
                if (c == cap) { already = true; break; }
            }
            if (already) continue;

            // Save state for rollback
            Bitboard savedOpp, savedOppKings, savedMyPieces, savedMyKings;
            if (color == WHITE) {
                savedOpp = board.blackPieces;
                savedOppKings = board.blackKings;
                savedMyPieces = board.whitePieces;
                savedMyKings = board.whiteKings;
            } else {
                savedOpp = board.whitePieces;
                savedOppKings = board.whiteKings;
                savedMyPieces = board.blackPieces;
                savedMyKings = board.blackKings;
            }

            // Mutate board in place
            Bitboard fromMask = squareToMask(curR, curC);
            if (color == WHITE) {
                board.blackPieces &= ~midMask;
                board.blackKings &= ~midMask;
                board.whitePieces &= ~fromMask;
                board.whitePieces |= endMask;
            } else {
                board.whitePieces &= ~midMask;
                board.whiteKings &= ~midMask;
                board.blackPieces &= ~fromMask;
                board.blackPieces |= endMask;
            }

            // Sprawdź promocję
            bool becameKing = false;
            if (color == WHITE && nr == 7) {
                board.whitePieces &= ~endMask;
                board.whiteKings |= endMask;
                becameKing = true;
            } else if (color == BLACK && nr == 0) {
                board.blackPieces &= ~endMask;
                board.blackKings |= endMask;
                becameKing = true;
            }

            captures.push_back(cap);
            foundAny = true;
            multiCapture(board, origR, origC, nr, nc, color, becameKing, captures, result);
            captures.pop_back();

            // Rollback board state
            if (color == WHITE) {
                board.blackPieces = savedOpp;
                board.blackKings = savedOppKings;
                board.whitePieces = savedMyPieces;
                board.whiteKings = savedMyKings;
            } else {
                board.whitePieces = savedOpp;
                board.whiteKings = savedOppKings;
                board.blackPieces = savedMyPieces;
                board.blackKings = savedMyKings;
            }
        }
    }

    if (!foundAny && !captures.empty()) {
        Move m;
        m.from = Square(origR, origC);
        m.to = Square(curR, curC);
        m.captures = captures;
        result.push_back(m);
    }
}

std::vector<Move> MoveGenerator::generatePawnCaptures(Board& board, int row, int col, Color color) {
    std::vector<Move> result;
    std::vector<Square> caps;
    bool isKing = ((color == WHITE) ? board.whiteKings : board.blackKings) & squareToMask(row, col);
    multiCapture(board, row, col, row, col, color, isKing, caps, result);
    return result;
}

std::vector<Move> MoveGenerator::generateKingCaptures(Board& board, int row, int col, Color color) {
    std::vector<Move> result;
    std::vector<Square> caps;
    multiCapture(board, row, col, row, col, color, true, caps, result);
    return result;
}

} // namespace checkers

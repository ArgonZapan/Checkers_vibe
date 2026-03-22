#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace checkers {

// Kolory
enum Color { WHITE = 0, BLACK = 1 };

// Typ pionka
enum PieceType { NONE = 0, PAWN = 1, KING = 2 };

// Pole na planszy (rząd, kolumna)
struct Square {
    int row;
    int col;
    Square(int r = 0, int c = 0) : row(r), col(c) {}
    bool operator==(const Square& o) const { return row == o.row && col == o.col; }
    bool operator!=(const Square& o) const { return !(*this == o); }
};

// Ruch
struct Move {
    Square from;
    Square to;
    std::vector<Square> captures; // zbite pionki (puste = zwykły ruch)
    bool isCapture() const { return !captures.empty(); }
};

// Bitboard: 64-bit, bit 0 = pole a1, bit 63 = pole h8
// Plansza: rzędy 0-7 (0 = dolny), kolumny 0-7 (0 = lewy)
// Tylko ciemne pola (parzysta suma row+col)
using Bitboard = uint64_t;

// Konwersja pole → bit
inline int squareToBit(int row, int col) {
    return row * 8 + col;
}

inline Bitboard squareToMask(int row, int col) {
    return 1ULL << squareToBit(row, col);
}

inline bool isDarkSquare(int row, int col) {
    return (row + col) % 2 == 1;
}

// Plansza
class Board {
public:
    Bitboard whitePieces; // pionki białe
    Bitboard whiteKings;  // damki białe
    Bitboard blackPieces; // pionki czarne
    Bitboard blackKings;  // damki czarne
    Color currentTurn;

    Board();

    // Reset do pozycji startowej
    void reset();

    // Pobierz typ pionka na polu
    PieceType getPiece(int row, int col) const;
    Color getColor(int row, int col) const;

    // Sprawdź czy pole jest puste
    bool isEmpty(int row, int col) const;

    // Pobierz maskę wszystkich pionków danego koloru
    Bitboard pieces(Color c) const;
    Bitboard allPieces() const;
    Bitboard emptySquares() const;

    // Konwersja bitboard → string (debug)
    std::string toString() const;

    // Wykonaj ruch
    void makeMove(const Move& move);

    // Cofnij ruch (do searcha)
    void undoMove(const Move& move);

    // Czy pole jest na planszy
    static bool inBounds(int row, int col);
};

} // namespace checkers

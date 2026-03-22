#include "board.h"
#include <sstream>

namespace checkers {

Board::Board() {
    reset();
}

void Board::reset() {
    whitePieces = 0;
    whiteKings = 0;
    blackPieces = 0;
    blackKings = 0;
    currentTurn = WHITE;

    // Białe na rzędach 0-2, czarne na rzędach 5-7
    // Tylko ciemne pola
    for (int row = 0; row < 3; row++) {
        for (int col = 0; col < 8; col++) {
            if (isDarkSquare(row, col)) {
                whitePieces |= squareToMask(row, col);
            }
        }
    }
    for (int row = 5; row < 8; row++) {
        for (int col = 0; col < 8; col++) {
            if (isDarkSquare(row, col)) {
                blackPieces |= squareToMask(row, col);
            }
        }
    }
}

bool Board::inBounds(int row, int col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

PieceType Board::getPiece(int row, int col) const {
    if (!inBounds(row, col)) return NONE;
    Bitboard mask = squareToMask(row, col);
    if (whitePieces & mask) return PAWN;
    if (whiteKings & mask) return KING;
    if (blackPieces & mask) return PAWN;
    if (blackKings & mask) return KING;
    return NONE;
}

Color Board::getColor(int row, int col) const {
    if (!inBounds(row, col)) return WHITE;
    Bitboard mask = squareToMask(row, col);
    if ((whitePieces | whiteKings) & mask) return WHITE;
    return BLACK;
}

bool Board::isEmpty(int row, int col) const {
    if (!inBounds(row, col)) return true;
    return !(allPieces() & squareToMask(row, col));
}

Bitboard Board::pieces(Color c) const {
    if (c == WHITE) return whitePieces | whiteKings;
    return blackPieces | blackKings;
}

Bitboard Board::allPieces() const {
    return whitePieces | whiteKings | blackPieces | blackKings;
}

Bitboard Board::emptySquares() const {
    return ~allPieces();
}

std::string Board::toString() const {
    std::ostringstream os;
    os << "  a b c d e f g h\n";
    for (int row = 7; row >= 0; row--) {
        os << (row + 1) << " ";
        for (int col = 0; col < 8; col++) {
            if (!isDarkSquare(row, col)) {
                os << "  ";
                continue;
            }
            Bitboard mask = squareToMask(row, col);
            if (whitePieces & mask) os << "w ";
            else if (whiteKings & mask) os << "W ";
            else if (blackPieces & mask) os << "b ";
            else if (blackKings & mask) os << "B ";
            else os << ". ";
        }
        os << (row + 1) << "\n";
    }
    os << "  a b c d e f g h\n";
    os << "Turn: " << (currentTurn == WHITE ? "White" : "Black") << "\n";
    return os.str();
}

void Board::makeMove(const Move& move) {
    Bitboard fromMask = squareToMask(move.from.row, move.from.col);
    Bitboard toMask = squareToMask(move.to.row, move.to.col);

    // Określ kolor i typ pionka
    bool isWhite = (whitePieces | whiteKings) & fromMask;
    bool isKing = (whiteKings | blackKings) & fromMask;

    Bitboard& myPieces = isWhite ? whitePieces : blackPieces;
    Bitboard& myKings = isWhite ? whiteKings : blackKings;

    // Przesuń pionek
    myPieces &= ~fromMask;
    myKings &= ~fromMask;

    if (isKing) {
        myKings |= toMask;
    } else {
        myPieces |= toMask;
    }

    // Usuń zbite pionki
    for (const auto& cap : move.captures) {
        Bitboard capMask = squareToMask(cap.row, cap.col);
        whitePieces &= ~capMask;
        whiteKings &= ~capMask;
        blackPieces &= ~capMask;
        blackKings &= ~capMask;
    }

    // Promocja: pionek na ostatnim rzędzie
    if (!isKing) {
        if (isWhite && move.to.row == 7) {
            myPieces &= ~toMask;
            myKings |= toMask;
        } else if (!isWhite && move.to.row == 0) {
            myPieces &= ~toMask;
            myKings |= toMask;
        }
    }

    // Zmień turę
    currentTurn = (currentTurn == WHITE) ? BLACK : WHITE;
}

void Board::undoMove(const Move& move) {
    // Cofnij turę
    currentTurn = (currentTurn == WHITE) ? BLACK : WHITE;

    Bitboard toMask = squareToMask(move.to.row, move.to.col);

    // Określ kolor na polu docelowym (po ruchu)
    bool isWhite = (whitePieces | whiteKings) & toMask;
    bool isKing = (whiteKings | blackKings) & toMask;

    Bitboard& myPieces = isWhite ? whitePieces : blackPieces;
    Bitboard& myKings = isWhite ? whiteKings : blackKings;

    // Sprawdź czy to była promocja
    bool wasPromotion = false;
    if (isKing && !move.isCapture()) {
        if (isWhite && move.to.row == 7 && move.from.row == 6) wasPromotion = true;
        if (!isWhite && move.to.row == 0 && move.from.row == 1) wasPromotion = true;
    }

    // Przesuń pionek z powrotem
    myKings &= ~toMask;
    myPieces &= ~toMask;

    if (wasPromotion) {
        // Był pionkiem przed ruchem
        myPieces |= squareToMask(move.from.row, move.from.col);
    } else if (isKing) {
        myKings |= squareToMask(move.from.row, move.from.col);
    } else {
        myPieces |= squareToMask(move.from.row, move.from.col);
    }

    // Przywróć zbite pionki
    for (const auto& cap : move.captures) {
        Bitboard capMask = squareToMask(cap.row, cap.col);
        // Zbity pionek był przeciwnikiem
        if (isWhite) {
            // Biały bił czarnego
            // Sprawdź czy to była damka (była na promotion row przed biciem?)
            // Uproszczenie: przywróć jako pionek
            blackPieces |= capMask;
        } else {
            whitePieces |= capMask;
        }
    }
}

} // namespace checkers

#include "engine.h"
#include <cassert>
#include <iostream>
#include <string>

using namespace checkers;

// Helper: znajdź ruch od-do
bool hasMove(const std::vector<Move>& moves, int fr, int fc, int tr, int tc) {
    for (auto& m : moves) {
        if (m.from.row == fr && m.from.col == fc && m.to.row == tr && m.to.col == tc) {
            return true;
        }
    }
    return false;
}

// Helper: znajdź bicie
bool hasCapture(const std::vector<Move>& moves, int fr, int fc, int tr, int tc, int cr, int cc) {
    for (auto& m : moves) {
        if (m.from.row == fr && m.from.col == fc && m.to.row == tr && m.to.col == tc) {
            for (auto& c : m.captures) {
                if (c.row == cr && c.col == cc) return true;
            }
        }
    }
    return false;
}

// Helper: policz ruchy
int countMoves(const std::vector<Move>& moves) {
    return moves.size();
}

void test_initial_position() {
    std::cout << "Test: pozycja startowa..." << std::flush;
    Engine e;
    auto moves = e.getLegalMoves(WHITE);

    // Biały ma 7 pionków na rzędzie 2, każdy ma 2 ruchy do przodu
    // Pionki na rzędzie 1 mają mniej (bo rząd 0 jest zajęty)
    // Na start: 7 ruchów (pionki na rzędzie 2 mogą iść na rząd 3)
    assert(moves.size() == 7);
    assert(!moves[0].isCapture());
    std::cout << " OK (7 ruchów)" << std::endl;
}

void test_simple_move() {
    std::cout << "Test: prosty ruch pionkiem..." << std::flush;
    Engine e;
    auto moves = e.getLegalMoves(WHITE);

    // Ruch (2,1) -> (3,0) lub (3,2)
    assert(hasMove(moves, 2, 1, 3, 0) || hasMove(moves, 2, 1, 3, 2));

    // Wykonaj ruch
    assert(e.makeMove(moves[0]));
    assert(e.getBoard().currentTurn == BLACK);
    std::cout << " OK" << std::endl;
}

void test_pawn_capture() {
    std::cout << "Test: bicie pionkiem..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(3, 3);
    b.blackPieces = squareToMask(4, 4);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Biały na (3,3), czarny na (4,4) — biały może bić na (5,5)
    assert(hasCapture(moves, 3, 3, 5, 5, 4, 4));
    std::cout << " OK" << std::endl;
}

void test_pawn_capture_backward() {
    std::cout << "Test: bicie pionkiem do tyłu..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(5, 5);
    b.blackPieces = squareToMask(4, 4);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Biały na (5,5), czarny na (4,4) — biały może bić do tyłu na (3,3)
    assert(hasCapture(moves, 5, 5, 3, 3, 4, 4));
    std::cout << " OK" << std::endl;
}

void test_capture_mandatory() {
    std::cout << "Test: bicie obowiązkowe..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(3, 3) | squareToMask(1, 1);
    b.blackPieces = squareToMask(4, 4);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Tylko bicia — zwykły ruch (1,1) nie jest dostępny
    for (auto& m : moves) {
        assert(m.isCapture());
    }
    assert(moves.size() > 0);
    std::cout << " OK" << std::endl;
}

void test_multi_capture() {
    std::cout << "Test: bicie wielokrotne..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(3, 3);
    b.blackPieces = squareToMask(4, 4) | squareToMask(6, 6);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Biały (3,3) bije (4,4) → (5,5), potem (6,6) → (7,7)
    bool foundMulti = false;
    for (auto& m : moves) {
        if (m.captures.size() == 2) {
            foundMulti = true;
            break;
        }
    }
    assert(foundMulti);
    std::cout << " OK" << std::endl;
}

void test_king_moves() {
    std::cout << "Test: ruchy damki..." << std::flush;

    Board b;
    b.whitePieces = 0;
    b.whiteKings = squareToMask(3, 3);
    b.blackPieces = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Damka na (3,3) — powinna mieć ruchy we wszystkich 4 kierunkach
    assert(moves.size() >= 4);

    // Sprawdź czy może iść daleko
    bool foundFar = false;
    for (auto& m : moves) {
        int dist = std::abs(m.to.row - m.from.row);
        if (dist > 1) { foundFar = true; break; }
    }
    assert(foundFar);
    std::cout << " OK (" << moves.size() << " ruchów)" << std::endl;
}

void test_promotion() {
    std::cout << "Test: promocja na damkę..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(6, 6);
    b.blackPieces = squareToMask(7, 7); // blokuje (7,7)
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;

    // Ruch (6,6) → (7,5) lub (7,7) — jeśli (7,5) to promocja
    auto moves = e.getLegalMoves(WHITE);
    bool foundPromotion = false;
    for (auto& m : moves) {
        if (m.to.row == 7) {
            e.makeMove(m);
            if (e.getBoard().whiteKings & squareToMask(7, m.to.col)) {
                foundPromotion = true;
            }
            break;
        }
    }
    assert(foundPromotion);
    std::cout << " OK" << std::endl;
}

void test_no_moves() {
    std::cout << "Test: brak ruchów (blokada)..." << std::flush;

    Board b;
    b.whitePieces = squareToMask(0, 1);
    b.blackPieces = squareToMask(1, 0) | squareToMask(1, 2);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = BLACK;

    Engine e;
    e.getBoard() = b;
    auto moves = e.getLegalMoves(BLACK);

    // Czarne na (1,0) i (1,2) — mogą iść do przodu na rząd 0
    // Ale (1,0) → (0,1) jest zajęte przez białego, (1,2) → (0,3) jest puste
    // Więc jest 1 ruch — test powinien sprawdzić coś innego
    // Lepiej: czarne na (1,0) i (1,2), białe blokują (0,1) i (0,3)
    b.blackPieces = squareToMask(1, 0) | squareToMask(1, 2);
    b.whitePieces = squareToMask(0, 1) | squareToMask(0, 3);
    b.currentTurn = BLACK;
    e.getBoard() = b;
    moves = e.getLegalMoves(BLACK);

    // Czarne na (1,0) i (1,2) zablokowane do przodu, ale mogą bić do tyłu
    // (1,0) bije białego na (0,1) → ląduje na (-1,2) — poza planszą
    // (1,2) bije białego na (0,3) → ląduje na (-1,4) — poza planszą
    // Więc brak ruchów
    assert(moves.size() == 0);
    std::cout << " OK" << std::endl;
}

void test_game_over() {
    std::cout << "Test: koniec gry..." << std::flush;

    // Biały pionek na (0,7) — róg planszy
    // Czarny na (1,6) blokuje jedyny kierunek do przodu
    // Bicie do tyłu: (0,7) → skok nad (1,6) → ląduje na (2,5) — to działa
    // Lepiej: biały na (1,0), czarny na (0,1) i (2,1) — zablokowany totalnie
    Board b;
    b.whitePieces = squareToMask(1, 0);
    b.blackPieces = squareToMask(0, 1) | squareToMask(2, 1);
    b.whiteKings = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;

    // Biały na (1,0):
    // Ruch do przodu: (0,1) — zajęte
    // Bicie do przodu: nad (0,1) → (-1,2) — poza planszą
    // Bicie do tyłu: nad (2,1) → (3,2) — to działa!
    // Więc nadal ma bicie. Trzeba zablokować lądowanie.
    b.blackPieces = squareToMask(0, 1) | squareToMask(2, 1) | squareToMask(3, 2);
    e.getBoard() = b;
    auto moves = e.getLegalMoves(WHITE);

    // Teraz: biały (1,0) bije (2,1) → ląduje (3,2) — zajęte!
    // Biały (1,0) bije (0,1) → ląduje (-1,2) — poza planszą
    // Brak ruchów
    assert(moves.size() == 0);
    assert(e.isGameOver());
    assert(e.getResult() == BLACK_WIN);
    std::cout << " OK" << std::endl;
}

int main() {
    std::cout << "=== Testy silnika warcab ===" << std::endl;

    test_initial_position();
    test_simple_move();
    test_pawn_capture();
    test_pawn_capture_backward();
    test_capture_mandatory();
    test_multi_capture();
    test_king_moves();
    test_promotion();
    test_no_moves();
    test_game_over();

    std::cout << "\n=== Wszystkie testy przeszły ===" << std::endl;
    return 0;
}

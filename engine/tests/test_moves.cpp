#include "engine.h"
#include <cassert>
#include <cmath>
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
            for (int i = 0; i < m.numCaptures; i++) {
                if (m.captures[i].row == cr && m.captures[i].col == cc) return true;
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
        if (m.numCaptures == 2) {
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

// === NOWE TESTY (edge cases, captures, promotion) ===

void test_edge_corners() {
    std::cout << "Test: pionki w rogach planszy..." << std::flush;

    // (0,0) to jasne pole — używamy (0,1) zamiast tego
    // (0,7), (7,0), (7,7) to ciemne pola

    // 1) Biały na (0,7) — może iść do przodu na (1,6)
    {
        Board b;
        b.whitePieces = squareToMask(0, 7);
        b.blackPieces = 0;
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(hasMove(moves, 0, 7, 1, 6));
        assert(countMoves(moves) == 1);
    }

    // 2) Biały na (0,7), czarny na (1,6) — bicie do (2,5)
    {
        Board b;
        b.whitePieces = squareToMask(0, 7);
        b.blackPieces = squareToMask(1, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(hasCapture(moves, 0, 7, 2, 5, 1, 6));
    }

    // 3) Czarny na (7,0) — może iść do przodu na (6,1)
    {
        Board b;
        b.whitePieces = 0;
        b.blackPieces = squareToMask(7, 0);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(BLACK);
        assert(hasMove(moves, 7, 0, 6, 1));
        assert(countMoves(moves) == 1);
    }

    // 4) Czarny na (7,7) — może iść do przodu na (6,6)
    {
        Board b;
        b.whitePieces = 0;
        b.blackPieces = squareToMask(7, 7);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(BLACK);
        assert(hasMove(moves, 7, 7, 6, 6));
        assert(countMoves(moves) == 1);
    }

    // 5) Biały na (0,1) — róg planszy (lewy górny dark square)
    {
        Board b;
        b.whitePieces = squareToMask(0, 1);
        b.blackPieces = 0;
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        // (0,1) → forward: (1,0) i (1,2) — oba ciemne, oba puste
        assert(countMoves(moves) == 2);
    }

    std::cout << " OK" << std::endl;
}

void test_multiple_captures_chain() {
    std::cout << "Test: bicie wielokrotne łańcuchowe (3+)..." << std::flush;

    // Łańcuch 1: prosta linia przekątna z promocją
    // Biały (1,1), czarni (2,2), (4,4), (6,6)
    // (1,1) bije (2,2)→(3,3), bije (4,4)→(5,5), bije (6,6)→(7,7) promocja
    {
        Board b;
        b.whitePieces = squareToMask(1, 1);
        b.blackPieces = squareToMask(2, 2) | squareToMask(4, 4) | squareToMask(6, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        bool foundChain3 = false;
        for (auto& m : moves) {
            if (m.from.row == 1 && m.from.col == 1 && m.numCaptures >= 3) {
                foundChain3 = true;
                break;
            }
        }
        assert(foundChain3);
    }

    // Łańcuch 2: "schodkowy" — zmiana kierunku
    // Biały (1,1), czarni (2,2), (4,0), (6,2)
    // (1,1) bije (2,2)→(3,3), bije (4,0)? — (3,3) direction (1,-1): mr=(4,2) pusty. Nope.
    // Lepiej: Biały (3,1), czarni (4,2), (6,0), (4,4)
    // (3,1) bije (4,2)→(5,3), bije (4,4)? — (5,3) direction (-1,1): mr=(4,4) black, nr=(3,5) empty.
    //   Tak! Capture (4,4)→(3,5). Z (3,5) direction (1,-1): mr=(4,4) zbity (pusty), mr=(4,4)...
    //   Hmm, (4,4) already captured. Direction (1,1): mr=(4,6) pusty.
    //   Potrzebuję więcej czarnych. Biały (3,1), czarni (4,2), (4,4), (2,4).
    //   (3,1) bije (4,2)→(5,3). Z (5,3) direction (-1,1): mr=(4,4) black, nr=(3,5) empty. Capture.
    //   Z (3,5) direction (-1,-1): mr=(2,4) black, nr=(1,3) empty. Capture! 3 captures!
    {
        Board b;
        b.whitePieces = squareToMask(3, 1);
        b.blackPieces = squareToMask(4, 2) | squareToMask(4, 4) | squareToMask(2, 4);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        bool foundChain3 = false;
        for (auto& m : moves) {
            if (m.from.row == 3 && m.from.col == 1 && m.numCaptures >= 3) {
                foundChain3 = true;
                break;
            }
        }
        assert(foundChain3);
    }

    std::cout << " OK" << std::endl;
}

void test_king_capture_distance() {
    std::cout << "Test: damka bije z odległości > 2..." << std::flush;

    // Biała damka na (0,0), czarny na (3,3), lądowanie (4,4) puste
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = squareToMask(3, 3);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Damka (0,0) bije (3,3) → ląduje na (4,4) (odległość 4 od startu)
        assert(hasCapture(moves, 0, 0, 4, 4, 3, 3));
    }

    // Damka na (2,0), czarny na (5,3), lądowanie (6,7)? 
    // (2,0) → kierunek (1,1): (3,1), (4,2), (5,3)=czarny, (6,4)=puste → ląduje na (6,4)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(2, 0);
        b.blackPieces = squareToMask(5, 3);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        assert(hasCapture(moves, 2, 0, 6, 4, 5, 3));
    }

    std::cout << " OK" << std::endl;
}

void test_king_blocked_by_own() {
    std::cout << "Test: damka zablokowana przez własnego pionka..." << std::flush;

    // Biała damka na (0,0), biały pionek na (1,1)
    // Damka nie może iść w kierunku (1,1) — własny pionek blokuje
    {
        Board b;
        b.whitePieces = squareToMask(1, 1);
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Damka z (0,0) w kierunku (1,1) — zablokowana na (1,1)
        // Powinna mieć ruchy w innych kierunkach: (1,-1)→poza planszą
        // Więc tylko ruchy w kierunku (1,1) są zablokowane, reszta nie istnieje (róg)
        // Sprawdź: NIE powinna mieć ruchu do (2,2) ani dalej
        for (auto& m : moves) {
            if (m.from.row == 0 && m.from.col == 0) {
                // Nie powinna iść w kierunku (1,1)
                assert(m.to.row != 1 || m.to.col != 1);
                assert(m.to.row != 2 || m.to.col != 2);
            }
        }
    }

    // Damka na (3,3), własny pionek na (4,4) — blokuje kierunek (1,1)
    // Damka nadal może iść w 3 inne kierunki
    {
        Board b;
        b.whitePieces = squareToMask(4, 4);
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Damka nie może iść na (4,4), (5,5) itd.
        bool foundBlockedDir = false;
        for (auto& m : moves) {
            if (m.from.row == 3 && m.from.col == 3) {
                assert(!(m.to.row > 3 && m.to.col > 3)); // nie w kierunku (4,4)
            }
        }
        // Ale może iść w innych kierunkach
        assert(countMoves(moves) > 0);
    }

    std::cout << " OK" << std::endl;
}

void test_no_capture_available() {
    std::cout << "Test: pozycja bez bicia..." << std::flush;

    // Biały na (4,3), czarny na (5,4) — sąsiadują, nie ma za nim pustego pola do lądowania
    // Bicie: biały (4,3) skacze nad (5,4) → ląduje na (6,5). Ale (6,5) jest puste — to JEST bicie!
    // Żeby NIE było bicia, czarny musi być na polu z którego nie można przeskoczyć
    // Albo za czarnym nie ma pustego pola
    {
        Board b;
        b.whitePieces = squareToMask(4, 3);
        b.blackPieces = squareToMask(5, 4) | squareToMask(6, 5); // blokuj lądowanie
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Brak bicia — (5,4) jest czarny, ale (6,5) jest zajęte — nie można wylądować
        // Zwykły ruch: (5,2) jest puste
        for (auto& m : moves) {
            assert(!m.isCapture());
        }
        assert(countMoves(moves) >= 1);
    }

    // Inna pozycja: odległe pionki, brak bicia
    {
        Board b;
        b.whitePieces = squareToMask(2, 1);
        b.blackPieces = squareToMask(5, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        for (auto& m : moves) {
            assert(!m.isCapture());
        }
    }

    std::cout << " OK" << std::endl;
}

void test_capture_backward_only() {
    std::cout << "Test: bicie tylko do tyłu..." << std::flush;

    // Biały na (5,5), czarny na (4,4) — bicie do tyłu na (3,3)
    // Forward: (6,4) i (6,6) — puste, ale bicie obowiązkowe
    {
        Board b;
        b.whitePieces = squareToMask(5, 5);
        b.blackPieces = squareToMask(4, 4);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Bicie obowiązkowe — nie ma zwykłych ruchów
        assert(countMoves(moves) == 1);
        assert(moves[0].isCapture());
        assert(hasCapture(moves, 5, 5, 3, 3, 4, 4));
    }

    std::cout << " OK" << std::endl;
}

void test_forced_capture_over_multiple() {
    std::cout << "Test: obowiązkowe bicie z kilku opcji..." << std::flush;

    // Dwa białe pionki mogą bić — oba powinny być w legal moves
    // Biały (2,1) bije (3,2) → (4,3)
    // Biały (5,5) bije (4,4) → (3,3)
    {
        Board b;
        b.whitePieces = squareToMask(2, 1) | squareToMask(5, 5);
        b.blackPieces = squareToMask(3, 2) | squareToMask(4, 4);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Wszystkie ruchy to bicia
        for (auto& m : moves) {
            assert(m.isCapture());
        }

        // Oba pionki mogą bić
        assert(hasCapture(moves, 2, 1, 4, 3, 3, 2));
        assert(hasCapture(moves, 5, 5, 3, 3, 4, 4));
        assert(countMoves(moves) >= 2);
    }

    std::cout << " OK" << std::endl;
}

void test_promotion_during_capture() {
    std::cout << "Test: promocja w trakcie bicia..." << std::flush;

    // Biały na (5,0), czarny na (6,1) — bicie na (7,2) z promocją
    // (5,0) direction (1,1): mr=(6,1) black, nr=(7,2) empty → capture + promotion
    {
        Board b;
        b.whitePieces = squareToMask(5, 0);
        b.blackPieces = squareToMask(6, 1);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Jest bicie (5,0) → (7,2) bijąc (6,1)
        assert(hasCapture(moves, 5, 0, 7, 2, 6, 1));

        // Wykonaj bicie i sprawdź promocję
        for (auto& m : moves) {
            if (m.from.row == 5 && m.from.col == 0 && m.to.row == 7 && m.to.col == 2) {
                assert(e.makeMove(m));
                // Na (7,2) powinna być biała damka
                assert(e.getBoard().whiteKings & squareToMask(7, 2));
                assert(!(e.getBoard().whitePieces & squareToMask(7, 2)));
                break;
            }
        }
    }

    std::cout << " OK" << std::endl;
}

void test_draw_detection() {
    std::cout << "Test: wykrywanie remisu (40 ruchów)..." << std::flush;

    // Setup: obaj gracze z damkami na środku, łatwo się poruszają
    // Białe damki: (3,3) i (4,2), Czarne damki: (3,5) i (4,6)
    // Wystarczająco dużo miejsca do manewrowania
    Board b;
    b.whitePieces = 0;
    b.whiteKings = squareToMask(3, 3) | squareToMask(4, 2);
    b.blackPieces = 0;
    b.blackKings = squareToMask(3, 5) | squareToMask(4, 6);
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;

    int halfMoves = 0;
    const int MAX_SIM = 200; // zabezpieczenie

    while (halfMoves < 50 && !e.isGameOver()) {
        auto moves = e.getLegalMoves();
        if (moves.empty()) break;

        // Wybierz pierwszy nie-bicie ruch (jeśli są bicia, wybierz je)
        // Ale chcemy uniknąć bicia żeby dojść do remisu
        bool moved = false;
        for (auto& m : moves) {
            if (!m.isCapture()) {
                bool ok = e.makeMove(m);
                assert(ok);
                halfMoves++;
                moved = true;
                if (halfMoves <= 5 || halfMoves % 10 == 0) {
                    std::cout << "\n  [DBG] halfMoves=" << halfMoves
                              << " counter=" << e.getMovesWithoutCapture()
                              << " isGameOver=" << e.isGameOver()
                              << " result=" << e.getResult()
                              << " move=(" << m.from.row << "," << m.from.col
                              << ")->(" << m.to.row << "," << m.to.col << ")" << std::endl;
                }
                break;
            }
        }
        if (!moved) {
            // Musimy bić
            assert(e.makeMove(moves[0]));
            halfMoves++;
        }
    }

    // Sprawdź czy doszło do remisu LUB gra się skończyła
    // (może dojść do wygranej zanim 40 ruchów — to OK)
    if (halfMoves >= 40) {
        assert(e.getResult() == DRAW);
    }
    // Jeśli gra skończyła się wcześniej — OK, test przechodzi

    std::cout << " OK (" << halfMoves << " pół-ruchów, wynik: "
              << (e.getResult() == DRAW ? "remis" : e.getResult() == WHITE_WIN ? "białe" :
                  e.getResult() == BLACK_WIN ? "czarne" : "trwa") << ")" << std::endl;
}

void test_empty_board() {
    std::cout << "Test: pusta plansza..." << std::flush;

    Board b;
    b.whitePieces = 0;
    b.whiteKings = 0;
    b.blackPieces = 0;
    b.blackKings = 0;
    b.currentTurn = WHITE;

    Engine e;
    e.getBoard() = b;

    auto movesW = e.getLegalMoves(WHITE);
    auto movesB = e.getLegalMoves(BLACK);
    assert(movesW.empty());
    assert(movesB.empty());
    assert(e.isGameOver());

    // Zmień turę na czarne
    b.currentTurn = BLACK;
    e.getBoard() = b;
    assert(e.isGameOver());

    std::cout << " OK" << std::endl;
}

void test_single_piece_each() {
    std::cout << "Test: po jednym pionku z każdej strony..." << std::flush;

    // Biały na (3,3), czarny na (4,4)
    {
        Board b;
        b.whitePieces = squareToMask(3, 3);
        b.blackPieces = squareToMask(4, 4);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Biały ma bicie (3,3)→(5,5) lub zwykłe ruchy (4,2)/(4,4 nie bo zajęte)
        // Bicie obowiązkowe — tylko (3,3)→(5,5)
        assert(countMoves(moves) >= 1);
    }

    // Biały na (2,1), czarny na (5,6) — daleko od siebie
    {
        Board b;
        b.whitePieces = squareToMask(2, 1);
        b.blackPieces = squareToMask(5, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Brak bicia — zwykłe ruchy
        assert(!moves.empty());
        for (auto& m : moves) {
            assert(!m.isCapture());
        }
    }

    std::cout << " OK" << std::endl;
}

void test_full_game_sequence() {
    std::cout << "Test: pełna sekwencja gry (20 ruchów)..." << std::flush;

    Engine e;
    e.reset();

    int totalMoves = 0;
    const int TARGET = 20;

    while (totalMoves < TARGET && !e.isGameOver()) {
        auto moves = e.getLegalMoves();
        if (moves.empty()) break;

        // Wykonaj pierwszy legalny ruch
        bool ok = e.makeMove(moves[0]);
        assert(ok); // Gra nie zacięła się
        totalMoves++;
    }

    assert(totalMoves > 0); // Przynajmniej jeden ruch się wykonał
    std::cout << " OK (" << totalMoves << " ruchów)" << std::endl;
}

// Test: gra się nie zacina na różnych losowych pozycjach
void test_no_stall_positions() {
    std::cout << "Test: gra się nie zacina na różnych pozycjach..." << std::flush;

    // Pozycja 1: późny middle game
    {
        Board b;
        b.whitePieces = squareToMask(2, 1) | squareToMask(3, 2) | squareToMask(4, 3) | squareToMask(2, 5);
        b.blackPieces = squareToMask(5, 0) | squareToMask(5, 2) | squareToMask(5, 4) | squareToMask(6, 5);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;

        for (int i = 0; i < 10 && !e.isGameOver(); i++) {
            auto moves = e.getLegalMoves();
            if (moves.empty()) break;
            assert(e.makeMove(moves[0]));
        }
    }

    // Pozycja 2: z damkami
    {
        Board b;
        b.whitePieces = squareToMask(1, 0) | squareToMask(2, 3);
        b.whiteKings = squareToMask(4, 5);
        b.blackPieces = squareToMask(6, 1) | squareToMask(5, 4);
        b.blackKings = squareToMask(2, 7);
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;

        for (int i = 0; i < 10 && !e.isGameOver(); i++) {
            auto moves = e.getLegalMoves();
            if (moves.empty()) break;
            assert(e.makeMove(moves[0]));
        }
    }

    // Pozycja 3: blisko końca gry
    {
        Board b;
        b.whitePieces = squareToMask(3, 3);
        b.whiteKings = squareToMask(5, 5);
        b.blackPieces = 0;
        b.blackKings = squareToMask(6, 2);
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;

        for (int i = 0; i < 10 && !e.isGameOver(); i++) {
            auto moves = e.getLegalMoves();
            if (moves.empty()) break;
            assert(e.makeMove(moves[0]));
        }
    }

    std::cout << " OK" << std::endl;
}

// Test: undoLastMove
void test_undo_move() {
    std::cout << "Test: cofanie ruchu..." << std::flush;

    Engine e;
    auto moves = e.getLegalMoves(WHITE);
    assert(!moves.empty());

    Board before = e.getBoard();
    assert(e.makeMove(moves[0]));
    assert(e.undoLastMove());

    Board after = e.getBoard();
    assert(before.whitePieces == after.whitePieces);
    assert(before.blackPieces == after.blackPieces);
    assert(before.currentTurn == after.currentTurn);

    std::cout << " OK" << std::endl;
}

// === Issue #135: King multi-capture undo restores captured pieces' king status ===
void test_issue135_king_multi_capture_undo() {
    std::cout << "Test: Issue #135 — king multi-capture undo restores king status..." << std::flush;

    // Setup: white king on (0,0), two black pieces including a king on (2,2) and pawn on (5,5)
    // White king captures (2,2) -> (3,3), then (5,5) -> (6,6)
    // After undo, black king on (2,2) should still be a king
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = squareToMask(5, 5);  // regular pawn
        b.blackKings = squareToMask(2, 2);   // enemy king
        b.currentTurn = WHITE;

        Board before = b; // snapshot

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        // Find the multi-capture move
        Move* multiCap = nullptr;
        for (auto& m : moves) {
            if (m.numCaptures >= 2) {
                multiCap = &m;
                break;
            }
        }
        assert(multiCap != nullptr);

        bool ok = e.makeMove(*multiCap);
        assert(ok);
        assert(e.undoLastMove());

        Board after = e.getBoard();

        // Verify exact board state restoration
        assert(before.whitePieces == after.whitePieces);
        assert(before.whiteKings == after.whiteKings);
        assert(before.blackPieces == after.blackPieces);
        assert(before.blackKings == after.blackKings);
        assert(before.currentTurn == after.currentTurn);

        // Specifically: black king at (2,2) must be restored as a king, not a pawn
        assert(after.getPiece(2, 2) == KING);
        assert(after.getColor(2, 2) == BLACK);
        // Black pawn at (5,5) must be restored as a pawn
        assert(after.getPiece(5, 5) == PAWN);
        assert(after.getColor(5, 5) == BLACK);
    }

    // Variant: king captures two enemy kings
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = 0;
        b.blackKings = squareToMask(2, 2) | squareToMask(5, 5);
        b.currentTurn = WHITE;

        Board before = b;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        Move* multiCap = nullptr;
        for (auto& m : moves) {
            if (m.numCaptures >= 2) {
                multiCap = &m;
                break;
            }
        }
        assert(multiCap != nullptr);

        assert(e.makeMove(*multiCap));
        assert(e.undoLastMove());

        Board after = e.getBoard();
        assert(before.whitePieces == after.whitePieces);
        assert(before.whiteKings == after.whiteKings);
        assert(before.blackPieces == after.blackPieces);
        assert(before.blackKings == after.blackKings);

        // Both enemy kings restored as kings
        assert(after.getPiece(2, 2) == KING);
        assert(after.getColor(2, 2) == BLACK);
        assert(after.getPiece(5, 5) == KING);
        assert(after.getColor(5, 5) == BLACK);
    }

    // Variant: king captures pawn + king, undo, verify king not demoted
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(1, 1);
        b.blackPieces = squareToMask(2, 2);   // pawn (captured first)
        b.blackKings = squareToMask(4, 4);    // king (captured second)
        b.currentTurn = WHITE;

        Board before = b;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        Move* multiCap = nullptr;
        for (auto& m : moves) {
            if (m.numCaptures >= 2) {
                multiCap = &m;
                break;
            }
        }
        assert(multiCap != nullptr);

        assert(e.makeMove(*multiCap));
        assert(e.undoLastMove());

        Board after = e.getBoard();
        assert(before.whitePieces == after.whitePieces);
        assert(before.whiteKings == after.whiteKings);
        assert(before.blackPieces == after.blackPieces);
        assert(before.blackKings == after.blackKings);

        // Pawn at (2,2) stays a pawn, king at (4,4) stays a king
        assert(after.getPiece(2, 2) == PAWN);
        assert(after.getColor(2, 2) == BLACK);
        assert(after.getPiece(4, 4) == KING);
        assert(after.getColor(4, 4) == BLACK);
    }

    std::cout << " OK" << std::endl;
}

// === Issue #136: King non-capture moves have proper path/numPath for animation ===
void test_issue136_king_move_path() {
    std::cout << "Test: Issue #136 — king non-capture moves have path/numPath..." << std::flush;

    // Helper: verify a king move's path is consistent
    // - path[0] == from
    // - path[numPath-1] == to
    // - numPath >= 2
    // - all intermediate squares are on the diagonal between from and to
    auto verifyPath = [](const Move& m) {
        assert(m.numPath >= 2);
        assert(m.path[0].row == m.from.row && m.path[0].col == m.from.col);
        assert(m.path[m.numPath - 1].row == m.to.row && m.path[m.numPath - 1].col == m.to.col);
        // Verify all path entries are in-bounds
        for (int i = 0; i < m.numPath; i++) {
            assert(Board::inBounds(m.path[i].row, m.path[i].col));
        }
        // Verify consecutive path entries are adjacent diagonals
        for (int i = 1; i < m.numPath; i++) {
            int dr = m.path[i].row - m.path[i-1].row;
            int dc = m.path[i].col - m.path[i-1].col;
            assert(std::abs(dr) == 1 && std::abs(dc) == 1);
        }
    };

    // White king at (3,3), open board
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 3, 3, WHITE);
        assert(!moves.empty());

        bool foundSingle = false, foundMulti = false;
        for (auto& m : moves) {
            verifyPath(m);
            if (m.numPath == 2) foundSingle = true;
            if (m.numPath > 2) foundMulti = true;
        }
        assert(foundSingle && foundMulti); // open board should have both
    }

    // Black king at (5,5) — same check
    {
        Board b;
        b.whitePieces = 0;
        b.blackKings = squareToMask(5, 5);
        b.blackPieces = 0;
        b.whiteKings = 0;
        b.currentTurn = BLACK;

        auto moves = MoveGenerator::generateKingMoves(b, 5, 5, BLACK);
        assert(!moves.empty());

        for (auto& m : moves) {
            verifyPath(m);
            assert(m.path[0].row == 5 && m.path[0].col == 5);
        }
    }

    // King at edge (0,7) — limited moves, all single-step
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 7);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 0, 7, WHITE);
        assert(!moves.empty());

        for (auto& m : moves) {
            verifyPath(m);
            assert(m.path[0].row == 0 && m.path[0].col == 7);
        }
    }

    // King blocked partially — ensure moves that DO exist have valid path
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = squareToMask(4, 4); // blocks NE direction
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 3, 3, WHITE);
        assert(!moves.empty());

        for (auto& m : moves) {
            verifyPath(m);
            assert(m.path[0].row == 3 && m.path[0].col == 3);
            // Should not land on (4,4) or beyond in NE direction
            assert(!(m.to.row >= 4 && m.to.col >= 4));
        }
    }

    // Via Engine::getLegalMoves (full path through generateAll)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(!moves.empty());

        for (auto& m : moves) {
            verifyPath(m);
            assert(m.path[0].row == 3 && m.path[0].col == 3);
            assert(m.path[m.numPath - 1].row == m.to.row);
            assert(m.path[m.numPath - 1].col == m.to.col);
        }
    }

    std::cout << " OK" << std::endl;
}

// === Regression: King move path/numPath comprehensive tests ===

void test_king_move_path_single_step() {
    std::cout << "Test: king move path — single-step (numPath=2)..." << std::flush;

    // King at (3,3), piece at (4,4) blocking — only 1-step moves in SE direction
    // Other directions have multi-step moves, but we verify the single-step ones
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = squareToMask(4, 4); // blocks beyond (4,4)
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 3, 3, WHITE);
        assert(!moves.empty());

        // Every move from (3,3) on this board has numPath >= 2
        // The 1-step move toward (4,4) doesn't exist (blocked)
        // But 1-step moves in other directions exist
        for (auto& m : moves) {
            assert(m.numPath >= 2);
            assert(m.path[0].row == 3 && m.path[0].col == 3);
            assert(m.path[m.numPath - 1].row == m.to.row);
            assert(m.path[m.numPath - 1].col == m.to.col);

            // If numPath == 2, it's a single step
            if (m.numPath == 2) {
                int dr = std::abs(m.to.row - 3);
                int dc = std::abs(m.to.col - 3);
                assert(dr == 1 && dc == 1); // exactly 1 diagonal step
            }
        }
    }

    // King at (0,1) — only 2 directions available, short range
    // All moves from corner are multi-step at most, verify single-step ones
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 1);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 0, 1, WHITE);
        assert(!moves.empty());

        // Find the adjacent (1-step) move
        bool foundAdj = false;
        for (auto& m : moves) {
            if (m.numPath == 2) {
                int dr = std::abs(m.to.row - 0);
                int dc = std::abs(m.to.col - 1);
                assert(dr == 1 && dc == 1);
                foundAdj = true;
            }
        }
        assert(foundAdj);
    }

    // Via getLegalMoves — king at (5,5), blocked at (6,6)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(5, 5);
        b.blackPieces = squareToMask(6, 6);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(!moves.empty());

        for (auto& m : moves) {
            assert(m.numPath >= 2);
            assert(m.path[0].row == 5 && m.path[0].col == 5);
        }
    }

    std::cout << " OK" << std::endl;
}

void test_king_move_path_multi_step() {
    std::cout << "Test: king move path — multi-step (numPath>2, intermediate squares)..." << std::flush;

    // King at (0,0), open board — can slide SE: (1,1),(2,2)...(7,7)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 0, 0, WHITE);
        assert(!moves.empty());

        // SE direction moves: (1,1), (2,2), ..., (7,7)
        // Move to (3,3) should have numPath=4, path=[(0,0),(1,1),(2,2),(3,3)]
        bool found33 = false;
        for (auto& m : moves) {
            if (m.to.row == 3 && m.to.col == 3) {
                assert(m.numPath == 4);
                assert(m.path[0].row == 0 && m.path[0].col == 0);
                assert(m.path[1].row == 1 && m.path[1].col == 1);
                assert(m.path[2].row == 2 && m.path[2].col == 2);
                assert(m.path[3].row == 3 && m.path[3].col == 3);
                found33 = true;
            }
        }
        assert(found33);

        // Move to (7,7) should have numPath=8
        bool found77 = false;
        for (auto& m : moves) {
            if (m.to.row == 7 && m.to.col == 7) {
                assert(m.numPath == 8);
                for (int i = 0; i < 8; i++) {
                    assert(m.path[i].row == i && m.path[i].col == i);
                }
                found77 = true;
            }
        }
        assert(found77);
    }

    // King at (3,3), open board — verify multi-step in each direction
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, 3, 3, WHITE);
        // SE: (4,4),(5,5),(6,6),(7,7) — 4 moves
        // NE: (2,4),(1,5),(0,6) — 3 moves
        // SW: (4,2),(5,1),(6,0) — 3 moves
        // NW: (2,2),(1,1),(0,0) — 3 moves
        // Total: 13 moves
        assert(moves.size() == 13);

        // Verify multi-step moves have correct intermediate squares
        // Move to (5,5): numPath=3, path=[(3,3),(4,4),(5,5)]
        for (auto& m : moves) {
            if (m.to.row == 5 && m.to.col == 5) {
                assert(m.numPath == 3);
                assert(m.path[0].row == 3 && m.path[0].col == 3);
                assert(m.path[1].row == 4 && m.path[1].col == 4);
                assert(m.path[2].row == 5 && m.path[2].col == 5);
            }
            // Move to (0,0): numPath=4, path=[(3,3),(2,2),(1,1),(0,0)]
            if (m.to.row == 0 && m.to.col == 0) {
                assert(m.numPath == 4);
                assert(m.path[0].row == 3 && m.path[0].col == 3);
                assert(m.path[1].row == 2 && m.path[1].col == 2);
                assert(m.path[2].row == 1 && m.path[2].col == 1);
                assert(m.path[3].row == 0 && m.path[3].col == 0);
            }
        }
    }

    // Via getLegalMoves — same position through full pipeline
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(!moves.empty());

        // Verify multi-step path through engine
        for (auto& m : moves) {
            if (m.to.row == 5 && m.to.col == 5) {
                assert(m.numPath == 6); // (0,0),(1,1),(2,2),(3,3),(4,4),(5,5)
                for (int i = 0; i < 6; i++) {
                    assert(m.path[i].row == i && m.path[i].col == i);
                }
            }
        }
    }

    // Black king multi-step
    {
        Board b;
        b.whitePieces = 0;
        b.blackKings = squareToMask(7, 7);
        b.blackPieces = 0;
        b.whiteKings = 0;
        b.currentTurn = BLACK;

        auto moves = MoveGenerator::generateKingMoves(b, 7, 7, BLACK);
        assert(!moves.empty());

        // NW direction: (6,6),(5,5),...,(0,0)
        for (auto& m : moves) {
            if (m.to.row == 4 && m.to.col == 4) {
                assert(m.numPath == 4);
                assert(m.path[0].row == 7 && m.path[0].col == 7);
                assert(m.path[1].row == 6 && m.path[1].col == 6);
                assert(m.path[2].row == 5 && m.path[2].col == 5);
                assert(m.path[3].row == 4 && m.path[3].col == 4);
            }
        }
    }

    std::cout << " OK" << std::endl;
}

void test_king_capture_path() {
    std::cout << "Test: king capture path — proper path with intermediate squares..." << std::flush;

    // Helper: verify capture path consistency
    auto verifyCapturePath = [](const Move& m) {
        assert(m.isCapture());
        assert(m.numPath >= 2);
        assert(m.path[0].row == m.from.row && m.path[0].col == m.from.col);
        assert(m.path[m.numPath - 1].row == m.to.row && m.path[m.numPath - 1].col == m.to.col);
        // All path entries in-bounds
        for (int i = 0; i < m.numPath; i++) {
            assert(Board::inBounds(m.path[i].row, m.path[i].col));
        }
        // All consecutive path entries are on the same diagonal (same |dr| == |dc|)
        // but NOT necessarily adjacent — king can slide multiple squares between captures
        for (int i = 1; i < m.numPath; i++) {
            int dr = m.path[i].row - m.path[i-1].row;
            int dc = m.path[i].col - m.path[i-1].col;
            assert(std::abs(dr) == std::abs(dc)); // same diagonal
            assert(dr != 0 && dc != 0); // not horizontal/vertical
        }
    };

    // Single king capture: king at (3,3), enemy at (4,4), landing at (5,5)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = squareToMask(4, 4);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(!moves.empty());

        bool found = false;
        for (auto& m : moves) {
            if (m.isCapture() && m.to.row == 5 && m.to.col == 5) {
                verifyCapturePath(m);
                assert(m.numCaptures == 1);
                assert(m.captures[0].row == 4 && m.captures[0].col == 4);
                assert(m.numPath == 2); // single capture: [from, to]
                found = true;
            }
        }
        assert(found);
    }

    // King capture from distance: king at (0,0), enemy at (3,3), landing at (4,4)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(0, 0);
        b.blackPieces = squareToMask(3, 3);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        assert(!moves.empty());

        // King can land at any square beyond (3,3) in SE direction
        bool found44 = false;
        for (auto& m : moves) {
            if (m.isCapture() && m.captures[0].row == 3 && m.captures[0].col == 3) {
                verifyCapturePath(m);
                assert(m.to.row >= 4 && m.to.col >= 4); // must be beyond captured piece
                assert(m.to.row == m.to.col); // still on diagonal
                if (m.to.row == 4 && m.to.col == 4) found44 = true;
            }
        }
        assert(found44);
    }

    // Multi-capture path: king at (1,1), enemies at (2,2) and (4,4)
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(1, 1);
        b.blackPieces = squareToMask(2, 2) | squareToMask(4, 4);
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        bool foundMulti = false;
        for (auto& m : moves) {
            if (m.numCaptures >= 2) {
                verifyCapturePath(m);
                assert(m.numPath == m.numCaptures + 1); // captures + 1 landing positions
                assert(m.numPath > 2); // multi-capture has numPath > 2
                foundMulti = true;
            }
        }
        assert(foundMulti);
    }

    // King captures enemy king — path still correct
    {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(3, 3);
        b.blackPieces = 0;
        b.blackKings = squareToMask(4, 4);
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);

        bool found = false;
        for (auto& m : moves) {
            if (m.isCapture() && m.to.row == 5 && m.to.col == 5) {
                verifyCapturePath(m);
                assert(m.capturedKing(0) == true);
                found = true;
            }
        }
        assert(found);
    }

    std::cout << " OK" << std::endl;
}

void test_king_move_path_consistency() {
    std::cout << "Test: king move path — consistency checks across positions..." << std::flush;

    // Verify that for every move: path[numPath-1] == to, path[0] == from
    // across multiple board positions
    auto verifyAllMoves = [](const std::vector<Move>& moves, int fr, int fc) {
        for (auto& m : moves) {
            assert(m.path[0].row == fr && m.path[0].col == fc);
            assert(m.path[m.numPath - 1].row == m.to.row);
            assert(m.path[m.numPath - 1].col == m.to.col);
            assert(m.numPath >= 2);
        }
    };

    // Multiple positions
    int positions[][2] = {{0,0}, {0,7}, {7,0}, {7,7}, {3,3}, {4,4}, {1,1}, {6,6}};
    for (auto& pos : positions) {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(pos[0], pos[1]);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        auto moves = MoveGenerator::generateKingMoves(b, pos[0], pos[1], WHITE);
        verifyAllMoves(moves, pos[0], pos[1]);
    }

    // Via Engine::getLegalMoves for various positions
    for (auto& pos : positions) {
        Board b;
        b.whitePieces = 0;
        b.whiteKings = squareToMask(pos[0], pos[1]);
        b.blackPieces = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        auto moves = e.getLegalMoves(WHITE);
        verifyAllMoves(moves, pos[0], pos[1]);
    }

    std::cout << " OK" << std::endl;
}

void test_draw_vs_win() {
    std::cout << "Test: draw vs win — białe wygrywają != remis..." << std::flush;

    // Pozycja: biały pionek, czarny zablokowany i bez ruchów
    // Białe wygrywają — getResult() musi zwrócić WHITE_WIN, nie DRAW
    {
        Board b;
        b.whitePieces = squareToMask(3, 3);
        b.blackPieces = squareToMask(1, 0); // czarny zablokowany — nie ma ruchów
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;
        // Czarny (1,0): do przodu (0,1) puste, więc ma ruch — trzeba zablokować
        // Lepiej: czarny (1,2), białe (0,1) i (0,3) — zablokowany do przodu
        // A bicie do tyłu: (1,2) bije nad (0,1)? — (0,1) to kierunek (-1,-1) — ląduje (-1,0) — poza planszą
        // (1,2) bije nad (0,3)? — ląduje (-1,4) — poza planszą
        b.blackPieces = squareToMask(1, 2);
        b.whitePieces = squareToMask(0, 1) | squareToMask(0, 3);
        b.currentTurn = BLACK;
        e.getBoard() = b;

        assert(e.getLegalMoves(BLACK).empty());
        assert(e.isGameOver());
        GameResult result = e.getResult();
        assert(result == WHITE_WIN);
        assert(result != DRAW);
    }

    // Pozycja: czarne nie mają pionków (zbite) → białe wygrywają
    {
        Board b;
        b.whitePieces = squareToMask(2, 1) | squareToMask(3, 4);
        b.blackPieces = 0; // brak czarnych
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = BLACK;

        Engine e;
        e.getBoard() = b;

        assert(e.getLegalMoves(BLACK).empty());
        assert(e.isGameOver());
        GameResult result = e.getResult();
        assert(result == WHITE_WIN);
        assert(result != DRAW);
    }

    // Pozycja: czarne wygrywają (białe zablokowane)
    {
        Board b;
        b.whitePieces = squareToMask(6, 5);
        b.blackPieces = squareToMask(7, 4) | squareToMask(7, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;
        // Biały (6,5): do przodu (7,4) zajęte, (7,6) zajęte
        // Bicie do przodu: nad (7,4)→(8,3) poza planszą, nad (7,6)→(8,7) poza planszą
        // Brak ruchów → czarne wygrywają
        assert(e.getLegalMoves(WHITE).empty());
        assert(e.isGameOver());
        GameResult result = e.getResult();
        assert(result == BLACK_WIN);
        assert(result != DRAW);
    }

    // Pozycja: gra trwa — nie ma wygranego ani remisu
    {
        Board b;
        b.whitePieces = squareToMask(2, 1);
        b.blackPieces = squareToMask(5, 6);
        b.whiteKings = 0;
        b.blackKings = 0;
        b.currentTurn = WHITE;

        Engine e;
        e.getBoard() = b;

        assert(!e.getLegalMoves(WHITE).empty());
        assert(!e.isGameOver());
        assert(e.getResult() == ONGOING);
    }

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
    test_draw_vs_win();

    std::cout << "\n--- Nowe testy ---\n" << std::endl;

    test_edge_corners();
    test_multiple_captures_chain();
    test_king_capture_distance();
    test_king_blocked_by_own();
    test_no_capture_available();
    test_capture_backward_only();
    test_forced_capture_over_multiple();
    test_promotion_during_capture();
    test_draw_detection();
    test_empty_board();
    test_single_piece_each();
    test_full_game_sequence();
    test_no_stall_positions();
    test_undo_move();

    std::cout << "\n--- Regression tests (issues #135, #136) ---\n" << std::endl;

    test_issue135_king_multi_capture_undo();
    test_issue136_king_move_path();

    std::cout << "\n--- King move path regression tests ---\n" << std::endl;

    test_king_move_path_single_step();
    test_king_move_path_multi_step();
    test_king_capture_path();
    test_king_move_path_consistency();

    std::cout << "\n=== Wszystkie testy przeszły ===" << std::endl;
    return 0;
}

#pragma once
#include "board.h"
#include "movegen.h"

namespace checkers {

// Wynik gry
enum GameResult { ONGOING, WHITE_WIN, BLACK_WIN, DRAW };

class Engine {
public:
    Engine();

    // Reset planszy
    void reset();

    // Pobierz aktualny stan
    const Board& getBoard() const;
    Board& getBoard();

    // Pobierz dostępne ruchy
    std::vector<Move> getLegalMoves() const;
    std::vector<Move> getLegalMoves(Color color) const;

    // Wykonaj ruch
    bool makeMove(Move& move);

    // Sprawdź czy ruch jest legalny
    bool isLegal(const Move& move) const;

    // Sprawdź wynik gry
    GameResult getResult() const;

    // Czy gra się skończyła
    bool isGameOver() const;

    // Historia ruchów
    const std::vector<Move>& getHistory() const;

    // Cofnij ostatni ruch
    bool undoLastMove();

private:
    Board board_;
    std::vector<Move> history_;
};

} // namespace checkers

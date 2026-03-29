#pragma once
#include "board.h"
#include "movegen.h"
#include "minimax.h"

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

    // Wykonaj ruch (sprawdza legalność)
    bool makeMove(Move& move);

    // Wykonaj ruch BEZ sprawdzania legalności (używać tylko po weryfikacji)
    void makeMoveUnchecked(Move& move);

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

    // Debug: get moves without capture counter
    int getMovesWithoutCapture() const { return movesWithoutCapture_; }

    // Get best move using minimax search
    MinimaxResult getBestMove(Color turn, int depth = 4);

private:
    Board board_;
    std::vector<Move> history_;
    int movesWithoutCapture_ = 0; // O(1) draw detection (#31)
};

} // namespace checkers

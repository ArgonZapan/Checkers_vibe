#pragma once
#include "board.h"
#include <vector>

namespace checkers {

class MoveGenerator {
public:
    // Generuj wszystkie legalne ruchy dla danego koloru
    static std::vector<Move> generateAll(const Board& board, Color color);

    // Generuj tylko bicia (obowiązkowe)
    static std::vector<Move> generateCaptures(const Board& board, Color color);

    // Sprawdź czy gracz ma dostępne ruchy
    static bool hasMoves(const Board& board, Color color);

    // Sprawdź czy gracz ma dostępny ruch (szybkie — zatrzymuje się po pierwszym)
    static bool hasAnyMove(const Board& board, Color color);

    // Kierunki ruchu (publiczne dla helpera)
    static constexpr int WHITE_DIRS[2][2] = {{1, -1}, {1, 1}};
    static constexpr int BLACK_DIRS[2][2] = {{-1, -1}, {-1, 1}};
    static constexpr int ALL_DIRS[4][2] = {{1, -1}, {1, 1}, {-1, -1}, {-1, 1}};

    // Generuj ruchy (publiczne dla testów)
    static std::vector<Move> generatePawnMoves(const Board& board, int row, int col, Color color);
    static std::vector<Move> generateKingMoves(const Board& board, int row, int col, Color color);
    static std::vector<Move> generatePawnCaptures(Board& board, int row, int col, Color color);
    static std::vector<Move> generateKingCaptures(Board& board, int row, int col, Color color);
};

} // namespace checkers

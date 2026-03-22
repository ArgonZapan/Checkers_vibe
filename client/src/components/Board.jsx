import React from 'react';

const CELL_SIZE = 60;
const BOARD_SIZE = CELL_SIZE * 8;

const LIGHT_COLOR = '#deb887';
const DARK_COLOR = '#8b4513';
const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 0.3)';
const SELECTED_COLOR = 'rgba(0, 255, 0, 0.35)';
const VALID_MOVE_COLOR = 'rgba(0, 200, 0, 0.25)';

export default function Board({
  board,
  turn,
  onCellClick,
  legalMoves = [],
  selected,
  lastMove,
  gameOver,
  winner,
}) {
  const cells = [];
  const pieces = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;
      const isDark = (row + col) % 2 === 1;
      const isSelected = selected && selected[0] === row && selected[1] === col;
      const isLastMoveFrom = lastMove && lastMove.from[0] === row && lastMove.from[1] === col;
      const isLastMoveTo = lastMove && lastMove.to[0] === row && lastMove.to[1] === col;
      const isValidMove = legalMoves.some((m) => m.to[0] === row && m.to[1] === col);

      let fillColor = isDark ? DARK_COLOR : LIGHT_COLOR;
      let overlay = null;

      if (isLastMoveFrom || isLastMoveTo) {
        overlay = HIGHLIGHT_COLOR;
      }
      if (isSelected) {
        overlay = SELECTED_COLOR;
      }
      if (isValidMove && !board[row][col]) {
        overlay = VALID_MOVE_COLOR;
      }

      cells.push(
        <rect
          key={`cell-${row}-${col}`}
          x={x}
          y={y}
          width={CELL_SIZE}
          height={CELL_SIZE}
          fill={fillColor}
          onClick={() => onCellClick(row, col)}
          style={{ cursor: isDark ? 'pointer' : 'default' }}
        />
      );

      if (overlay) {
        cells.push(
          <rect
            key={`overlay-${row}-${col}`}
            x={x}
            y={y}
            width={CELL_SIZE}
            height={CELL_SIZE}
            fill={overlay}
            pointerEvents="none"
          />
        );
      }

      const piece = board[row][col];
      if (piece) {
        const cx = x + CELL_SIZE / 2;
        const cy = y + CELL_SIZE / 2;
        const radius = CELL_SIZE * 0.38;
        const isWhite = piece.color === 'white';

        pieces.push(
          <g key={`piece-${row}-${col}`} onClick={() => onCellClick(row, col)} style={{ cursor: 'pointer' }}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill={isWhite ? '#f0f0f0' : '#2a2a2a'}
              stroke={isWhite ? '#999' : '#555'}
              strokeWidth="2"
            />
            {piece.king && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="20"
                fill={isWhite ? '#333' : '#ddd'}
                pointerEvents="none"
              >
                👑
              </text>
            )}
            {isValidMove && (
              <circle
                cx={cx}
                cy={cy}
                r={radius + 3}
                fill="none"
                stroke="#00ff00"
                strokeWidth="3"
                pointerEvents="none"
              />
            )}
          </g>
        );
      }
    }
  }

  return (
    <div className="board-container" style={{ opacity: gameOver ? 0.7 : 1 }}>
      <svg
        className="board-svg"
        width={BOARD_SIZE}
        height={BOARD_SIZE}
        viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      >
        {cells}
        {pieces}
        {gameOver && (
          <text
            x={BOARD_SIZE / 2}
            y={BOARD_SIZE / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="28"
            fontWeight="bold"
            fill={winner === 'draw' ? '#f39c12' : '#e94560'}
            stroke="#000"
            strokeWidth="1"
            paintOrder="stroke"
          >
            {winner === 'draw' ? 'REMIS' : `${winner === 'white' ? 'BIAŁE' : 'CZARNE'} WYGRYWA!`}
          </text>
        )}
      </svg>
    </div>
  );
}

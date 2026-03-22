import React, { useState, useRef } from 'react';

const CELL_SIZE = 60;
const BOARD_SIZE = CELL_SIZE * 8;

const LIGHT_COLOR = '#deb887';
const DARK_COLOR = '#8b4513';
const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 0.3)';
const SELECTED_COLOR = 'rgba(0, 255, 0, 0.35)';
const VALID_MOVE_COLOR = 'rgba(0, 200, 0, 0.45)';
const VALID_MOVE_DOT_COLOR = 'rgba(0, 160, 0, 0.7)';

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
  const prevBoardRef = useRef(null);
  const animationRef = useRef({ offsets: {}, from: {} });
  const animFlagRef = useRef(false);
  const [, forceUpdate] = useState(0);

  // Detect moved pieces and set animation offsets
  const prev = prevBoardRef.current;
  const anim = animationRef.current;
  if (prev && !animFlagRef.current) {
    let hasAnim = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cur = board[r][c];
        if (cur) {
          // Check if this piece was in a different position before
          let foundOld = false;
          for (let pr = 0; pr < 8; pr++) {
            for (let pc = 0; pc < 8; pc++) {
              const old = prev[pr][pc];
              if (old && cur.color === old.color && cur.king === old.king && (pr !== r || pc !== c)) {
                // Piece moved from (pr,pc) to (r,c)
                anim.offsets[`piece-${r}-${c}`] = {
                  x: (pc - c) * CELL_SIZE,
                  y: (pr - r) * CELL_SIZE,
                };
                hasAnim = true;
                foundOld = true;
                break;
              }
            }
            if (foundOld) break;
          }
        }
      }
    }
    if (hasAnim) {
      anim.from = { ...anim.offsets };
      animFlagRef.current = true;
      // On next frame, clear animation (CSS transition animates from offset to 0)
      requestAnimationFrame(() => {
        anim.from = {};
        animFlagRef.current = false;
        forceUpdate((n) => n + 1);
      });
    }
  }
  prevBoardRef.current = board.map((row) => [...row]);

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
          pointerEvents="visible"
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

      // Green dot for valid empty target cells
      if (isValidMove && !board[row][col]) {
        cells.push(
          <circle
            key={`valid-dot-${row}-${col}`}
            cx={x + CELL_SIZE / 2}
            cy={y + CELL_SIZE / 2}
            r={CELL_SIZE * 0.18}
            fill={VALID_MOVE_DOT_COLOR}
            pointerEvents="none"
          />
        );
      }

      const piece = board[row][col];
      if (piece) {
        const px = x + CELL_SIZE / 2;
        const py = y + CELL_SIZE / 2;
        const radius = CELL_SIZE * 0.38;
        const isWhite = piece.color === 'white';
        const pieceKey = `piece-${row}-${col}`;
        const animOffset = anim.from[pieceKey];
        const pieceStyle = {
          cursor: 'pointer',
          ...(animOffset
            ? {
                transform: `translate(${animOffset.x}px, ${animOffset.y}px)`,
                transition: 'none',
              }
            : {
                transform: 'translate(0, 0)',
                transition: 'transform 100ms ease-in-out',
              }),
        };

        pieces.push(
          <g key={pieceKey} onClick={() => onCellClick(row, col)} style={pieceStyle}>
            <circle
              cx={px}
              cy={py}
              r={radius}
              fill={isWhite ? '#f0f0f0' : '#2a2a2a'}
              stroke={isWhite ? '#999' : '#555'}
              strokeWidth="2"
              pointerEvents="visible"
            />
            {piece.king && (
              <text
                x={px}
                y={py}
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
                cx={px}
                cy={py}
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

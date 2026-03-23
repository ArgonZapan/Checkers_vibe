import React, { useState, useRef, useEffect, useMemo } from 'react';
import { BOARD_CONFIG } from '../../boardConfig.js';
const CONFIG = { board: BOARD_CONFIG };

const CELL_SIZE = CONFIG.board.cellSize;
const BOARD_SIZE = CELL_SIZE * 8;
const STEP_DURATION_MS = CONFIG.board.animation.stepDurationMs;

const LIGHT_COLOR = CONFIG.board.colors.light;
const DARK_COLOR = CONFIG.board.colors.dark;
const HIGHLIGHT_COLOR = CONFIG.board.colors.highlight;
const SELECTED_COLOR = CONFIG.board.colors.selected;
const VALID_MOVE_COLOR = CONFIG.board.colors.validMove;
const VALID_MOVE_DOT_COLOR = CONFIG.board.colors.validDot;

function Board({
  board,
  turn,
  onCellClick,
  legalMoves = [],
  selected,
  lastMove,
  gameOver,
  winner,
  path,
  captures = [],
  onReset,
}) {
  const prevBoardRef = useRef(null);
  const animPrevBoardRef = useRef(null); // stable copy for multi-capture animation
  const animOffsetsRef = useRef({});
  const animFromRef = useRef({});
  const animFlagRef = useRef(false);
  const rafIdRef = useRef(null);
  const [, forceUpdate] = useState(0);

  // Multi-capture step animation state
  const [animStep, setAnimStep] = useState(-1);
  const [animBoard, setAnimBoard] = useState(null);
  const prevPathRef = useRef(null);
  const timersRef = useRef([]);

  // Detect multi-capture path and animate step by step
  useEffect(() => {
    // Clear any pending timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!path || path.length <= 2) {
      setAnimStep(-1);
      setAnimBoard(null);
      prevPathRef.current = path;
      return;
    }

    // Prevent re-triggering on same path
    const pathKey = JSON.stringify(path);
    if (JSON.stringify(prevPathRef.current) === pathKey) return;
    prevPathRef.current = path;

    const prevBoard = animPrevBoardRef.current;
    if (!prevBoard) return;

    const startR = path[0][0], startC = path[0][1];
    const movingPiece = prevBoard[startR]?.[startC];
    if (!movingPiece) return;

    // Build base board: prev board minus the moving piece, minus captured pieces
    const baseBoard = prevBoard.map(row => row.map(cell => cell ? { ...cell } : null));
    baseBoard[startR][startC] = null;

    // Determine captured positions: squares between consecutive path steps
    // that contain opponent pieces in the prev board
    const capturedPositions = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [r1, c1] = path[i];
      const [r2, c2] = path[i + 1];
      // Check cells between r1,c1 and r2,c2 for captured pieces
      const dr = Math.sign(r2 - r1);
      const dc = Math.sign(c2 - c1);
      let r = r1 + dr, c = c1 + dc;
      while (r !== r2 || c !== c2) {
        if (prevBoard[r]?.[c] && prevBoard[r][c].color !== movingPiece.color) {
          capturedPositions.push([r, c]);
          // Remove captured piece from base board
          baseBoard[r][c] = null;
        }
        r += dr;
        c += dc;
      }
    }

    // Set step 0: piece at start position, base board without captures
    setAnimStep(0);
    setAnimBoard(baseBoard);

    // Schedule each step
    for (let i = 1; i < path.length; i++) {
      const timer = setTimeout(() => {
        setAnimStep(i);
        // After last step, clear animation state so final board shows
        if (i === path.length - 1) {
          const clearTimer = setTimeout(() => {
            setAnimStep(-1);
            setAnimBoard(null);
          }, STEP_DURATION_MS);
          timersRef.current.push(clearTimer);
        }
      }, i * STEP_DURATION_MS);
      timersRef.current.push(timer);
    }

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [path]);

  // Detect moved pieces and animate — effect handles all side effects (#FBUG-004)
  useEffect(() => {
    const prev = prevBoardRef.current;

    // First render — no animation, just save state
    if (!prev) {
      prevBoardRef.current = board.map((row) => [...row]);
      return;
    }

    // Cancel any in-flight animation
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      animFlagRef.current = false;
    }

    // Skip animation during multi-capture or if already animating
    if (animFlagRef.current || animStep >= 0) {
      prevBoardRef.current = board.map((row) => [...row]);
      return;
    }

    // Only animate if board actually changed
    const boardChanged = prev.some((row, r) => row.some((cell, c) => {
      const old = prev[r][c];
      const cur = board[r][c];
      if (!old && !cur) return false;
      if (!old || !cur) return true;
      return old.color !== cur.color || old.king !== cur.king;
    }));

    // Save old board for multi-capture animation reference (deep copy)
    animPrevBoardRef.current = prev.map(row => row.map(cell => cell ? { ...cell } : null));

    if (!boardChanged) {
      prevBoardRef.current = board.map((row) => [...row]);
      return;
    }

    // Find empty cells (pieces left or were captured) and new pieces
    const empties = [];
    const newPieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const old = prev[r][c];
        const cur = board[r][c];
        if (old && !cur) {
          empties.push({ r, c, color: old.color, king: old.king });
        } else if (!old && cur) {
          newPieces.push({ r, c, color: cur.color, king: cur.king });
        }
      }
    }

    // Match new pieces with empties of the same type — that's a move
    const animOffsets = {};
    for (const np of newPieces) {
      for (let i = 0; i < empties.length; i++) {
        const e = empties[i];
        if (e.color === np.color && e.king === np.king) {
          // Piece moves FROM empty pos (e) TO new pos (np)
          // Offset = direction from new pos toward old pos (initial offset before animation)
          animOffsets[`piece-${np.r}-${np.c}`] = {
            x: (e.c - np.c) * CELL_SIZE,
            y: (e.r - np.r) * CELL_SIZE,
          };
          empties.splice(i, 1);
          break;
        }
      }
    }

    // Update prevBoardRef AFTER using prev for animation
    prevBoardRef.current = board.map((row) => [...row]);

    if (Object.keys(animOffsets).length > 0) {
      animFromRef.current = { ...animOffsets };
      animFlagRef.current = true;
      const startTime = performance.now();
      const duration = STEP_DURATION_MS;
      const startOffsets = { ...animOffsets };
      function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = 1 - (1 - t) * (1 - t);
        const current = {};
        for (const key in startOffsets) {
          current[key] = {
            x: startOffsets[key].x * (1 - ease),
            y: startOffsets[key].y * (1 - ease),
          };
        }
        animFromRef.current = current;
        forceUpdate((n) => n + 1);
        if (t < 1) {
          rafIdRef.current = requestAnimationFrame(animate);
        } else {
          animFromRef.current = {};
          animFlagRef.current = false;
        }
      }
      rafIdRef.current = requestAnimationFrame(animate);
    }

    // Cleanup: cancel pending RAF on unmount or next board change
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [board, animStep]);

  // Memoize cells + pieces to avoid re-computing SVG elements when nothing changed (#52)
  const { cells, pieces } = useMemo(() => {
    const _cells = [];
    const _pieces = [];

    // Determine board to display: animBoard during multi-capture, normal board otherwise
    const displayBoard = (animStep >= 0 && animBoard) ? animBoard : board;

    // Build Set for O(1) valid-move lookup instead of 64*len comparisons per render (#35)
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        const isDark = (row + col) % 2 === 1;
        const isSelected = selected && selected[0] === row && selected[1] === col;
        const isLastMoveFrom = lastMove && lastMove.from[0] === row && lastMove.from[1] === col;
        const isLastMoveTo = lastMove && lastMove.to[0] === row && lastMove.to[1] === col;
        const isValidMove = validTargets.has(`${row},${col}`);
        const cellPiece = displayBoard[row][col];
        const cellLabel = `${String.fromCharCode(97 + col)}${8 - row}${cellPiece ? `, ${cellPiece.color === 'white' ? 'biały' : 'czarny'}${cellPiece.king ? ' król' : ' pionek'}` : ''}`;

        let fillColor = isDark ? DARK_COLOR : LIGHT_COLOR;
        let overlay = null;

        if (isLastMoveFrom || isLastMoveTo) {
          overlay = HIGHLIGHT_COLOR;
        }
        if (isSelected) {
          overlay = SELECTED_COLOR;
        }
        if (isValidMove && !displayBoard[row][col]) {
          overlay = VALID_MOVE_COLOR;
        }

        _cells.push(
          <rect
            key={`cell-${row}-${col}`}
            x={x}
            y={y}
            width={CELL_SIZE}
            height={CELL_SIZE}
            fill={fillColor}
            onClick={() => onCellClick(row, col)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick(row, col); } }}
            style={{ cursor: isDark ? 'pointer' : 'default' }}
            tabIndex={isDark ? 0 : undefined}
            role={isDark ? 'button' : undefined}
            aria-label={cellLabel}
            pointerEvents="visible"
          />
        );

        if (overlay) {
          _cells.push(
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
        if (isValidMove && !displayBoard[row][col]) {
          _cells.push(
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

        const piece = displayBoard[row][col];
        if (piece) {
          const px = x + CELL_SIZE / 2;
          const py = y + CELL_SIZE / 2;
          const radius = CELL_SIZE * 0.38;
          const isWhite = piece.color === 'white';
          const pieceKey = `piece-${row}-${col}`;
          const animOffset = animFromRef.current[pieceKey];
          // SVG attribute transform (consistent across viewport sizes)
          const pieceTransform = animOffset
            ? `translate(${animOffset.x}, ${animOffset.y})`
            : undefined;

          _pieces.push(
            <g key={pieceKey} className="piece" onClick={() => onCellClick(row, col)} transform={pieceTransform} style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`${isWhite ? 'White' : 'Black'}${piece.king ? ' king' : ' piece'} at ${String.fromCharCode(97 + col)}${8 - row}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick(row, col); } }}>
              <circle
                cx={px}
                cy={py}
                r={radius}
                fill={isWhite ? CONFIG.board.colors.white : CONFIG.board.colors.black}
                stroke={isWhite ? CONFIG.board.colors.whiteStroke : CONFIG.board.colors.blackStroke}
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
                  fill={isWhite ? CONFIG.board.colors.kingWhite : CONFIG.board.colors.kingBlack}
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
    return { cells: _cells, pieces: _pieces };
  }, [board, selected, legalMoves, lastMove, animStep, animBoard, onCellClick]);

  // Moving piece info for multi-capture animation overlay
  const movingPieceInfo = (animStep >= 0 && animBoard && path && animStep < path.length) ? (() => {
    const prevBoard = animPrevBoardRef.current;
    if (!prevBoard) return null;
    const mp = prevBoard[path[0][0]]?.[path[0][1]];
    if (!mp) return null;
    return { piece: mp, row: path[animStep][0], col: path[animStep][1] };
  })() : null;

  return (
    <div className="board-container" style={{ position: 'relative' }}>
      <svg
        className="board-svg"
        width={BOARD_SIZE}
        height={BOARD_SIZE}
        viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
        role="img"
        aria-label={`Checkers board, ${turn}'s turn${gameOver ? ', game over' : ''}`}
      >
        {cells}
        {pieces}
        {/* Animated moving piece during multi-capture */}
        {movingPieceInfo && (() => {
          const { piece, row, col } = movingPieceInfo;
          const px = col * CELL_SIZE + CELL_SIZE / 2;
          const py = row * CELL_SIZE + CELL_SIZE / 2;
          const radius = CELL_SIZE * 0.38;
          const isWhite = piece.color === 'white';
          return (
            <g key="multi-cap-piece" pointerEvents="none">
              <circle
                cx={px}
                cy={py}
                r={radius}
                fill={isWhite ? CONFIG.board.colors.white : CONFIG.board.colors.black}
                stroke={isWhite ? CONFIG.board.colors.whiteStroke : CONFIG.board.colors.blackStroke}
                strokeWidth="2"
              />
              {piece.king && (
                <text
                  x={px}
                  y={py}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="20"
                  fill={isWhite ? CONFIG.board.colors.kingWhite : CONFIG.board.colors.kingBlack}
                >
                  👑
                </text>
              )}
            </g>
          );
        })()}
      </svg>
      {gameOver && (
        <div
          className="game-over-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Game over"
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              const overlay = e.currentTarget;
              const focusable = overlay.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
              } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
              }
            }
          }}
        >
          <div className="game-over-text">
            <h2 className={winner === 'draw' ? 'winner-draw-text' : winner === 'white' ? 'winner-white-text' : 'winner-black-text'}>
              {winner === 'draw' ? '🤝 Remis' : winner === 'white' ? '⚪ Białe wygrywają!' : '⚫ Czarne wygrywają!'}
            </h2>
            <button className="btn-primary" onClick={onReset} style={{ marginTop: '1rem' }} autoFocus>
              🔄 Nowa gra
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Shallow-compare props to skip unnecessary re-renders (#52)
function areEqual(prevProps, nextProps) {
  if (prevProps.gameOver !== nextProps.gameOver) return false;
  if (prevProps.winner !== nextProps.winner) return false;
  if (prevProps.turn !== nextProps.turn) return false;
  if (prevProps.selected?.[0] !== nextProps.selected?.[0] || prevProps.selected?.[1] !== nextProps.selected?.[1]) return false;
  if (prevProps.board !== nextProps.board) return false;
  if (prevProps.legalMoves !== nextProps.legalMoves) return false;
  if (prevProps.lastMove !== nextProps.lastMove) return false;
  if (prevProps.path !== nextProps.path) return false;
  if (prevProps.captures?.length !== nextProps.captures?.length) return false;
  if (prevProps.onCellClick !== nextProps.onCellClick) return false;
  if (prevProps.onReset !== nextProps.onReset) return false;
  return true;
}

export default React.memo(Board, areEqual);

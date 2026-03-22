import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import Board from './components/Board';
import GameControls from './components/GameControls';
import Dashboard from './components/Dashboard';
import ParamsPanel from './components/ParamsPanel';

const EMPTY_BOARD = () => {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { color: 'black', king: false };
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { color: 'white', king: false };
    }
  }
  return b;
};

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState('menu');
  const [board, setBoard] = useState(EMPTY_BOARD());
  const [turn, setTurn] = useState('white');
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [selected, setSelected] = useState(null);
  const [gameNumber, setGameNumber] = useState(0);

  const [params, setParams] = useState({
    whiteEpsilon: 0.1,
    blackEpsilon: 0.1,
    whiteNetworkSize: 'medium',
    blackNetworkSize: 'medium',
  });

  const [stats, setStats] = useState({ games: 0, whiteWins: 0, blackWins: 0, draws: 0 });
  const [lossHistory, setLossHistory] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [selfPlayActive, setSelfPlayActive] = useState(false);

  const socketRef = useRef(null);

  // Refs for stable callback access (avoid recreating handleCellClick on every state change)
  const boardRef = useRef(board);
  const turnRef = useRef(turn);
  const selectedRef = useRef(selected);
  const legalMovesRef = useRef(legalMoves);
  const modeRef = useRef(mode);
  const gameOverRef = useRef(gameOver);

  useEffect(() => {
    boardRef.current = board;
    turnRef.current = turn;
    selectedRef.current = selected;
    legalMovesRef.current = legalMoves;
    modeRef.current = mode;
    gameOverRef.current = gameOver;
  });

  useEffect(() => {
    const s = io('/', { transports: ['websocket', 'polling'] });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('state', (data) => {
      if (data.board) setBoard(data.board);
      if (data.turn) setTurn(data.turn);
      if (data.gameOver !== undefined) setGameOver(data.gameOver);
      if (data.winner !== undefined) setWinner(data.winner);
      if (data.lastMove) setLastMove(data.lastMove);
      // Note: do NOT set legalMoves from state — only from getLegalMoves event
      // State includes ALL legal moves for current turn, not per-piece filtered moves
    });

    // Legal moves for a specific piece (from getLegalMoves request)
    s.on('legalMoves', (data) => {
      if (data.moves) setLegalMoves(data.moves);
    });

    s.on('gameOver', (data) => {
      setGameOver(true);
      setWinner(data.winner);
      // Stats are updated via selfPlayStatus event (server is source of truth)
      setGameHistory((prev) => [
        { winner: data.winner, moves: data.moves || 0 },
        ...prev,
      ].slice(0, 10));
    });

    s.on('loss', (data) => {
      setLossHistory((prev) => {
        if (prev.length >= 100) {
          return [...prev.slice(1), data.loss];
        }
        return [...prev, data.loss];
      });
    });

    s.on('selfPlayStatus', (data) => {
      setSelfPlayActive(data.active);
      if (data.gameNumber !== undefined) setGameNumber(data.gameNumber);
      if (data.stats) {
        setStats({
          games: data.stats.gamesPlayed ?? 0,
          whiteWins: data.stats.whiteWins ?? 0,
          blackWins: data.stats.blackWins ?? 0,
          draws: data.stats.draws ?? 0,
        });
      }
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const handleStartPvai = useCallback(() => {
    setMode('pvai');
    setBoard(EMPTY_BOARD());
    setTurn('white');
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setSelected(null);
    setLegalMoves([]);
    socketRef.current?.emit('startGame', { mode: 'pvai' });
  }, []);

  const handleStartAivai = useCallback(() => {
    setMode('aivai');
    setBoard(EMPTY_BOARD());
    setTurn('white');
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setSelected(null);
    setLegalMoves([]);
    socketRef.current?.emit('startGame', { mode: 'aivai' });
  }, []);

  const handleReset = useCallback(() => {
    setMode('menu');
    setBoard(EMPTY_BOARD());
    setTurn('white');
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setSelected(null);
    setLegalMoves([]);
    socketRef.current?.emit('reset');
  }, []);

  const handleMove = useCallback((from, to) => {
    if (gameOverRef.current) return;
    socketRef.current?.emit('move', { from, to });
    setSelected(null);
    setLegalMoves([]);
  }, []);

  const handleCellClick = useCallback((row, col) => {
    if (gameOverRef.current) return;
    if (modeRef.current === 'aivai') return;

    const board = boardRef.current;
    const piece = board[row][col];

    // If a piece is selected, check if clicking on a valid move target
    if (selectedRef.current) {
      const legalMoves = legalMovesRef.current;
      const isLegal = legalMoves.some(
        (m) => m.to[0] === row && m.to[1] === col
      );
      if (isLegal) {
        handleMove(selectedRef.current, [row, col]);
        return;
      }
    }

    // In PvAI, human controls white pieces — allow selecting white pieces
    // regardless of current turn (to handle race conditions with AI)
    const isHumanPiece = modeRef.current === 'pvai'
      ? piece && piece.color === 'white'
      : piece && piece.color === turnRef.current;

    if (isHumanPiece) {
      setSelected([row, col]);
      socketRef.current?.emit('getLegalMoves', { from: [row, col] });
    } else {
      setSelected(null);
      setLegalMoves([]);
    }
  }, [handleMove]);

  const handleParamsChange = useCallback((newParams) => {
    setParams((prev) => ({ ...prev, ...newParams }));
    socketRef.current?.emit('params', newParams);
  }, []);

  const handleRestart = useCallback((which) => {
    socketRef.current?.emit('restart', { which });
  }, []);

  const handleToggleSelfplay = useCallback(() => {
    if (selfPlayActive) {
      socketRef.current?.emit('stopSelfPlay');
    } else {
      socketRef.current?.emit('startSelfPlay');
    }
  }, [selfPlayActive]);

  if (mode === 'menu') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>♟ Checkers AI</h1>
        </header>
        <div className="menu">
          <h2>Wybierz tryb gry</h2>
          <div className="menu-buttons">
            <button className="btn-primary" onClick={handleStartPvai} style={{ fontSize: '1.2rem', padding: '1rem 2rem' }}>
              🎮 Gracz vs AI
            </button>
            <button className="btn-secondary" onClick={handleStartAivai} style={{ fontSize: '1.2rem', padding: '1rem 2rem' }}>
              🤖 AI vs AI
            </button>
          </div>
          <p style={{ color: 'var(--text-dim)', marginTop: '1rem' }}>
            {connected ? '🟢 Połączono z serwerem' : '🔴 Brak połączenia'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>♟ Checkers AI</h1>
      </header>
      <div className="game-layout">
        <div className="game-main">
          <Board
            board={board}
            turn={turn}
            onCellClick={handleCellClick}
            legalMoves={legalMoves}
            selected={selected}
            lastMove={lastMove}
            gameOver={gameOver}
            winner={winner}
          />
          <GameControls
            mode={mode}
            turn={turn}
            gameOver={gameOver}
            winner={winner}
            onStartPvai={handleStartPvai}
            onStartAivai={handleStartAivai}
            onReset={handleReset}
          />
        </div>
        <div className="game-side">
          {mode === 'aivai' && (
            <Dashboard
              stats={stats}
              lossHistory={lossHistory}
              gameHistory={gameHistory}
              currentGame={gameNumber}
              active={selfPlayActive}
            />
          )}
          <ParamsPanel
            params={params}
            onParamsChange={handleParamsChange}
            onRestart={handleRestart}
            active={selfPlayActive}
            onToggleSelfplay={handleToggleSelfplay}
          />
        </div>
      </div>
    </div>
  );
}

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
  const [movePath, setMovePath] = useState(null);
  const [speed, setSpeed] = useState(0); // AI move delay in ms
  const [moveHistory, setMoveHistory] = useState([]);

  const handleSpeed = (ms) => {
    setSpeed(ms);
    if (socketRef.current) {
      socketRef.current.emit('setSpeed', ms);
    }
  };

  const [params, setParams] = useState({
    whiteEpsilon: 0.1,
    blackEpsilon: 0.1,
    whiteNetworkSize: 'medium',
    blackNetworkSize: 'medium',
  });

  const DEFAULT_MODEL_PARAMS = {
    layers: 3,
    neurons: 128,
    activation: 'relu',
    lr: 0.001,
    batchSize: 64,
    dropout: 0,
  };

  const [modelParams, setModelParams] = useState({ ...DEFAULT_MODEL_PARAMS });
  const [toast, setToast] = useState(null);

  const [stats, setStats] = useState({ games: 0, whiteWins: 0, blackWins: 0, draws: 0 });
  const [lossHistory, setLossHistory] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [selfPlayActive, setSelfPlayActive] = useState(false);
  const [avgTime, setAvgTime] = useState(0);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [lastRoundTime, setLastRoundTime] = useState(0);

  const socketRef = useRef(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

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
    const s = io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      setReconnectAttempts(0);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('reconnect_attempt', (attempt) => {
      setReconnectAttempts(attempt);
    });
    s.on('reconnect', () => {
      setConnected(true);
      setReconnectAttempts(0);
      // Re-subscribe to state on reconnect
      if (modeRef.current === 'aivai') {
        s.emit('startGame', { mode: 'aivai' });
      }
    });

    s.on('state', (data) => {
      // Ignore state events from self-play when in a player game mode
      if (data.source === 'selfPlay' && (modeRef.current === 'pvai' || modeRef.current === 'pvp')) return;
      if (data.board) setBoard(data.board);
      if (data.turn) setTurn(data.turn);
      if (data.gameOver !== undefined) setGameOver(data.gameOver);
      if (data.winner !== undefined) setWinner(data.winner);
      if (data.lastMove) {
        setLastMove(data.lastMove);
        // Record move in history
        const from = data.lastMove.from;
        const to = data.lastMove.to;
        const isCapture = data.lastMove.captures && data.lastMove.captures.length > 0;
        setMoveHistory((prev) => {
          const next = [...prev, {
            turn: data.turn === 'white' ? 'black' : 'white', // the move was made by the previous turn
            from: `${String.fromCharCode(97 + from[1])}${8 - from[0]}`,
            to: `${String.fromCharCode(97 + to[1])}${8 - to[0]}`,
            capture: isCapture,
          }];
          return next.slice(-40); // keep last 40 moves
        });
      }
      if (data.path && data.path.length > 2) {
        setMovePath(data.path);
      }
      else setMovePath(null);
      // Note: do NOT set legalMoves from state — only from getLegalMoves event
      // State includes ALL legal moves for current turn, not per-piece filtered moves
    });

    // Legal moves for a specific piece (from getLegalMoves request)
    s.on('legalMoves', (data) => {
      if (data.moves) setLegalMoves(data.moves);
    });

    s.on('gameOver', (data) => {
      // Ignore gameOver events from self-play when in a player game mode
      if (data.source === 'selfPlay' && (modeRef.current === 'pvai' || modeRef.current === 'pvp')) return;
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
        if (prev.length >= 1000) {
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
      if (data.avgTime !== undefined) setAvgTime(data.avgTime);
      if (data.totalTimeMs !== undefined) setTotalTimeMs(data.totalTimeMs);
      if (data.roundTimes !== undefined && data.roundTimes.length > 0) {
        setLastRoundTime(data.roundTimes[data.roundTimes.length - 1]);
      }
    });

    s.on('paramsUpdate', (data) => {
      if (data.modelParams) {
        setModelParams(data.modelParams);
      }
      if (data.whiteEpsilon !== undefined || data.blackEpsilon !== undefined) {
        setParams(prev => ({
          ...prev,
          ...(data.whiteEpsilon !== undefined && { whiteEpsilon: data.whiteEpsilon }),
          ...(data.blackEpsilon !== undefined && { blackEpsilon: data.blackEpsilon }),
        }));
      }
    });

    // Server-side error messages (invalid moves, rejected params, etc.)
    s.on('error', (data) => {
      console.warn('[Server error]', data?.message || data);
      setToast(data?.message || 'Błąd serwera');
      setTimeout(() => setToast(null), 5000);
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
    setMovePath(null);
    setMoveHistory([]);
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
    setMovePath(null);
    setMoveHistory([]);
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
    setMovePath(null);
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
    socketRef.current?.emit('setParams', newParams);
  }, []);

  // Toast helper
  const showToast = useCallback((msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  // Sliders only update local state — no socket emit
  const handleModelParamsChange = useCallback((newModelParams) => {
    setModelParams((prev) => ({ ...prev, ...newModelParams }));
  }, []);

  // "Zastosuj zmiany" — emit to server, reset model
  const handleApplyModelParams = useCallback(() => {
    socketRef.current?.emit('setParams', { ...modelParams });
    showToast('✅ Model zresetowany, szkolenie od nowa');
  }, [modelParams, showToast]);

  // "Resetuj domyślne" — restore max defaults
  const handleResetModelParams = useCallback(() => {
    setModelParams({ ...DEFAULT_MODEL_PARAMS });
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
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button onClick={() => handleSpeed(0)} className={speed === 0 ? 'btn-primary' : 'btn-secondary'}>⚡ Błyskawica</button>
            <button onClick={() => handleSpeed(100)} className={speed === 100 ? 'btn-primary' : 'btn-secondary'}>🏃 Szybko</button>
            <button onClick={() => handleSpeed(350)} className={speed === 350 ? 'btn-primary' : 'btn-secondary'}>🐢 Wolno</button>
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
            path={movePath}
            captures={lastMove?.captures}
          />
          <GameControls
            mode={mode}
            turn={turn}
            gameOver={gameOver}
            winner={winner}
            onStartPvai={handleStartPvai}
            onStartAivai={handleStartAivai}
            onReset={handleReset}
            speed={speed}
            onSpeed={handleSpeed}
          />
        </div>
        <div className="game-side">
          {moveHistory.length > 0 && (
            <div className="move-history">
              <h3>📜 Historia ruchów</h3>
              <ul className="move-list">
                {moveHistory.map((m, i) => (
                  <li key={i}>
                    <span className="move-number">{Math.floor(i / 2) + 1}{i % 2 === 0 ? '.' : '...'}</span>
                    <span className={m.turn === 'white' ? 'move-white' : 'move-black'}>
                      {m.capture ? '⚔️' : ''} {m.from}-{m.to}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === 'aivai' && (
            <Dashboard
              stats={stats}
              lossHistory={lossHistory}
              gameHistory={gameHistory}
              currentGame={gameNumber}
              active={selfPlayActive}
              avgTime={avgTime}
              totalTimeMs={totalTimeMs}
              lastRoundTime={lastRoundTime}
              whiteEpsilon={params.whiteEpsilon}
              blackEpsilon={params.blackEpsilon}
              connected={connected}
            />
          )}
          <ParamsPanel
            params={params}
            onParamsChange={handleParamsChange}
            onRestart={handleRestart}
            active={selfPlayActive}
            onToggleSelfplay={handleToggleSelfplay}
            modelParams={modelParams}
            onModelParamsChange={handleModelParamsChange}
            onApplyModelParams={handleApplyModelParams}
            onResetModelParams={handleResetModelParams}
          />
          {toast && (
            <div className="toast-notification">{toast}</div>
          )}
        </div>
      </div>
    </div>
  );
}

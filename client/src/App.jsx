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
      if ((r + c) % 2 === 1) b[r][c] = { color: 'white', king: false };
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { color: 'black', king: false };
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
    if (modeRef.current !== 'aivai') {
      showToast('⚠️ Prędkość dostępna tylko w trybie AI vs AI');
      return;
    }
    setSpeed(ms);
    if (socketRef.current) {
      socketRef.current.emit('setSpeed', ms);
    }
  };

  const [params, setParams] = useState({
    whiteEpsilon: 0.3,
    blackEpsilon: 0.3,
    whiteNetworkSize: 'medium',
    blackNetworkSize: 'medium',
    speedMode: 'normal',
    aiMoveDelayMs: 500,
    whiteStrategy: 'aggressor',
    blackStrategy: 'fortress',
    _config: {},
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
  const toastTimerRef = useRef(null);
  const pendingModelParamsToast = useRef(null); // BUG-V3-002: delayed success toast for setParams

  // Cleanup toast timers on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (pendingModelParamsToast.current) clearTimeout(pendingModelParamsToast.current);
    };
  }, []);

  const [stats, setStats] = useState({ games: 0, whiteWins: 0, blackWins: 0, draws: 0 });
  const [lossHistory, setLossHistory] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [selfPlayActive, setSelfPlayActive] = useState(false);
  const selfPlayActiveRef = useRef(false);
  const [avgTime, setAvgTime] = useState(0);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [lastRoundTime, setLastRoundTime] = useState(0);

  const socketRef = useRef(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const connectedRef = useRef(false);

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
    selfPlayActiveRef.current = selfPlayActive;
  }, [board, turn, selected, legalMoves, mode, gameOver]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

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
      // Don't re-emit startGame — server preserves game state across reconnects.
      // Player will see current board state from next state event.
    });

    s.on('state', (data) => {
      // Ignore state events from self-play when in a player game mode
      if (data.source === 'selfPlay' && (modeRef.current === 'pvai' || modeRef.current === 'pvp')) return;
      if (data.board) setBoard(data.board);
      if (data.turn) setTurn(data.turn);
      // When game ends in draw, server sends turn=null — still update turn to avoid stale state
      else if (data.gameOver && data.winner === 'draw') setTurn('draw');
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
      selfPlayActiveRef.current = data.active;
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
      if (data.whiteEpsilon !== undefined || data.blackEpsilon !== undefined
        || data.whiteNetworkSize !== undefined || data.blackNetworkSize !== undefined) {
        setParams(prev => ({
          ...prev,
          ...(data.whiteEpsilon !== undefined && { whiteEpsilon: data.whiteEpsilon }),
          ...(data.blackEpsilon !== undefined && { blackEpsilon: data.blackEpsilon }),
          ...(data.whiteNetworkSize !== undefined && { whiteNetworkSize: data.whiteNetworkSize }),
          ...(data.blackNetworkSize !== undefined && { blackNetworkSize: data.blackNetworkSize }),
        }));
      }
      if (data.speedMode !== undefined) {
        setParams(prev => ({ ...prev, speedMode: data.speedMode }));
      }
      if (data.aiMoveDelayMs !== undefined) {
        setParams(prev => ({ ...prev, aiMoveDelayMs: data.aiMoveDelayMs }));
      }
      if (data._config) {
        setParams(prev => ({ ...prev, _config: data._config }));
      }
      if (data.whiteStrategy !== undefined || data.blackStrategy !== undefined) {
        setParams(prev => ({
          ...prev,
          ...(data.whiteStrategy !== undefined && { whiteStrategy: data.whiteStrategy }),
          ...(data.blackStrategy !== undefined && { blackStrategy: data.blackStrategy }),
        }));
      }
    });

    // Server-side error messages (invalid moves, rejected params, etc.)
    s.on('error', (data) => {
      console.warn('[Server error]', data?.message || data);
      // Clear stale selection — valid-move highlights are misleading after error
      setSelected(null);
      setLegalMoves([]);
      // BUG-V3: Revert optimistic self-play toggle if error is self-play related
      const msg = (data?.message || '').toLowerCase();
      if (msg.includes('self-play') || msg.includes('selfplay')) {
        selfPlayActiveRef.current = false;
        setSelfPlayActive(false);
      }
      // BUG-V3-002: Cancel pending success toast if server rejects
      if (pendingModelParamsToast.current) {
        clearTimeout(pendingModelParamsToast.current);
        pendingModelParamsToast.current = null;
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ message: data?.message || 'Błąd serwera', type: 'error' });
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    });

    // Speed update broadcast — sync speed display across tabs/clients
    s.on('speedUpdate', (data) => {
      if (data.aiMoveDelayMs !== undefined) {
        setSpeed(data.aiMoveDelayMs);
      }
      if (data.speedMode !== undefined) {
        setParams(prev => ({ ...prev, speedMode: data.speedMode }));
      }
    });

    // Model restart — clear client state after full reset
    s.on('modelRestart', () => {
      setBoard(EMPTY_BOARD());
      setTurn('white');
      setGameOver(false);
      setWinner(null);
      setLastMove(null);
      setSelected(null);
      setLegalMoves([]);
      setMoveHistory([]);
    });

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
    setGameHistory([]);
    setSelfPlayActive(false); // Clear stale self-play state
    setLastRoundTime(0);
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
    setGameHistory([]);
    setLastRoundTime(0);
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
    setMoveHistory([]);
    setLastRoundTime(0);
    socketRef.current?.emit('reset');
  }, []);

  const handleMove = useCallback((from, to, captures) => {
    if (gameOverRef.current) return;
    socketRef.current?.emit('move', { from, to, captures });
    setSelected(null);
    setLegalMoves([]);
  }, []);

  const handleCellClick = useCallback((row, col) => {
    if (gameOverRef.current) return;
    if (modeRef.current === 'aivai') return;

    // Don't accept clicks when disconnected — moves silently fail
    if (!connectedRef.current) {
      showToast('⚠️ Brak połączenia z serwerem');
      return;
    }

    const board = boardRef.current;
    const piece = board[row][col];

    // If a piece is selected, check if clicking on a valid move target
    if (selectedRef.current) {
      const legalMoves = legalMovesRef.current;
      const isLegal = legalMoves.some(
        (m) => m.to[0] === row && m.to[1] === col
      );
      if (isLegal) {
        // Find the matching legal move to include captures for disambiguation
        const matchingMove = legalMoves.find(m => m.to[0] === row && m.to[1] === col);
        handleMove(selectedRef.current, [row, col], matchingMove?.captures);
        return;
      }
    }

    // In PvAI, human controls white pieces — allow selecting white pieces
    // only when it's white's turn (prevents clicking during AI turn)
    const isHumanPiece = modeRef.current === 'pvai'
      ? piece && piece.color === 'white' && turnRef.current === 'white'
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
    // Only emit to server in aivai mode — server rejects changes otherwise
    if (modeRef.current === 'aivai') {
      socketRef.current?.emit('setParams', newParams);
    }
  }, []);

  // Toast helper
  const showToast = useCallback((msg, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: msg, type: 'success' });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  // Sliders only update local state — no socket emit
  const handleModelParamsChange = useCallback((newModelParams) => {
    setModelParams((prev) => ({ ...prev, ...newModelParams }));
  }, []);

  // "Zastosuj zmiany" — emit to server, reset model
  // BUG-V3-002: Delay success toast so server 'error' can cancel it (PvAI rejects setParams)
  const handleApplyModelParams = useCallback(() => {
    socketRef.current?.emit('setParams', { ...modelParams });
    // Cancel any previous pending toast
    if (pendingModelParamsToast.current) clearTimeout(pendingModelParamsToast.current);
    // Show success only if no error arrives within 500ms
    pendingModelParamsToast.current = setTimeout(() => {
      pendingModelParamsToast.current = null;
      showToast('✅ Model zresetowany, szkolenie od nowa');
    }, 500);
  }, [modelParams, showToast]);

  // "Resetuj domyślne" — restore max defaults
  const handleResetModelParams = useCallback(() => {
    setModelParams({ ...DEFAULT_MODEL_PARAMS });
  }, []);

  const handleRestart = useCallback((which) => {
    socketRef.current?.emit('restart', { side: which });
  }, []);

  const handleToggleSelfplay = useCallback(() => {
    // Fix #156: use ref for current value and update immediately after emit
    // to prevent stale closure on rapid toggle clicks
    const isActive = selfPlayActiveRef.current;
    if (isActive) {
      socketRef.current?.emit('stopSelfPlay');
    } else {
      socketRef.current?.emit('startSelfPlay');
    }
    selfPlayActiveRef.current = !isActive;
    setSelfPlayActive(!isActive);
  }, []);

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
        <span style={{ fontSize: '0.75rem', color: connected ? 'var(--green)' : 'var(--red)' }} role="status" aria-live="polite">
          {connected ? '🟢 Online' : '🔴 Offline — reconnecting...'}
        </span>
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
            onReset={handleReset}
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
                      {m.capture ? <><span aria-label="zbicie">⚔️</span>{' '}</> : ''}{m.from}-{m.to}
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
              whiteStrategy={params.whiteStrategy}
              blackStrategy={params.blackStrategy}
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
            <div className={`toast-notification ${toast.type === 'error' ? 'toast-error' : ''}`} role="alert" aria-live="assertive">{toast.message || toast}</div>
          )}
        </div>
      </div>
    </div>
  );
}

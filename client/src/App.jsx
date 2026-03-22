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
      setStats((prev) => ({
        games: prev.games + 1,
        whiteWins: prev.whiteWins + (data.winner === 'white' ? 1 : 0),
        blackWins: prev.blackWins + (data.winner === 'black' ? 1 : 0),
        draws: prev.draws + (data.winner === 'draw' ? 1 : 0),
      }));
      setGameHistory((prev) => [
        { winner: data.winner, moves: data.moves || 0 },
        ...prev,
      ].slice(0, 10));
    });

    s.on('loss', (data) => {
      setLossHistory((prev) => [...prev, data.loss].slice(-100));
    });

    s.on('selfPlayStatus', (data) => {
      setSelfPlayActive(data.active);
      if (data.gameNumber !== undefined) setGameNumber(data.gameNumber);
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
    if (gameOver) return;
    socketRef.current?.emit('move', { from, to });
    setSelected(null);
    setLegalMoves([]);
  }, [gameOver]);

  const handleCellClick = useCallback((row, col) => {
    console.log(`[DEBUG] handleCellClick(${row},${col}) gameOver=${gameOver} mode=${mode} turn=${turn} selected=${JSON.stringify(selected)} lmCount=${legalMoves?.length}`);
    if (gameOver) return;
    if (mode === 'aivai') return;

    const piece = board[row][col];
    console.log(`[DEBUG] piece at (${row},${col}):`, JSON.stringify(piece));

    if (selected) {
      const isLegal = legalMoves.some(
        (m) => m.to[0] === row && m.to[1] === col
      );
      console.log(`[DEBUG] isLegal: ${isLegal}, legalMoves:`, JSON.stringify(legalMoves));
      if (isLegal) {
        console.log(`[DEBUG] Making move: ${JSON.stringify(selected)} -> [${row},${col}]`);
        handleMove(selected, [row, col]);
        return;
      }
    }

    if (piece && piece.color === turn && (mode === 'pvai' && piece.color === 'white')) {
      console.log(`[DEBUG] Selecting piece at (${row},${col})`);
      setSelected([row, col]);
      socketRef.current?.emit('getLegalMoves', { from: [row, col] });
    } else {
      console.log(`[DEBUG] Deselecting. piece=${JSON.stringify(piece)} turn=${turn}`);
      setSelected(null);
      setLegalMoves([]);
    }
  }, [board, turn, selected, legalMoves, gameOver, mode, handleMove]);

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

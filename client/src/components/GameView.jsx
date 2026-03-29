import React from 'react';
import Board from './Board';
import GameControls from './GameControls';
import StatsPanel from './StatsPanel';
import ParamsPanel from './ParamsPanel';
import Toast from './Toast';

/**
 * GameView - Main game view with board, controls, and side panel
 */
export default function GameView({
  board,
  turn,
  mode,
  gameOver,
  winner,
  legalMoves,
  selected,
  lastMove,
  movePath,
  speed,
  connected,
  moveHistory,
  stats,
  lossHistory,
  gameHistory,
  gameNumber,
  selfPlayActive,
  avgTime,
  totalTimeMs,
  lastRoundTime,
  params,
  modelParams,
  toast,
  onCellClick,
  onReset,
  onStartPvai,
  onStartAivai,
  onSpeed,
  onParamsChange,
  onRestart,
  onToggleSelfplay,
  onModelParamsChange,
  onApplyModelParams,
  onResetModelParams,
}) {
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
            onCellClick={onCellClick}
            legalMoves={legalMoves}
            selected={selected}
            lastMove={lastMove}
            gameOver={gameOver}
            winner={winner}
            path={movePath}
            captures={lastMove?.captures}
            onReset={onReset}
          />
          <GameControls
            mode={mode}
            turn={turn}
            gameOver={gameOver}
            winner={winner}
            onStartPvai={onStartPvai}
            onStartAivai={onStartAivai}
            onReset={onReset}
            speed={speed}
            onSpeed={onSpeed}
          />
        </div>
        <div className="game-side">
          <StatsPanel
            moveHistory={moveHistory}
            stats={stats}
            lossHistory={lossHistory}
            gameHistory={gameHistory}
            gameNumber={gameNumber}
            selfPlayActive={selfPlayActive}
            avgTime={avgTime}
            totalTimeMs={totalTimeMs}
            lastRoundTime={lastRoundTime}
            params={params}
            connected={connected}
            onToggleSelfplay={onToggleSelfplay}
            onRestart={onRestart}
            onParamsChange={onParamsChange}
            modelParams={modelParams}
            onModelParamsChange={onModelParamsChange}
            onApplyModelParams={onApplyModelParams}
            onResetModelParams={onResetModelParams}
          />
          <ParamsPanel
            params={params}
            onParamsChange={onParamsChange}
            onRestart={onRestart}
            active={selfPlayActive}
            onToggleSelfplay={onToggleSelfplay}
            modelParams={modelParams}
            onModelParamsChange={onModelParamsChange}
            onApplyModelParams={onApplyModelParams}
            onResetModelParams={onResetModelParams}
          />
          <Toast toast={toast} />
        </div>
      </div>
    </div>
  );
}

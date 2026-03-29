import React from 'react';
import Dashboard from './Dashboard';

/**
 * StatsPanel - Stats display panel (move history + dashboard)
 */
export default function StatsPanel({
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
  connected,
  onToggleSelfplay,
  onRestart,
  onParamsChange,
  modelParams,
  onModelParamsChange,
  onApplyModelParams,
  onResetModelParams,
}) {
  return (
    <>
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
    </>
  );
}

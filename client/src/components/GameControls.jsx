import React from 'react';

export default function GameControls({
  mode,
  turn,
  gameOver,
  winner,
  onStartPvai,
  onStartAivai,
  onReset,
  speed,
  onSpeed,
}) {
  const turnColor = turn === 'white' ? '#f0f0f0' : '#2a2a2a';
  const turnLabel = turn === 'white' ? 'Białe' : 'Czarne';

  let statusText;
  if (gameOver) {
    if (winner === 'draw') {
      statusText = '🤝 Remis!';
    } else {
      statusText = `🏆 ${winner === 'white' ? 'Białe' : 'Czarne'} wygrywają!`;
    }
  } else {
    statusText = `Tura: ${turnLabel}`;
  }

  return (
    <div className="controls">
      <div className="controls-status">
        {!gameOver && (
          <span
            className={`turn-indicator ${turn === 'white' ? 'turn-white' : 'turn-black'}`}
          />
        )}
        {statusText}
      </div>
      <div className="controls-buttons">
        <button className="btn-primary btn-small" onClick={onStartPvai}>
          🎮 Gracz vs AI
        </button>
        <button className="btn-secondary btn-small" onClick={onStartAivai}>
          🤖 AI vs AI
        </button>
        <button className="btn-danger btn-small" onClick={onReset}>
          🔄 Reset
        </button>
      </div>
      <div className="controls-buttons" style={{ marginTop: '0.3rem' }}>
        <button onClick={() => onSpeed(0)} className={speed === 0 ? 'btn-primary btn-small' : 'btn-secondary btn-small'}>⚡ Błyskawica</button>
        <button onClick={() => onSpeed(100)} className={speed === 100 ? 'btn-primary btn-small' : 'btn-secondary btn-small'}>🏃 Szybko</button>
        <button onClick={() => onSpeed(350)} className={speed === 350 ? 'btn-primary btn-small' : 'btn-secondary btn-small'}>🐢 Wolno</button>
      </div>
    </div>
  );
}

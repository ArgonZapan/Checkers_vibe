import React, { useRef, useEffect } from 'react';

export default function Dashboard({
  stats,
  lossHistory = [],
  gameHistory = [],
  currentGame,
  active,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (lossHistory.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Brak danych loss', w / 2, h / 2);
      return;
    }

    const max = Math.max(...lossHistory);
    const min = Math.min(...lossHistory);
    const range = max - min || 1;

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Loss line
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    lossHistory.forEach((val, i) => {
      const x = (i / (lossHistory.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`max: ${max.toFixed(3)}`, 4, 12);
    ctx.textAlign = 'right';
    ctx.fillText(`min: ${min.toFixed(3)}`, w - 4, h - 4);
  }, [lossHistory]);

  const winnerClass = (w) => {
    if (w === 'white') return 'winner-white';
    if (w === 'black') return 'winner-black';
    return 'winner-draw';
  };

  const winnerLabel = (w) => {
    if (w === 'white') return '⚪ Białe';
    if (w === 'black') return '⚫ Czarne';
    return '🤝 Remis';
  };

  return (
    <div className="dashboard">
      <h3>
        📊 Dashboard{' '}
        <span style={{ fontSize: '0.8rem', color: active ? '#2ecc71' : '#888' }}>
          {active ? '● Aktywny' : '○ Nieaktywny'}
        </span>
      </h3>

      <div className="dashboard-section">
        <h3>Statystyki (gra #{currentGame || 0})</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Gier</div>
            <div className="stat-value">{stats.games}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">⚪ Wygrane</div>
            <div className="stat-value winner-white">{stats.whiteWins}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">⚫ Wygrane</div>
            <div className="stat-value">{stats.blackWins}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Remisy</div>
            <div className="stat-value winner-draw">{stats.draws}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Loss (ostatnie 100 rund)</h3>
        <canvas
          ref={canvasRef}
          className="loss-chart"
          width={280}
          height={100}
        />
      </div>

      <div className="dashboard-section">
        <h3>Historia gier</h3>
        {gameHistory.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Brak rozegranych gier
          </p>
        ) : (
          <ul className="game-history-list">
            {gameHistory.map((g, i) => (
              <li key={i}>
                <span className={winnerClass(g.winner)}>
                  {winnerLabel(g.winner)}
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {g.moves} ruchów
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import React, { useRef, useEffect, useCallback } from 'react';

// Shared chart drawing function
function drawLossChart(canvas, data) {
  if (!canvas) return;
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = container ? container.clientWidth : 300;
  const h = 100;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) {
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Brak danych loss', w / 2, h / 2);
    return;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 5; i++) {
    const y = (i / 4) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  data.forEach((val, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((val - min) / range) * (h - 10) - 5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`max: ${max.toFixed(3)}`, 4, 12);
  ctx.textAlign = 'right';
  ctx.fillText(`min: ${min.toFixed(3)}`, w - 4, h - 4);
}

export default function Dashboard({
  stats,
  lossHistory = [],
  gameHistory = [],
  currentGame,
  active,
  avgTime = 0,
  totalTimeMs = 0,
  lastRoundTime = 0,
  whiteEpsilon,
  blackEpsilon,
  connected,
  whiteStrategy,
  blackStrategy,
}) {
  const canvasRef = useRef(null);
  const lossRef = useRef(lossHistory);
  lossRef.current = lossHistory;

  useEffect(() => {
    const canvas = canvasRef.current;
    drawLossChart(canvas, lossRef.current);

    // Debounced resize handler to avoid excessive redraws during drag-resize
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => drawLossChart(canvasRef.current, lossRef.current), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, []); // draw uses lossRef, no dep needed

  // Redraw when data changes
  useEffect(() => {
    drawLossChart(canvasRef.current, lossHistory);
  }, [lossHistory]);

  const winnerClass = (w) => {
    if (w === 'white') return 'winner-white';
    if (w === 'black') return 'winner-black';
    return 'winner-draw';
  };

  const winnerLabel = (w) => {
    if (w === 'white') return <><span aria-label="białe">⚪</span> Białe</>;
    if (w === 'black') return <><span aria-label="czarne">⚫</span> Czarne</>;
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
        {/* Win rates */}
        {stats.games > 0 && (
          <div className="stats-grid" style={{ marginTop: '0.4rem' }}>
            <div className="stat-item">
              <div className="stat-label">⚪ Win Rate</div>
              <div className="stat-value winner-white">{((stats.whiteWins / stats.games) * 100).toFixed(1)}%</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">⚫ Win Rate</div>
              <div className="stat-value">{((stats.blackWins / stats.games) * 100).toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>

      {/* Epsilon display */}
      {(whiteEpsilon !== undefined || blackEpsilon !== undefined) && (
        <div className="dashboard-section">
          <h3>🎯 Epsilon (exploration)</h3>
          <div className="stats-grid">
            {whiteEpsilon !== undefined && (
              <div className="stat-item">
                <div className="stat-label">⚪ Epsilon</div>
                <div className="stat-value winner-white">{whiteEpsilon.toFixed(2)}</div>
              </div>
            )}
            {blackEpsilon !== undefined && (
              <div className="stat-item">
                <div className="stat-label">⚫ Epsilon</div>
                <div className="stat-value">{blackEpsilon.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Strategy display */}
      {(whiteStrategy || blackStrategy) && (
        <div className="dashboard-section">
          <h3>⚔️ Strategia</h3>
          <div className="stats-grid">
            {whiteStrategy && (
              <div className="stat-item">
                <div className="stat-label">⚪ Białe</div>
                <div className="stat-value winner-white" style={{ fontSize: '0.9rem' }}>🗡️ {whiteStrategy}</div>
              </div>
            )}
            {blackStrategy && (
              <div className="stat-item">
                <div className="stat-label">⚫ Czarne</div>
                <div className="stat-value" style={{ fontSize: '0.9rem' }}>🏰 {blackStrategy}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connection & Model Status */}
      <div className="dashboard-section">
        <h3>📡 Status</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Połączenie</div>
            <div className="stat-value" style={{ color: connected ? '#3fb950' : '#f85149' }}>
              {connected ? '🟢 Online' : '🔴 Offline'}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Model</div>
            <div className="stat-value" style={{ color: active ? '#3fb950' : '#8b949e', fontSize: '0.9rem' }}>
              {active ? '🎓 Training' : '⏸ Idle'}
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Loss (ostatnie 100 rund)</h3>
        <canvas
          ref={canvasRef}
          className="loss-chart"
          height={100}
          role="img"
          aria-label={`Loss chart: ${lossHistory.length} data points`}
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

      <div className="dashboard-section">
        <h3>⏱ Czas</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Średni czas rundy</div>
            <div className="stat-value">{(avgTime / 1000).toFixed(1)}s</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Ostatnia runda</div>
            <div className="stat-value">{(lastRoundTime / 1000).toFixed(1)}s</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Całkowity czas</div>
            <div className="stat-value">
              {Math.floor(totalTimeMs / 3600000)}h {Math.floor((totalTimeMs % 3600000) / 60000)}m
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

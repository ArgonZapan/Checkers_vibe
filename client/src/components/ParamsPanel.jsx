import React from 'react';

export default function ParamsPanel({
  params,
  onParamsChange,
  onRestart,
  active,
  onToggleSelfplay,
}) {
  return (
    <div className="params-panel">
      <h3>⚙️ Parametry AI</h3>

      <div className="param-group">
        <h4>⚪ Białe</h4>
        <div className="param-row">
          <label>Epsilon:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.whiteEpsilon}
            onChange={(e) => onParamsChange({ whiteEpsilon: parseFloat(e.target.value) })}
          />
          <span className="epsilon-val">{params.whiteEpsilon.toFixed(2)}</span>
        </div>
        <div className="param-row">
          <label>Sieć:</label>
          <select
            value={params.whiteNetworkSize}
            onChange={(e) => onParamsChange({ whiteNetworkSize: e.target.value })}
          >
            <option value="small">Mała</option>
            <option value="medium">Średnia</option>
            <option value="large">Duża</option>
          </select>
        </div>
      </div>

      <div className="param-group">
        <h4>⚫ Czarne</h4>
        <div className="param-row">
          <label>Epsilon:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.blackEpsilon}
            onChange={(e) => onParamsChange({ blackEpsilon: parseFloat(e.target.value) })}
          />
          <span className="epsilon-val">{params.blackEpsilon.toFixed(2)}</span>
        </div>
        <div className="param-row">
          <label>Sieć:</label>
          <select
            value={params.blackNetworkSize}
            onChange={(e) => onParamsChange({ blackNetworkSize: e.target.value })}
          >
            <option value="small">Mała</option>
            <option value="medium">Średnia</option>
            <option value="large">Duża</option>
          </select>
        </div>
      </div>

      <div className="param-group">
        <h4>Restart sieci</h4>
        <div className="restart-buttons">
          <button className="btn-small btn-secondary" onClick={() => onRestart('white')}>
            Restart ⚪
          </button>
          <button className="btn-small btn-secondary" onClick={() => onRestart('black')}>
            Restart ⚫
          </button>
          <button className="btn-small btn-danger" onClick={() => onRestart('both')}>
            Restart oba
          </button>
        </div>
      </div>

      <div className="param-group">
        <h4>Self-Play</h4>
        <div className="selfplay-buttons">
          {active ? (
            <button className="btn-small btn-danger" onClick={onToggleSelfplay}>
              ⏹ Stop Self-Play
            </button>
          ) : (
            <button className="btn-small btn-success" onClick={onToggleSelfplay}>
              ▶ Start Self-Play
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import React from 'react';

export default function ParamsPanel({
  params,
  onParamsChange,
  onRestart,
  active,
  onToggleSelfplay,
  modelParams,
  onModelParamsChange,
}) {
  // Log-scale slider helper for learning rate
  const lrToSlider = (lr) => {
    // Map lr [0.0001, 0.1] to slider [0, 100] on log scale
    const minLog = Math.log10(0.0001); // -4
    const maxLog = Math.log10(0.1);    // -1
    return ((Math.log10(lr) - minLog) / (maxLog - minLog)) * 100;
  };
  const sliderToLr = (val) => {
    const minLog = Math.log10(0.0001);
    const maxLog = Math.log10(0.1);
    return Math.pow(10, minLog + (val / 100) * (maxLog - minLog));
  };

  const mp = modelParams || {};

  return (
    <div className="params-panel">
      <h3>⚙️ Parametry AI</h3>

      {/* ── Epsilon / Network per side ─────────────────────────────────── */}
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

      {/* ── Architecture ───────────────────────────────────────────────── */}
      <div className="param-group">
        <h4>🏗️ Architektura</h4>
        <div className="param-row">
          <label>Warstwy:</label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            value={mp.layers ?? 3}
            onChange={(e) => onModelParamsChange({ layers: parseInt(e.target.value) })}
          />
          <span className="epsilon-val">{mp.layers ?? 3}</span>
        </div>
        <div className="param-row">
          <label>Neurony:</label>
          <input
            type="range"
            min="32"
            max="512"
            step="32"
            value={mp.neurons ?? 128}
            onChange={(e) => onModelParamsChange({ neurons: parseInt(e.target.value) })}
          />
          <span className="epsilon-val">{mp.neurons ?? 128}</span>
        </div>
        <div className="param-row">
          <label>Aktywacja:</label>
          <select
            value={mp.activation ?? 'relu'}
            onChange={(e) => onModelParamsChange({ activation: e.target.value })}
          >
            <option value="relu">ReLU</option>
            <option value="tanh">Tanh</option>
            <option value="sigmoid">Sigmoid</option>
            <option value="leaky_relu">Leaky ReLU</option>
          </select>
        </div>
      </div>

      {/* ── Training ───────────────────────────────────────────────────── */}
      <div className="param-group">
        <h4>🎓 Szkolenie</h4>
        <div className="param-row">
          <label>LR:</label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={lrToSlider(mp.lr ?? 0.001)}
            onChange={(e) => onModelParamsChange({ lr: sliderToLr(parseFloat(e.target.value)) })}
          />
          <span className="epsilon-val">{(mp.lr ?? 0.001).toExponential(1)}</span>
        </div>
        <div className="param-row">
          <label>Batch:</label>
          <input
            type="range"
            min="0"
            max="5"
            step="1"
            value={[8, 16, 32, 64, 128, 256].indexOf(mp.batchSize ?? 64)}
            onChange={(e) => {
              const sizes = [8, 16, 32, 64, 128, 256];
              onModelParamsChange({ batchSize: sizes[parseInt(e.target.value)] });
            }}
          />
          <span className="epsilon-val">{mp.batchSize ?? 64}</span>
        </div>
        <div className="param-row">
          <label>Dropout:</label>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.05"
            value={mp.dropout ?? 0}
            onChange={(e) => onModelParamsChange({ dropout: parseFloat(e.target.value) })}
          />
          <span className="epsilon-val">{(mp.dropout ?? 0).toFixed(2)}</span>
        </div>
      </div>

      {/* ── Restart ────────────────────────────────────────────────────── */}
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

      {/* ── Self-Play ──────────────────────────────────────────────────── */}
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

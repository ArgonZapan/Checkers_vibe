import React, { useRef, useCallback, useState, useEffect } from 'react';

// Debounce helper — delays fn call by `ms`, resets on each call (#36)
function useDebouncedCallback(fn, ms) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), ms);
  }, [ms]);
}

export default function ParamsPanel({
  params,
  onParamsChange,
  onRestart,
  active,
  onToggleSelfplay,
  modelParams,
  onModelParamsChange,
  onApplyModelParams,
  onResetModelParams,
}) {
  // Log-scale slider helper for learning rate
  const lrToSlider = (lr) => {
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

  // Local slider state for immediate visual feedback during drag (#36)
  const [localWhiteEps, setLocalWhiteEps] = useState(params.whiteEpsilon);
  const [localBlackEps, setLocalBlackEps] = useState(params.blackEpsilon);

  // Sync local state when parent props change (e.g. after debounced update)
  useEffect(() => { setLocalWhiteEps(params.whiteEpsilon); }, [params.whiteEpsilon]);
  useEffect(() => { setLocalBlackEps(params.blackEpsilon); }, [params.blackEpsilon]);

  // Debounced epsilon change handlers to avoid flooding events on every pixel (#36)
  const debouncedWhiteEpsilon = useDebouncedCallback(
    (val) => onParamsChange({ whiteEpsilon: val }), 300
  );
  const debouncedBlackEpsilon = useDebouncedCallback(
    (val) => onParamsChange({ blackEpsilon: val }), 300
  );

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
            value={localWhiteEps}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setLocalWhiteEps(val);       // immediate visual feedback
              debouncedWhiteEpsilon(val);  // debounced parent update
            }}
          />
          <span className="epsilon-val">{localWhiteEps.toFixed(2)}</span>
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
            value={localBlackEps}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setLocalBlackEps(val);       // immediate visual feedback
              debouncedBlackEpsilon(val);  // debounced parent update
            }}
          />
          <span className="epsilon-val">{localBlackEps.toFixed(2)}</span>
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
          <label>Warstwy: <strong>{mp.layers ?? 3}</strong></label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            value={mp.layers ?? 3}
            onChange={(e) => onModelParamsChange({ layers: parseInt(e.target.value) })}
          />
        </div>
        <div className="param-row">
          <label>Neurony: <strong>{mp.neurons ?? 128}</strong></label>
          <input
            type="range"
            min="32"
            max="512"
            step="32"
            value={mp.neurons ?? 128}
            onChange={(e) => onModelParamsChange({ neurons: parseInt(e.target.value) })}
          />
        </div>
        <div className="param-row">
          <label>Aktywacja: <strong>{mp.activation ?? 'relu'}</strong></label>
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
          <label>LR: <strong>{(mp.lr ?? 0.001).toExponential(1)}</strong></label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={lrToSlider(mp.lr ?? 0.001)}
            onChange={(e) => onModelParamsChange({ lr: sliderToLr(parseFloat(e.target.value)) })}
          />
        </div>
        <div className="param-row">
          <label>Batch: <strong>{mp.batchSize ?? 64}</strong></label>
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
        </div>
        <div className="param-row">
          <label>Dropout: <strong>{(mp.dropout ?? 0).toFixed(2)}</strong></label>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.05"
            value={mp.dropout ?? 0}
            onChange={(e) => onModelParamsChange({ dropout: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      {/* ── Apply / Reset buttons ──────────────────────────────────────── */}
      <div className="param-group">
        <h4>📝 Zatwierdź zmiany</h4>
        <div className="apply-buttons">
          <button className="btn-small btn-apply" onClick={onApplyModelParams}>
            ✅ Zastosuj zmiany
          </button>
          <button className="btn-small btn-reset-defaults" onClick={onResetModelParams}>
            🔄 Resetuj domyślne
          </button>
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

import React, { useState } from 'react';

// Log-scale slider helpers
const LR_MIN_LOG = Math.log10(0.0001);
const LR_MAX_LOG = Math.log10(0.1);
const lrToSlider = (lr) => {
  const safeLr = Math.max(lr || 0.0001, 0.0001);
  return ((Math.log10(safeLr) - LR_MIN_LOG) / (LR_MAX_LOG - LR_MIN_LOG)) * 100;
};
const sliderToLr = (val) => Math.pow(10, LR_MIN_LOG + (val / 100) * (LR_MAX_LOG - LR_MIN_LOG));

const BATCH_SIZES = [8, 16, 32, 64, 128, 256];

// ── Slider component ─────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="param-row">
      <label>{label}: <strong>{format ? format(value) : value}</strong></label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

// ── Side Tab (Białe / Czarne) ────────────────────────────────────────────────
function SideTab({
  side,
  emoji,
  epsilon,
  networkSize,
  onNetworkSizeChange,
  modelParams,
  onModelParamsChange,
  config,
}) {
  const mp = modelParams || {};

  return (
    <div className="side-tab">
      {/* ── Exploration (read-only) ───────────────────────────────────── */}
      <div className="param-group">
        <h4>🔍 Eksploracja</h4>
        <div className="param-row">
          <label>Epsilon:</label>
          <span className="epsilon-val epsilon-readonly">{(epsilon ?? 0).toFixed(2)}</span>
          <span className="epsilon-badge">auto</span>
        </div>
        <div className="param-row">
          <label>Min epsilon: <strong>{(mp.minEpsilon ?? config.minEpsilon ?? 0.01).toFixed(3)}</strong></label>
          <input
            type="range" min="0" max="0.2" step="0.005"
            value={mp.minEpsilon ?? config.minEpsilon ?? 0.01}
            onChange={(e) => onModelParamsChange({ minEpsilon: parseFloat(e.target.value) })}
          />
        </div>
        <div className="param-row">
          <label>Decay/grę: <strong>{(mp.epsilonDecay ?? config.epsilonDecay ?? 0.01).toFixed(4)}</strong></label>
          <input
            type="range" min="0" max="0.05" step="0.001"
            value={mp.epsilonDecay ?? config.epsilonDecay ?? 0.01}
            onChange={(e) => onModelParamsChange({ epsilonDecay: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      {/* ── Architecture ─────────────────────────────────────────────── */}
      <div className="param-group">
        <h4>🏗️ Architektura sieci</h4>
        <div className="param-row">
          <label>Sieć:</label>
          <select
            value={networkSize}
            onChange={(e) => onNetworkSizeChange(e.target.value)}
          >
            <option value="small">Mała (64-64)</option>
            <option value="medium">Średnia (128-128)</option>
            <option value="large">Duża (256-256)</option>
            <option value="custom">Niestandardowa</option>
          </select>
        </div>
        <Slider
          label="Warstwy" value={mp.layers ?? 3}
          min={1} max={5} step={1}
          onChange={(v) => onModelParamsChange({ layers: Math.round(v) })}
        />
        <Slider
          label="Neurony/warstwę" value={mp.neurons ?? 128}
          min={32} max={512} step={32}
          onChange={(v) => onModelParamsChange({ neurons: Math.round(v) })}
        />
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
        <Slider
          label="Dropout" value={mp.dropout ?? 0}
          min={0} max={0.5} step={0.05}
          onChange={(v) => onModelParamsChange({ dropout: v })}
          format={(v) => v.toFixed(2)}
        />
      </div>

      {/* ── Training ─────────────────────────────────────────────────── */}
      <div className="param-group">
        <h4>🎓 Szkolenie</h4>
        <div className="param-row">
          <label>Learning Rate: <strong>{(mp.lr ?? 0.001).toExponential(1)}</strong></label>
          <input
            type="range" min="0" max="100" step="1"
            value={lrToSlider(mp.lr ?? 0.001)}
            onChange={(e) => onModelParamsChange({ lr: sliderToLr(parseFloat(e.target.value)) })}
          />
        </div>
        <div className="param-row">
          <label>Batch size: <strong>{mp.batchSize ?? 64}</strong></label>
          <input
            type="range" min="0" max={BATCH_SIZES.length - 1} step="1"
            value={BATCH_SIZES.indexOf(mp.batchSize ?? 64)}
            onChange={(e) => onModelParamsChange({ batchSize: BATCH_SIZES[parseInt(e.target.value)] })}
          />
        </div>
        <Slider
          label="Epoki/grę" value={mp.epochs ?? 5}
          min={1} max={20} step={1}
          onChange={(v) => onModelParamsChange({ epochs: Math.round(v) })}
        />
        <Slider
          label="Gamma (discount)" value={mp.gamma ?? 0.95}
          min={0.5} max={0.99} step={0.01}
          onChange={(v) => onModelParamsChange({ gamma: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Buffer size" value={mp.bufferSize ?? 10000}
          min={1000} max={50000} step={1000}
          onChange={(v) => onModelParamsChange({ bufferSize: Math.round(v) })}
          format={(v) => v.toLocaleString()}
        />
      </div>

      {/* ── Reward shaping ───────────────────────────────────────────── */}
      <div className="param-group">
        <h4>🏆 Nagrody</h4>
        <Slider
          label="Zbicie pionka" value={mp.rewardCapture ?? 0.1}
          min={0} max={0.5} step={0.01}
          onChange={(v) => onModelParamsChange({ rewardCapture: v })}
          format={(v) => `+${v.toFixed(2)}`}
        />
        <Slider
          label="Utrata pionka" value={mp.rewardLosePiece ?? -0.1}
          min={-0.5} max={0} step={0.01}
          onChange={(v) => onModelParamsChange({ rewardLosePiece: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Promocja na damkę" value={mp.rewardPromotion ?? 0.3}
          min={0} max={1} step={0.05}
          onChange={(v) => onModelParamsChange({ rewardPromotion: v })}
          format={(v) => `+${v.toFixed(2)}`}
        />
        <Slider
          label="Wygrana gry" value={mp.rewardWin ?? 1.0}
          min={0.5} max={2} step={0.1}
          onChange={(v) => onModelParamsChange({ rewardWin: v })}
          format={(v) => `+${v.toFixed(1)}`}
        />
        <Slider
          label="Przegrana gry" value={mp.rewardLose ?? -1.0}
          min={-2} max={-0.5} step={0.1}
          onChange={(v) => onModelParamsChange({ rewardLose: v })}
          format={(v) => v.toFixed(1)}
        />
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────
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
  const [activeTab, setActiveTab] = useState('white');
  const mp = modelParams || {};
  const config = params._config || {}; // server config snapshot

  return (
    <div className="params-panel">
      <h3>⚙️ Parametry AI</h3>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="params-tabs" role="tablist" aria-label="AI parameters tabs">
        <button
          role="tab"
          className={`params-tab ${activeTab === 'white' ? 'active' : ''}`}
          onClick={() => setActiveTab('white')}
          aria-selected={activeTab === 'white'}
          aria-controls="panel-white"
          tabIndex={activeTab === 'white' ? 0 : -1}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') setActiveTab('black'); if (e.key === 'ArrowLeft') setActiveTab('general'); }}
        >
          ⚪ Białe
        </button>
        <button
          role="tab"
          className={`params-tab ${activeTab === 'black' ? 'active' : ''}`}
          onClick={() => setActiveTab('black')}
          aria-selected={activeTab === 'black'}
          aria-controls="panel-black"
          tabIndex={activeTab === 'black' ? 0 : -1}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') setActiveTab('general'); if (e.key === 'ArrowLeft') setActiveTab('white'); }}
        >
          ⚫ Czarne
        </button>
        <button
          role="tab"
          className={`params-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
          aria-selected={activeTab === 'general'}
          aria-controls="panel-general"
          tabIndex={activeTab === 'general' ? 0 : -1}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') setActiveTab('white'); if (e.key === 'ArrowLeft') setActiveTab('black'); }}
        >
          🔧 Ogólne
        </button>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="params-tab-content">
        {activeTab === 'white' && (
          <SideTab
            side="white" emoji="⚪"
            epsilon={params.whiteEpsilon}
            networkSize={params.whiteNetworkSize}
            onNetworkSizeChange={(v) => onParamsChange({ whiteNetworkSize: v })}
            modelParams={mp}
            onModelParamsChange={onModelParamsChange}
            config={config}
          />
        )}

        {activeTab === 'black' && (
          <SideTab
            side="black" emoji="⚫"
            epsilon={params.blackEpsilon}
            networkSize={params.blackNetworkSize}
            onNetworkSizeChange={(v) => onParamsChange({ blackNetworkSize: v })}
            modelParams={mp}
            onModelParamsChange={onModelParamsChange}
            config={config}
          />
        )}

        {activeTab === 'general' && (
          <div className="side-tab">
            {/* ── Speed ───────────────────────────────────────────────── */}
            <div className="param-group">
              <h4>⚡ Prędkość</h4>
              <div className="param-row">
                <label>Tryb:</label>
                <select
                  value={params.speedMode || 'normal'}
                  onChange={(e) => onParamsChange({ speedMode: e.target.value })}
                >
                  <option value="fast">🏎️ Szybki (bez animacji)</option>
                  <option value="normal">🐢 Normalny (animacje)</option>
                </select>
              </div>
              <Slider
                label="Delay ruchu (ms)" value={params.aiMoveDelayMs ?? 500}
                min={0} max={5000} step={100}
                onChange={(v) => onParamsChange({ aiMoveDelayMs: Math.round(v) })}
                format={(v) => `${v}ms`}
              />
            </div>

            {/* ── Apply / Reset ───────────────────────────────────────── */}
            <div className="param-group">
              <h4>📝 Zatwierdź zmiany</h4>
              <div className="apply-buttons">
                <button className="btn-small btn-apply" onClick={onApplyModelParams} aria-label="Apply model parameter changes">
                  ✅ Zastosuj zmiany
                </button>
                <button className="btn-small btn-reset-defaults" onClick={onResetModelParams} aria-label="Reset model parameters to defaults">
                  🔄 Resetuj domyślne
                </button>
              </div>
            </div>

            {/* ── Restart ─────────────────────────────────────────────── */}
            <div className="param-group">
              <h4>🔄 Restart sieci</h4>
              <div className="restart-buttons">
                <button className="btn-small btn-secondary" onClick={() => onRestart('white')} aria-label="Restart white neural network">
                  Restart ⚪
                </button>
                <button className="btn-small btn-secondary" onClick={() => onRestart('black')} aria-label="Restart black neural network">
                  Restart ⚫
                </button>
                <button className="btn-small btn-danger" onClick={() => onRestart('both')} aria-label="Restart both neural networks">
                  Restart oba
                </button>
              </div>
            </div>

            {/* ── Self-Play ───────────────────────────────────────────── */}
            <div className="param-group">
              <h4>🎮 Self-Play</h4>
              <div className="selfplay-buttons">
                {active ? (
                  <button className="btn-small btn-danger" onClick={onToggleSelfplay} aria-label="Stop self-play training">
                    ⏹ Stop Self-Play
                  </button>
                ) : (
                  <button className="btn-small btn-success" onClick={onToggleSelfplay} aria-label="Start self-play training">
                    ▶ Start Self-Play
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

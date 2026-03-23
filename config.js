// config.js — centralna konfiguracja Checkers_vibe
export const CONFIG = {
  // === FRONTEND ===
  board: {
    cellSize: 60,
    colors: {
      light: '#deb887',
      dark: '#8b4513',
      highlight: 'rgba(255, 255, 0, 0.3)',
      selected: 'rgba(0, 255, 0, 0.35)',
      validMove: 'rgba(0, 200, 0, 0.45)',
      validDot: 'rgba(0, 160, 0, 0.7)',
      white: '#f0f0f0',
      whiteStroke: '#999',
      black: '#2a2a2a',
      blackStroke: '#555',
      kingWhite: '#333',
      kingBlack: '#ddd',
    },
    animation: {
      stepDurationMs: 200,
      easeOut: true,
    },
  },

  // === SERVER ===
  server: {
    port: 3000,
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    cppBase: 'http://localhost:8080',
    fetchTimeoutMs: 5000,
    aiMoveDelayMs: 0, // 0 = minimal (10ms enforced)
    autoSaveMs: 30000,

    // Speed mode: "fast" = no delay/animation, "normal" = delay with half-delay animation
    speedMode: 'normal',       // "fast" | "normal"
    normalModeDelayMs: 500,    // X value for normal mode — animation = X/2
  },

  // === SPEED HELPERS ===
  // Returns effective move delay in ms based on speedMode
  get moveDelayMs() {
    const s = this.server;
    if (s.speedMode === 'fast') return 0;
    return s.aiMoveDelayMs > 0 ? s.aiMoveDelayMs : s.normalModeDelayMs;
  },
  // Returns effective animation duration per step in ms based on speedMode
  get animationStepDurationMs() {
    if (this.server.speedMode === 'fast') return 0;
    return Math.floor(this.moveDelayMs / 2);
  },

  // === AI/TRAINER ===
  ai: {
    defaultEpsilon: 0.3,
    minEpsilon: 0.01,
    epsilonDecay: 0.01,
    gamma: 0.95,
    bufferSize: 10000,
    trainEpochs: 5,
    modelParams: {
      layers: 3,
      neurons: 128,
      activation: 'relu',
      lr: 0.001,
      batchSize: 64,
      dropout: 0,
    },
    // Dual strategy: white = aggressor, black = fortress
    strategy: {
      white: 'aggressor',
      black: 'fortress',
    },
    strategies: {
      aggressor: {
        weights: { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 },
        epsilonDecay: 0.015,  // uczy się szybciej (agresja)
        minEpsilon: 0.02,
        rewardCapture: 0.15,
        rewardAdvance: 0.10,
        rewardPromotion: 0.20,
        rewardWin: 1.0,
        rewardLose: -1.0,
      },
      fortress: {
        weights: { material: 0.25, position: 0.40, threat: 0.10, tempo: 0.25 },
        epsilonDecay: 0.008,  // wolniejszy decay (cierpliwa gra)
        minEpsilon: 0.03,
        rewardCapture: 0.08,
        rewardAdvance: 0.03,
        rewardPromotion: 0.40,
        rewardWin: 1.0,
        rewardLose: -1.2,
      },
      minimax: {
        type: 'minimax',
        depth: 4,
        weights: { material: 1.0, position: 0.3 },
      },
    },
  },

};

// Deep freeze helper — recursively freezes all nested objects
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  // Freeze own enumerable properties first
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj);
}

// Deep freeze AI strategies to prevent runtime mutation of weights or any
// nested property. Copy-on-write is used in server/index.js for intentional
// changes (e.g. minimax depth).
deepFreeze(CONFIG.ai.strategies);

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
      stepDurationMs: 50,
      easeOut: true,
    },
  },

  // === SERVER ===
  server: {
    port: 3000,
    cppBase: 'http://localhost:8080',
    fetchTimeoutMs: 5000,
    aiMoveDelayMs: 0,
    autoSaveMs: 30000,
  },

  // === AI/TRAINER ===
  ai: {
    defaultEpsilon: 0.3,
    minEpsilon: 0.01,
    epsilonDecay: 0.001,
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
  },

};

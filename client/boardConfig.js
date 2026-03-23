// boardConfig.js — client-safe board config (no server internals exposed)
export const BOARD_CONFIG = {
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
};

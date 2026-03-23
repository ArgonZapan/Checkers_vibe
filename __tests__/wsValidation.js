/**
 * wsValidation.js — Extracted validation logic from server/index.js WebSocket handlers.
 *
 * This module mirrors the exact validation logic used in the socket handlers
 * so it can be tested independently without mocking Socket.IO.
 */

/**
 * Validates a coordinate for the "move" handler.
 * Matches the inline isValidCoord from server/index.js socket.on('move').
 * @param {*} c - The coordinate to validate
 * @returns {boolean}
 */
export function isValidCoord(c) {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    c[0] >= 0 &&
    c[0] <= 7 &&
    c[1] >= 0 &&
    c[1] <= 7
  );
}

/**
 * Validates a move payload for the "move" handler.
 * Mirrors the validation sequence in server/index.js.
 * @param {object} data - The move data { from, to, captures }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMove(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid "from" coordinate — expected [row, col] with values 0-7' };
  }
  const { from, to, captures } = data;

  if (!isValidCoord(from)) {
    return { valid: false, error: 'Invalid "from" coordinate — expected [row, col] with values 0-7' };
  }
  if (!isValidCoord(to)) {
    return { valid: false, error: 'Invalid "to" coordinate — expected [row, col] with values 0-7' };
  }
  if (captures != null && !Array.isArray(captures)) {
    return { valid: false, error: 'Invalid "captures" — expected an array' };
  }

  // Validate captures elements are valid coordinates (LEAK-010)
  if (Array.isArray(captures)) {
    for (let i = 0; i < captures.length; i++) {
      if (!isValidCoord(captures[i])) {
        return { valid: false, error: `Invalid capture at index ${i} — expected [row, col] with values 0-7` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates a speed value for the "setSpeed" handler.
 * Mirrors the validation in server/index.js socket.on('setSpeed').
 * @param {*} ms - The speed value in milliseconds
 * @returns {{ valid: boolean, clamped?: number, error?: string }}
 */
export function validateSetSpeed(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
    return { valid: false, error: 'Invalid speed value' };
  }
  const clamped = Math.max(0, Math.min(ms, 10000));
  return { valid: true, clamped };
}

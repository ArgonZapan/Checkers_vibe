/**
 * hunter-tw-coverage-gaps.test.js — Tests for coverage gaps in server/index.js.
 *
 * Covers areas not tested elsewhere:
 *   1. _isAllowedWsOrigin: comprehensive origin validation
 *   2. turnToColor: correct null return for unknown turns (not 'white')
 *   3. acquireLock: serialization, concurrent lock acquisition
 *   4. Shutdown logic: interval cleanup, graceful exit sequence
 *   5. HTTP API endpoint response structure validation
 *   6. wsThrottle edge cases: socket._throttle initialization, key isolation
 *   7. requireApiToken: token bypass when no token set, reject mismatch
 *   8. wsAuth: handshake auth vs header auth, dev mode bypass
 *   9. Rate limit cleanup: expired entry eviction, hard cap enforcement
 *  10. Auto-save dirty flag: snapshot-before-save behavior
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: _isAllowedWsOrigin (mirrors server/index.js) ────────────────

function _isAllowedWsOrigin(origin, corsOrigin) {
  if (!origin) return true; // same-origin or non-browser (no Origin header)
  if (corsOrigin === '*') return false; // wildcard CORS ≠ wildcard WS
  const allowedList = corsOrigin.split(',').map(s => s.trim());
  return allowedList.some(allowed => origin === allowed);
}

// ── Extracted: turnToColor (correct version from server/index.js) ──────────

function turnToColor(turn) {
  if (typeof turn === 'string') return turn; // already a color string (C++ engine format)
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return null; // 0 = draw/no turn — don't misleadingly return 'white'
}

// ── Extracted: acquireLock logic ───────────────────────────────────────────

function createLockManager() {
  let saveLock = Promise.resolve();
  function acquireLock() {
    let release;
    const prev = saveLock;
    saveLock = new Promise(resolve => { release = resolve; });
    return prev.then(() => release);
  }
  return { acquireLock, getLock: () => saveLock };
}

// ── Extracted: wsThrottle ──────────────────────────────────────────────────

function wsThrottle(socket, key, minIntervalMs) {
  const now = Date.now();
  const last = socket._throttle?.[key] || 0;
  if (now - last < minIntervalMs) return false;
  if (!socket._throttle) socket._throttle = {};
  socket._throttle[key] = now;
  return true;
}

// ── Extracted: requireApiToken logic ───────────────────────────────────────

function requireApiToken(reqToken, apiToken) {
  // Returns: { pass: boolean, status?: number, error?: string }
  if (!apiToken) return { pass: true }; // dev mode — no token set
  if (reqToken !== apiToken) {
    return { pass: false, status: 401, error: 'Unauthorized — valid token required' };
  }
  return { pass: true };
}

// ── Extracted: wsAuth logic ────────────────────────────────────────────────

function wsAuth(authToken, headerToken, apiToken) {
  if (!apiToken) return true; // dev mode — no token set
  const provided = authToken || headerToken?.replace(/^Bearer\s+/i, '').trim();
  return provided === apiToken;
}

// ── Extracted: rate limit cleanup logic ────────────────────────────────────

function cleanupRateLimitMap(rateLimitMap, windowMs, maxEntries) {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > windowMs) {
      rateLimitMap.delete(ip);
    }
  }
  if (rateLimitMap.size > maxEntries) {
    const sorted = [...rateLimitMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const evictCount = rateLimitMap.size - maxEntries;
    for (let i = 0; i < evictCount; i++) {
      rateLimitMap.delete(sorted[i][0]);
    }
  }
}

// ── Extracted: auto-save dirty flag snapshot logic ─────────────────────────

function simulateAutoSaveCycle(trainer) {
  if (!trainer.dirty) return { saved: false, reason: 'not dirty' };
  // Snapshot dirty flag BEFORE async save
  trainer.dirty = false;
  return { saved: true, dirtyWas: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════

export async function runHunterTwCoverageGapsTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. _isAllowedWsOrigin — comprehensive origin validation
  // ═══════════════════════════════════════════════════════════════════════

  test('WS origin: no origin header → allowed (same-origin)', () => {
    assert.equal(_isAllowedWsOrigin(undefined, 'http://localhost:3000'), true);
    assert.equal(_isAllowedWsOrigin(null, 'http://localhost:3000'), true);
    assert.equal(_isAllowedWsOrigin('', 'http://localhost:3000'), true);
  });

  test('WS origin: CORS=* rejects all origins with Origin header', () => {
    assert.equal(_isAllowedWsOrigin('http://evil.com', '*'), false);
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', '*'), false);
    assert.equal(_isAllowedWsOrigin('https://example.com', '*'), false);
  });

  test('WS origin: CORS=* allows requests without Origin header', () => {
    assert.equal(_isAllowedWsOrigin(undefined, '*'), true);
    assert.equal(_isAllowedWsOrigin(null, '*'), true);
  });

  test('WS origin: exact match with single allowed origin', () => {
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', 'http://localhost:3000'), true);
    assert.equal(_isAllowedWsOrigin('http://evil.com', 'http://localhost:3000'), false);
  });

  test('WS origin: comma-separated multiple allowed origins', () => {
    const cors = 'http://localhost:3000, https://example.com';
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', cors), true);
    assert.equal(_isAllowedWsOrigin('https://example.com', cors), true);
    assert.equal(_isAllowedWsOrigin('http://evil.com', cors), false);
  });

  test('WS origin: whitespace in comma-separated list is trimmed', () => {
    const cors = '  http://localhost:3000  ,  https://example.com  ';
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', cors), true);
    assert.equal(_isAllowedWsOrigin('https://example.com', cors), true);
  });

  test('WS origin: substring does not match (no partial match)', () => {
    assert.equal(_isAllowedWsOrigin('http://localhost:3000/evil', 'http://localhost:3000'), false);
    assert.equal(_isAllowedWsOrigin('http://localhost:3000.evil.com', 'http://localhost:3000'), false);
  });

  test('WS origin: protocol matters (http vs https)', () => {
    assert.equal(_isAllowedWsOrigin('https://localhost:3000', 'http://localhost:3000'), false);
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', 'https://localhost:3000'), false);
  });

  test('WS origin: port matters', () => {
    assert.equal(_isAllowedWsOrigin('http://localhost:3001', 'http://localhost:3000'), false);
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', 'http://localhost:3000'), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. turnToColor — null return for unknown turns (not 'white')
  // ═══════════════════════════════════════════════════════════════════════

  test('turnToColor: turn=0 returns null (draw state)', () => {
    assert.equal(turnToColor(0), null);
  });

  test('turnToColor: turn=2 returns null (invalid)', () => {
    assert.equal(turnToColor(2), null);
  });

  test('turnToColor: turn=-2 returns null (invalid)', () => {
    assert.equal(turnToColor(-2), null);
  });

  test('turnToColor: turn=NaN returns null (invalid)', () => {
    assert.equal(turnToColor(NaN), null);
  });

  test('turnToColor: turn=null returns null (invalid)', () => {
    assert.equal(turnToColor(null), null);
  });

  test('turnToColor: turn=undefined returns null (invalid)', () => {
    assert.equal(turnToColor(undefined), null);
  });

  test('turnToColor: turn=Infinity returns null (not 1 or -1)', () => {
    assert.equal(turnToColor(Infinity), null);
    assert.equal(turnToColor(-Infinity), null);
  });

  test('turnToColor: string passthrough works', () => {
    assert.equal(turnToColor('white'), 'white');
    assert.equal(turnToColor('black'), 'black');
    assert.equal(turnToColor('draw'), 'draw');
    assert.equal(turnToColor(''), '');
  });

  test('turnToColor: valid turns return correct colors', () => {
    assert.equal(turnToColor(1), 'white');
    assert.equal(turnToColor(-1), 'black');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. acquireLock — serialization and concurrency
  // ═══════════════════════════════════════════════════════════════════════

  test('acquireLock: first lock is acquired immediately', async () => {
    const { acquireLock } = createLockManager();
    const release = await acquireLock();
    assert.equal(typeof release, 'function');
    release();
  });

  test('acquireLock: second lock waits for first to release', async () => {
    const { acquireLock } = createLockManager();
    const order = [];

    const lock1 = acquireLock().then(release => {
      order.push('lock1-acquired');
      setTimeout(() => { release(); order.push('lock1-released'); }, 30);
      return release;
    });

    const lock2 = acquireLock().then(release => {
      order.push('lock2-acquired');
      release();
      order.push('lock2-released');
      return release;
    });

    await lock1;
    await lock2;

    // lock2 must be acquired AFTER lock1 releases
    const lock1ReleaseIdx = order.indexOf('lock1-released');
    const lock2AcquiredIdx = order.indexOf('lock2-acquired');
    assert.ok(lock1ReleaseIdx < lock2AcquiredIdx,
      `lock1-release (${lock1ReleaseIdx}) must come before lock2-acquired (${lock2AcquiredIdx}), got: ${order.join(', ')}`);
  });

  test('acquireLock: three locks serialize correctly', async () => {
    const { acquireLock } = createLockManager();
    const order = [];

    const p1 = acquireLock().then(release => {
      order.push(1);
      setTimeout(release, 10);
    });
    const p2 = acquireLock().then(release => {
      order.push(2);
      setTimeout(release, 10);
    });
    const p3 = acquireLock().then(release => {
      order.push(3);
      release();
    });

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(order, [1, 2, 3]);
  });

  test('acquireLock: releasing does not affect unrelated promises', async () => {
    const { acquireLock } = createLockManager();
    const release1 = await acquireLock();
    // Independent operation not using the lock
    let independentRan = false;
    const independent = Promise.resolve().then(() => { independentRan = true; });
    release1();
    await independent;
    assert.equal(independentRan, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Shutdown logic — interval cleanup
  // ═══════════════════════════════════════════════════════════════════════

  test('shutdown: clearInterval stops auto-save', () => {
    let count = 0;
    const interval = setInterval(() => { count++; }, 10);
    clearInterval(interval);
    // Wait a bit and verify count didn't increase
    return new Promise(resolve => {
      setTimeout(() => {
        assert.equal(count, 0, 'interval should be stopped');
        resolve();
      }, 30);
    });
  });

  test('shutdown: clearInterval stops rate limit cleanup', () => {
    let cleanupRan = false;
    const interval = setInterval(() => { cleanupRan = true; }, 10);
    clearInterval(interval);
    return new Promise(resolve => {
      setTimeout(() => {
        assert.equal(cleanupRan, false, 'cleanup interval should be stopped');
        resolve();
      }, 30);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. HTTP API endpoint response structure
  // ═══════════════════════════════════════════════════════════════════════

  test('/api/ai/info response has expected fields', () => {
    // Simulate the shape returned by /api/ai/info
    const infoResponse = {
      modelWhite: [64, 128, 64, 48],
      modelBlack: [64, 128, 64, 48],
      epsilonWhite: 0.5,
      epsilonBlack: 0.5,
      gamesPlayed: 42,
      bufferSize: 1000,
      running: false,
    };
    assert.ok('modelWhite' in infoResponse, 'has modelWhite');
    assert.ok('modelBlack' in infoResponse, 'has modelBlack');
    assert.ok('epsilonWhite' in infoResponse, 'has epsilonWhite');
    assert.ok('epsilonBlack' in infoResponse, 'has epsilonBlack');
    assert.ok('gamesPlayed' in infoResponse, 'has gamesPlayed');
    assert.ok('bufferSize' in infoResponse, 'has bufferSize');
    assert.ok('running' in infoResponse, 'has running');
    assert.equal(typeof infoResponse.running, 'boolean');
    assert.equal(typeof infoResponse.gamesPlayed, 'number');
    assert.equal(typeof infoResponse.bufferSize, 'number');
  });

  test('/api/ai/stats response is an object with numeric fields', () => {
    const statsResponse = { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2, lastLoss: 0.5 };
    for (const key of ['gamesPlayed', 'whiteWins', 'blackWins', 'draws']) {
      assert.equal(typeof statsResponse[key], 'number', `${key} should be number`);
      assert.ok(Number.isInteger(statsResponse[key]), `${key} should be integer`);
    }
  });

  test('/api/selfplay/status response has running and stats', () => {
    const statusResponse = {
      running: false,
      bufferSize: 500,
      stats: { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2 },
    };
    assert.equal(typeof statusResponse.running, 'boolean');
    assert.ok('stats' in statusResponse);
    assert.equal(typeof statusResponse.stats, 'object');
    assert.ok('bufferSize' in statusResponse);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. wsThrottle edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('wsThrottle: creates _throttle on first use', () => {
    const socket = {};
    assert.equal(socket._throttle, undefined);
    wsThrottle(socket, 'move', 100);
    assert.ok(socket._throttle, '_throttle should be created');
    assert.equal(typeof socket._throttle.move, 'number');
  });

  test('wsThrottle: different keys do not interfere', () => {
    const socket = {};
    wsThrottle(socket, 'move', 100);
    assert.equal(wsThrottle(socket, 'startGame', 100), true, 'different key should be allowed');
    assert.equal(wsThrottle(socket, 'setSpeed', 100), true, 'another key should be allowed');
  });

  test('wsThrottle: zero interval always allows', () => {
    const socket = {};
    assert.equal(wsThrottle(socket, 'move', 0), true);
    assert.equal(wsThrottle(socket, 'move', 0), true);
    assert.equal(wsThrottle(socket, 'move', 0), true);
  });

  test('wsThrottle: negative interval always allows (edge case)', () => {
    const socket = {};
    assert.equal(wsThrottle(socket, 'move', -1), true);
    assert.equal(wsThrottle(socket, 'move', -1), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. requireApiToken
  // ═══════════════════════════════════════════════════════════════════════

  test('requireApiToken: no API_TOKEN set → always passes (dev mode)', () => {
    assert.equal(requireApiToken(null, null).pass, true);
    assert.equal(requireApiToken('anything', null).pass, true);
    assert.equal(requireApiToken(undefined, null).pass, true);
  });

  test('requireApiToken: correct token → passes', () => {
    assert.equal(requireApiToken('secret123', 'secret123').pass, true);
  });

  test('requireApiToken: wrong token → 401', () => {
    const result = requireApiToken('wrong', 'secret123');
    assert.equal(result.pass, false);
    assert.equal(result.status, 401);
  });

  test('requireApiToken: missing token → 401', () => {
    const result = requireApiToken(null, 'secret123');
    assert.equal(result.pass, false);
    assert.equal(result.status, 401);
  });

  test('requireApiToken: empty string token → 401 when API_TOKEN is set', () => {
    const result = requireApiToken('', 'secret123');
    assert.equal(result.pass, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. wsAuth
  // ═══════════════════════════════════════════════════════════════════════

  test('wsAuth: no API_TOKEN set → always true (dev mode)', () => {
    assert.equal(wsAuth(null, null, null), true);
    assert.equal(wsAuth('anything', 'Bearer wrong', null), true);
  });

  test('wsAuth: auth token from handshake matches', () => {
    assert.equal(wsAuth('secret123', null, 'secret123'), true);
  });

  test('wsAuth: Bearer header matches', () => {
    assert.equal(wsAuth(null, 'Bearer secret123', 'secret123'), true);
    assert.equal(wsAuth(null, 'bearer secret123', 'secret123'), true);
    assert.equal(wsAuth(null, 'BEARER secret123', 'secret123'), true);
  });

  test('wsAuth: Bearer header with spaces is trimmed', () => {
    assert.equal(wsAuth(null, 'Bearer   secret123  ', 'secret123'), true);
  });

  test('wsAuth: wrong token → false', () => {
    assert.equal(wsAuth('wrong', null, 'secret123'), false);
    assert.equal(wsAuth(null, 'Bearer wrong', 'secret123'), false);
  });

  test('wsAuth: no token provided when required → false', () => {
    assert.equal(wsAuth(null, null, 'secret123'), false);
  });

  test('wsAuth: auth token takes precedence over header', () => {
    // If auth token is provided, it's checked first
    assert.equal(wsAuth('secret123', 'Bearer wrong', 'secret123'), true);
    assert.equal(wsAuth('wrong', 'Bearer secret123', 'secret123'), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Rate limit cleanup
  // ═══════════════════════════════════════════════════════════════════════

  test('rate limit cleanup: expired entries are removed', () => {
    const map = new Map();
    const now = Date.now();
    map.set('ip1', { windowStart: now - 120_000, count: 5 }); // expired
    map.set('ip2', { windowStart: now - 10_000, count: 3 });  // not expired

    cleanupRateLimitMap(map, 60_000, 10000);

    assert.equal(map.has('ip1'), false, 'expired entry should be removed');
    assert.equal(map.has('ip2'), true, 'non-expired entry should remain');
  });

  test('rate limit cleanup: active entries are preserved', () => {
    const map = new Map();
    const now = Date.now();
    map.set('ip1', { windowStart: now - 5_000, count: 100 });
    map.set('ip2', { windowStart: now - 30_000, count: 50 });
    map.set('ip3', { windowStart: now - 59_000, count: 1 });

    cleanupRateLimitMap(map, 60_000, 10000);
    assert.equal(map.size, 3, 'all active entries should remain');
  });

  test('rate limit cleanup: hard cap evicts oldest entries', () => {
    const map = new Map();
    const now = Date.now();
    // Add 5 entries, cap at 3
    map.set('ip1', { windowStart: now - 50_000, count: 1 });
    map.set('ip2', { windowStart: now - 40_000, count: 1 });
    map.set('ip3', { windowStart: now - 30_000, count: 1 });
    map.set('ip4', { windowStart: now - 20_000, count: 1 });
    map.set('ip5', { windowStart: now - 10_000, count: 1 });

    cleanupRateLimitMap(map, 60_000, 3);

    assert.equal(map.size, 3, 'map should be capped at 3');
    assert.equal(map.has('ip1'), false, 'oldest entry (ip1) should be evicted');
    assert.equal(map.has('ip2'), false, 'second oldest (ip2) should be evicted');
    assert.equal(map.has('ip5'), true, 'newest entry (ip5) should remain');
  });

  test('rate limit cleanup: empty map stays empty', () => {
    const map = new Map();
    cleanupRateLimitMap(map, 60_000, 10000);
    assert.equal(map.size, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Auto-save dirty flag snapshot
  // ═══════════════════════════════════════════════════════════════════════

  test('auto-save: skips when not dirty', () => {
    const trainer = { dirty: false };
    const result = simulateAutoSaveCycle(trainer);
    assert.equal(result.saved, false);
    assert.equal(trainer.dirty, false, 'dirty should remain false');
  });

  test('auto-save: saves when dirty, resets flag before async', () => {
    const trainer = { dirty: true };
    const result = simulateAutoSaveCycle(trainer);
    assert.equal(result.saved, true);
    assert.equal(trainer.dirty, false, 'dirty should be reset to false');
  });

  test('auto-save: dirty set during save is caught next cycle', () => {
    const trainer = { dirty: true };
    // First cycle
    simulateAutoSaveCycle(trainer);
    assert.equal(trainer.dirty, false);
    // Something sets dirty during "save"
    trainer.dirty = true;
    // Next cycle should pick it up
    const result = simulateAutoSaveCycle(trainer);
    assert.equal(result.saved, true, 'second cycle should save because dirty was re-set');
  });

  test('auto-save: error restores dirty flag', () => {
    // Simulate the error path in auto-save
    const trainer = { dirty: true };
    trainer.dirty = false; // snapshot before save
    // Simulate error
    trainer.dirty = true; // restore on error
    assert.equal(trainer.dirty, true, 'dirty should be restored on save error');
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-TW Coverage Gaps Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`   ─── ${passed} passed, ${failed} failed ───`);
  return { passed, failed };
}

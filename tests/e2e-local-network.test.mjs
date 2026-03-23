/**
 * E2E test for local network deployment (192.168.50.202:3000)
 * Run: npx playwright test tests/e2e-local-network.test.mjs
 * Env: TEST_BASE_URL=http://192.168.50.202:3000
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

test.describe('Local network deployment smoke', () => {
  test('page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const res = await page.goto(BASE_URL, { timeout: 15000 });
    expect(res.status()).toBeLessThan(400);

    await page.waitForSelector('[class*="board"]', { timeout: 10000 });
    const cells = await page.$$('[class*="cell"]');
    expect(cells.length).toBe(64);

    const critical = errors.filter(e => !e.includes('favicon'));
    expect(critical).toHaveLength(0);
  });

  test('API /api/status returns ready', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/api/status`, { timeout: 10000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
  });

  test('WebSocket connects', async ({ page }) => {
    let wsOpened = false;
    page.on('websocket', ws => { wsOpened = true; });
    await page.goto(BASE_URL, { timeout: 15000 });
    await page.waitForTimeout(2000);
    expect(wsOpened).toBe(true);
  });
});

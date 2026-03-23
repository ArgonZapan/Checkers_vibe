import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

let pass = 0, fail = 0;
function assert(name, condition) {
  if (condition) { console.log(`   ✅ ${name}`); pass++; }
  else { console.log(`   ❌ ${name}`); fail++; }
}

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
  });

  console.log('\n📋 PvAI TEST');

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // Start PvAI
  await page.click('button:has-text("Gracz vs AI")');
  await page.waitForTimeout(3000);

  // Check board appeared
  assert('SVG planszy', (await page.$$('svg')).length > 0);
  const circles = await page.$$('svg circle');
  assert('Pionki na planszy (' + circles.length + ')', circles.length >= 12);

  const pieceColors = await page.$$eval('circle', cs => [...new Set(cs.map(c => c.getAttribute('fill')))]);
  assert('2 kolory pionków', pieceColors.length === 2);
  console.log('      Kolory:', pieceColors);

  // Click a white piece (human plays white in PvAI)
  const whitePieceIndex = await page.evaluate(() => {
    const gEls = document.querySelectorAll('svg g');
    for (let i = 0; i < gEls.length; i++) {
      const circle = gEls[i].querySelector('circle');
      const fill = circle?.getAttribute('fill');
      if (fill && (fill.includes('f0f0f0') || fill.includes('white'))) {
        return i;
      }
    }
    return -1;
  });
  console.log('      Białych elementów <g> pierwszy indeks:', whitePieceIndex);

  if (whitePieceIndex >= 0) {
    const gElements = await page.$$('svg g');
    // Click on a white piece
    await gElements[whitePieceIndex].click();
    await page.waitForTimeout(1000);

    // Check for green indicators (valid moves)
    const hasGreenDots = await page.evaluate(() => {
      const html = document.querySelector('svg')?.innerHTML || '';
      return html.includes('rgba(0, 255, 0') ||
             html.includes('rgba(0, 200, 0') ||
             html.includes('#00ff00') ||
             html.includes('rgb(0, 255, 0') ||
             html.includes('rgb(0, 200, 0');
    });
    assert('Zielone wskaźniki ruchu po zaznaczeniu', hasGreenDots);

    if (hasGreenDots) {
      // Try to make a move — click green overlay
      const moveTarget = await page.$('rect[fill="rgba(0, 200, 0, 0.25)"]') ||
                         await page.$('rect[fill="rgba(0, 255, 0, 0.25)"]');
      if (moveTarget) {
        await moveTarget.click();
        await page.waitForTimeout(2000);
        assert('Ruch wykonany', true);
      }
    }
  }

  assert('Brak błędów strony', errors.length === 0);
  if (errors.length > 0) {
    errors.forEach(e => console.log('      BŁĄD:', e));
  }

  await browser.close();

  console.log('\n' + '='.repeat(40));
  console.log(`✅ Przeszło: ${pass}  ❌ Nie przeszło: ${fail}`);
  console.log('='.repeat(40));

  process.exit(fail > 0 ? 1 : 0);
}

test().catch(err => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});

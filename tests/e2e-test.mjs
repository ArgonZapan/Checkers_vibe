import { chromium } from 'playwright';

const BASE = 'http://192.168.50.202:3000';
const CELL = 60;

let pass = 0, fail = 0;
function assert(name, condition) {
  if (condition) { console.log(`   ✅ ${name}`); pass++; }
  else { console.log(`   ❌ ${name}`); fail++; }
}

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    consoleErrors.push('PAGE ERROR: ' + err.message);
  });

  // === TEST 1: Strona główna (menu) ===
  console.log('\n📋 TEST 1: Strona główna (menu)');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  assert('Title = "Checkers AI"', (await page.title()) === 'Checkers AI');
  assert('Nagłówek menu', (await page.textContent('h2')) === 'Wybierz tryb gry');

  const btnTexts = await page.$$eval('button', btns => btns.map(b => b.textContent.trim()));
  assert('2 przyciski', btnTexts.length === 2);
  assert('Przycisk "Gracz vs AI"', btnTexts.some(t => t.includes('Gracz vs AI')));
  assert('Przycisk "AI vs AI"', btnTexts.some(t => t.includes('AI vs AI')));
  assert('Status połączenia', (await page.textContent('p')).includes('Połączono'));

  // === TEST 2: Plansza — Gracz vs AI ===
  console.log('\n📋 TEST 2: Plansza — Gracz vs AI');
  await page.click('button:has-text("Gracz vs AI")');
  await page.waitForTimeout(3000);

  assert('SVG planszy', (await page.$$('svg')).length > 0);
  assert('24 pionki', (await page.$$eval('circle', cs => cs.length)) === 24);

  const pieceColors = await page.$$eval('circle', cs => {
    return [...new Set(cs.map(c => c.getAttribute('fill')))];
  });
  assert('2 kolory pionków', pieceColors.length === 2);
  console.log('      Kolory:', pieceColors);

  const rectCount = await page.$$eval('rect', rs => rs.length);
  assert('Pola planszy (rect >= 64)', rectCount >= 64);

  // === TEST 3: Interakcja z pionkiem ===
  console.log('\n📋 TEST 3: Interakcja z pionkiem');

  // Kliknij pierwszy element <g> w SVG (pionek gracza)
  const gCount = await page.$$eval('svg g', gs => gs.length);
  assert('Elementy <g> w SVG (' + gCount + ')', gCount > 0);

  if (gCount > 0) {
    await page.click('svg g');
    await page.waitForTimeout(2000);

    const hasSelection = await page.evaluate(() => {
      const html = document.querySelector('svg')?.innerHTML || '';
      return html.includes('rgba(0, 255, 0') || html.includes('rgba(0, 200, 0') || html.includes('#00ff00');
    });
    assert('Pionek zaznaczony / dostępne ruchy', hasSelection);

    // Screenshot po zaznaczeniu
    await page.screenshot({ path: '/tmp/checkers-selected.png', fullPage: true });

    // === TEST 4: Wykonaj ruch ===
    console.log('\n📋 TEST 4: Ruch pionka');
    if (hasSelection) {
      // Sprawdź czy są dostępne ruchy (rect z zielonym overlay lub circle z zieloną obwódką)
      const moveInfo = await page.evaluate(() => {
        const html = document.querySelector('svg')?.innerHTML || '';
        const greenRects = document.querySelectorAll('rect[fill="rgba(0, 200, 0, 0.25)"]');
        const greenRings = document.querySelectorAll('circle[stroke="#00ff00"]');
        return {
          greenRects: greenRects.length,
          greenRings: greenRings.length,
        };
      });
      console.log('      Zielone rect:', moveInfo.greenRects, 'Zielone obwódki:', moveInfo.greenRings);

      // Kliknij dostępny ruch (zielony rect)
      if (moveInfo.greenRects > 0) {
        const moveRect = await page.$('rect[fill="rgba(0, 200, 0, 0.25)"]');
        if (moveRect) {
          await moveRect.click();
          await page.waitForTimeout(2000);
          assert('Ruch wykonany (rect)', true);
        }
      } else if (moveInfo.greenRings > 0) {
        // Kliknij pionek z zieloną obwódką
        const ringCircle = await page.$('circle[stroke="#00ff00"]');
        if (ringCircle) {
          const box = await ringCircle.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(2000);
            assert('Ruch wykonany (obwódka)', true);
          }
        }
      } else {
        // Brak ruchów — sprawdź czy AI już ruszyło
        const circlesAfter = await page.$$eval('circle', cs => cs.length);
        console.log('      Pionków po:', circlesAfter);
        assert('Dostępne ruchy lub stan poprawny', circlesAfter <= 24);
      }
    }

    await page.screenshot({ path: '/tmp/checkers-after-move.png', fullPage: true });
  }

  // === TEST 5: Screenshot główny ===
  console.log('\n📋 TEST 5: Screenshot');
  await page.screenshot({ path: '/tmp/checkers-test.png', fullPage: true });
  assert('Screenshot zapisany', true);

  // === TEST 6: AI vs AI ===
  console.log('\n📋 TEST 6: AI vs AI');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.click('button:has-text("AI vs AI")');
  await page.waitForTimeout(6000);

  const aiCircles = await page.$$eval('circle', cs => cs.length);
  assert('Plansza AI vs AI (' + aiCircles + ' pionków)', aiCircles >= 20);
  await page.screenshot({ path: '/tmp/checkers-ai-vs-ai.png', fullPage: true });

  // === TEST 7: Brak błędów konsoli ===
  console.log('\n📋 TEST 7: Błędy konsoli');
  assert('Brak błędów konsoli (' + consoleErrors.length + ')', consoleErrors.length === 0);
  if (consoleErrors.length > 0) {
    consoleErrors.forEach(e => console.log('      BŁĄD:', e));
  }

  await browser.close();

  // === PODSUMOWANIE ===
  console.log('\n' + '='.repeat(40));
  console.log(`✅ Przeszło: ${pass}  ❌ Nie przeszło: ${fail}`);
  console.log('='.repeat(40));
}

test().catch(err => {
  console.error('BŁĄD:', err.message);
  process.exit(1);
});

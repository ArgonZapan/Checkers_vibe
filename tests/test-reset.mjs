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
  let errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
  });

  // ============================================================
  // SCENARIUSZ 1: Reset z menu — przycisk NIE powinien istnieć
  // ============================================================
  console.log('\n=== Scenariusz 1: Reset z menu ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  
  const bodyText = await page.textContent('body');
  assert('Menu widoczne ("Wybierz tryb")', bodyText.includes('Wybierz tryb'));
  
  const resetInMenu = await page.$('button:has-text("Reset")');
  assert('Brak przycisku Reset w menu', resetInMenu === null);
  
  await page.screenshot({ path: '/tmp/reset-scenario1.png' });

  // ============================================================
  // SCENARIUSZ 2: Reset po PvAI
  // ============================================================
  console.log('\n=== Scenariusz 2: Reset po PvAI ===');
  await page.click('button:has-text("Gracz vs AI")');
  await page.waitForTimeout(2000);
  
  let txt = await page.textContent('body');
  assert('Plansza widoczna (brak "Wybierz tryb")', !txt.includes('Wybierz tryb'));
  
  const resetBtn = await page.$('button:has-text("Reset")');
  assert('Przycisk Reset istnieje w grze', resetBtn !== null);
  
  const svgExists = (await page.$$('svg')).length > 0;
  assert('SVG planszy obecne', svgExists);
  
  const circles = await page.$$('svg circle');
  assert('Pionki na planszy (' + circles.length + ')', circles.length >= 12);
  
  // Kliknij białego pionka — re-query po każdym kliknięciu bo DOM się zmienia
  let clickedPiece = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const gEls2 = await page.$$('svg g');
    if (gEls2.length === 0) break;
    const idx = gEls2.length - 1 - attempt;
    if (idx < 0) break;
    await gEls2[idx].click();
    await page.waitForTimeout(500);
    
    const hasGreen = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return false;
      return svg.innerHTML.includes('rgba(0, 200, 0') ||
             svg.innerHTML.includes('rgba(0, 255, 0');
    });
    
    if (hasGreen) {
      console.log('   Zaznaczono pionek (zielone wskaźniki)');
      clickedPiece = true;
      
      // Kliknij zieloną kropkę (ruch) — re-query bo DOM się zmienił
      const moveTarget = await page.$('rect[fill="rgba(0, 200, 0, 0.25)"]') ||
                         await page.$('rect[fill="rgba(0, 255, 0, 0.25)"]');
      if (moveTarget) {
        await moveTarget.click();
        await page.waitForTimeout(2000);
        console.log('   Wykonano ruch');
      }
      break;
    }
  }
  assert('Udało się zaznaczyć i ruszyć pionkiem', clickedPiece);
  
  // Poczekaj na ruch AI
  await page.waitForTimeout(2000);
  
  // Kliknij Reset
  await page.click('button:has-text("Reset")');
  await page.waitForTimeout(1000);
  
  txt = await page.textContent('body');
  assert('Wrócił do menu po Reset', txt.includes('Wybierz tryb'));
  
  await page.screenshot({ path: '/tmp/reset-scenario2.png' });

  // ============================================================
  // SCENARIUSZ 3: Reset po AI vs AI
  // ============================================================
  console.log('\n=== Scenariusz 3: Reset po AI vs AI ===');
  await page.click('button:has-text("AI vs AI")');
  await page.waitForTimeout(5000);
  
  txt = await page.textContent('body');
  assert('AI vs AI aktywne (brak menu)', !txt.includes('Wybierz tryb'));
  
  // Sprawdź czy self-play działa (status powinien być widoczny)
  const hasTurnOrStatus = txt.includes('Tura:') || txt.includes('wygrywają') || txt.includes('Remis');
  assert('Status gry widoczny', hasTurnOrStatus);
  
  // Kliknij Reset
  await page.click('button:has-text("Reset")');
  await page.waitForTimeout(1000);
  
  txt = await page.textContent('body');
  assert('Wrócił do menu po AI vs AI Reset', txt.includes('Wybierz tryb'));
  
  // Sprawdź czy nie ma już elementów gry
  const svgAfterReset = await page.$$('svg');
  assert('Brak SVG po Reset', svgAfterReset.length === 0);
  
  await page.screenshot({ path: '/tmp/reset-scenario3.png' });

  // ============================================================
  // SCENARIUSZ 4: Reset w trakcie zaznaczenia pionka
  // ============================================================
  console.log('\n=== Scenariuszz 4: Reset po zaznaczeniu ===');
  await page.click('button:has-text("Gracz vs AI")');
  await page.waitForTimeout(2000);
  
  // Zaznacz pionek — re-query po każdym kliknięciu
  let selectedPiece = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const gEls = await page.$$('svg g');
    if (gEls.length === 0) break;
    const idx = gEls.length - 1 - attempt;
    if (idx < 0) break;
    await gEls[idx].click();
    await page.waitForTimeout(400);
    
    const hasGreen = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return false;
      return svg.innerHTML.includes('rgba(0, 200, 0') ||
             svg.innerHTML.includes('rgba(0, 255, 0');
    });
    
    if (hasGreen) {
      console.log('   Pionek zaznaczony');
      selectedPiece = true;
      break;
    }
  }
  assert('Pionek zaznaczony przed Reset', selectedPiece);
  
  // BEZ klikania ruchu — Reset
  await page.click('button:has-text("Reset")');
  await page.waitForTimeout(1000);
  
  txt = await page.textContent('body');
  assert('Wrócił do menu po zaznaczeniu', txt.includes('Wybierz tryb'));
  
  await page.screenshot({ path: '/tmp/reset-scenario4.png' });

  // ============================================================
  // SCENARIUSZ 5: Reset po game over (AI vs AI do końca)
  // ============================================================
  console.log('\n=== Scenariusz 5: Reset po game over ===');
  // Uruchom AI vs AI i poczekaj na game over
  await page.click('button:has-text("AI vs AI")');
  await page.waitForTimeout(3000);
  
  txt = await page.textContent('body');
  assert('AI vs AI rozpoczęte', !txt.includes('Wybierz tryb'));
  
  // Czekaj max 120s na game over
  let gameOverReached = false;
  for (let i = 0; i < 24; i++) {  // 24 * 5s = 120s
    await page.waitForTimeout(5000);
    txt = await page.textContent('body');
    if (txt.includes('wygrywają') || txt.includes('Remis')) {
      gameOverReached = true;
      console.log('   Game over osiągnięty po ~' + ((i+1)*5) + 's');
      break;
    }
  }
  
  if (gameOverReached) {
    assert('Game over wykryty', true);
    
    // Kliknij Reset po game over
    await page.click('button:has-text("Reset")');
    await page.waitForTimeout(1000);
    
    txt = await page.textContent('body');
    assert('Wrócił do menu po game over', txt.includes('Wybierz tryb'));
  } else {
    console.log('   ⚠️ Game over nie osiągnięty w 120s — pomijam');
    assert('Game over osiągnięty w czasie', false);
    
    // Mimo to spróbuj reset
    const resetAvail = await page.$('button:has-text("Reset")');
    if (resetAvail) {
      await resetAvail.click();
      await page.waitForTimeout(1000);
      txt = await page.textContent('body');
      console.log('   Reset mimo braku game over:', txt.includes('Wybierz tryb'));
    }
  }
  
  await page.screenshot({ path: '/tmp/reset-scenario5.png' });

  // ============================================================
  // PODSUMOWANIE
  // ============================================================
  console.log('\n=== Błędy JS:', errors.length, '===');
  errors.forEach(e => console.log('   ', e));
  
  await page.screenshot({ path: '/tmp/reset-test-final.png' });
  await browser.close();
  
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Przeszło: ${pass}  ❌ Nie przeszło: ${fail}`);
  console.log('='.repeat(50));
  
  if (fail > 0) process.exit(1);
}

test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

import { chromium } from 'playwright';

const BASE = 'http://192.168.50.202:3000';

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

  console.log('\n📋 AI vs AI TEST');

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // Start AI vs AI
  await page.click('button:has-text("AI vs AI")');
  await page.waitForTimeout(6000); // wait for moves

  // Check pieces
  const circles = await page.$$('svg circle');
  assert('Plansza ma pionki (' + circles.length + ')', circles.length > 0);
  assert('Pionków ≤ 24', circles.length <= 24);

  // Check dashboard / stats visible
  const bodyText = await page.textContent('body');
  const hasDashboard = bodyText.includes('Dashboard') ||
                       bodyText.includes('Statystyki') ||
                       bodyText.includes('Parametry') ||
                       bodyText.includes('Ruch') ||
                       bodyText.includes('Czas') ||
                       bodyText.includes('Głębokość');
  assert('Dashboard / statystyki widoczne', hasDashboard);

  if (!hasDashboard) {
    console.log('      Fragment body:', bodyText.substring(0, 500));
  }

  // Check that game progressed (captures or moves)
  const svgHtml = await page.$eval('svg', el => el.innerHTML);
  const hasDarkPieces = svgHtml.includes('fill="#8b0000"') || svgHtml.includes('fill="red"') || svgHtml.includes('fill="#2a2a2a"');
  const hasLightPieces = svgHtml.includes('fill="#ffffff"') || svgHtml.includes('fill="white"') || svgHtml.includes('fill="#f0f0f0"');
  assert('Są ciemne pionki', hasDarkPieces);
  assert('Są jasne pionki', hasLightPieces);

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

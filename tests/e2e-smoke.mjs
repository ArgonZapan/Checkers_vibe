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

  console.log('\n📋 SMOKE TEST');

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  const title = await page.title();
  assert('Title = "Checkers AI"', title === 'Checkers AI');

  const body = await page.textContent('body');
  assert('Połączono / Connected', body.includes('Połączono') || body.includes('Connected'));

  const btns = await page.$$eval('button', bs => bs.map(b => b.textContent.trim()));
  assert('Przycisk "Gracz vs AI"', btns.some(t => t.includes('Gracz vs AI')));
  assert('Przycisk "AI vs AI"', btns.some(t => t.includes('AI vs AI')));

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

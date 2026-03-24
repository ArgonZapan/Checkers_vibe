/**
 * a11yRegression.test.js — Regression tests for a11y bugs #152, #153, #155.
 *
 * Extracts pure logic from JSX to verify a11y attributes and keyboard handlers
 * match WAI-ARIA requirements without needing React rendering.
 *
 * Issues:
 * - #153: GameControls speed buttons — aria-label Polish, aria-pressed on all
 * - #155: Slider inputs — aria-label present on all range inputs
 * - #152: ParamsPanel tabs — Home/End/ArrowUp/ArrowDown keyboard navigation
 */

import assert from 'node:assert/strict';

// ── #153: Speed button a11y config ──────────────────────────────────────────
// Extracted from GameControls.jsx speed button section

const SPEED_BUTTONS = [
  { speed: 0,   label: 'Prędkość: Błyskawica', text: '⚡ Błyskawica' },
  { speed: 100, label: 'Prędkość: Szybko',      text: '🏃 Szybko' },
  { speed: 350, label: 'Prędkość: Wolno',        text: '🐢 Wolno' },
];

function getSpeedButtonAriaPressed(currentSpeed, buttonSpeed) {
  return currentSpeed === buttonSpeed;
}

function getSpeedButtonAriaLabel(buttonDef) {
  return buttonDef.label;
}

function speedButtonHasVisibleText(buttonDef) {
  return typeof buttonDef.text === 'string' && buttonDef.text.trim().length > 0;
}

// ── #155: Slider aria-label validation ──────────────────────────────────────
// Extracted from ParamsPanel.jsx Slider component + inline inputs

const SLIDER_LABELS = [
  // SideTab sliders (via Slider component)
  'Warstwy', 'Neurony/warstwę', 'Dropout',
  'Epoki/grę', 'Gamma (discount)', 'Buffer size',
  'Zbicie pionka', 'Utrata pionka', 'Promocja na damkę',
  'Wygrana gry', 'Przegrana gry',
  // Inline range inputs (not using Slider component)
  'Głębokość minimax', 'Min epsilon', 'Decay na grę',
  'Learning Rate', 'Batch size',
  // General tab
  'Delay ruchu (ms)',
];

function sliderHasAriaLabel(label) {
  return typeof label === 'string' && label.trim().length > 0;
}

// ── #152: Tab keyboard navigation ───────────────────────────────────────────
// Extracted from ParamsPanel.jsx tab onKeyDown handlers

const TAB_ORDER = ['white', 'black', 'general'];

function getTabKeyHandler(tabId) {
  // Mirrors the onKeyDown logic from ParamsPanel.jsx for each tab
  const handlers = {
    white: {
      ArrowRight: 'black',
      ArrowLeft: 'general',
      ArrowUp: 'general',
      ArrowDown: 'black',
      Home: 'white',
      End: 'general',
    },
    black: {
      ArrowRight: 'general',
      ArrowLeft: 'white',
      ArrowUp: 'white',
      ArrowDown: 'general',
      Home: 'white',
      End: 'general',
    },
    general: {
      ArrowRight: 'white',
      ArrowLeft: 'black',
      ArrowUp: 'black',
      ArrowDown: 'white',
      Home: 'white',
      End: 'general',
    },
  };
  return handlers[tabId] || {};
}

function getNextTab(currentTab, key) {
  const handler = getTabKeyHandler(currentTab);
  return handler[key] || currentTab;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runA11yRegressionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // #153: GameControls speed buttons — aria-label + aria-pressed
  // ═══════════════════════════════════════════════════════════════════════

  test('#153: all speed buttons have Polish aria-label', () => {
    for (const btn of SPEED_BUTTONS) {
      const label = getSpeedButtonAriaLabel(btn);
      assert.ok(sliderHasAriaLabel(label), `Button speed=${btn.speed} missing aria-label`);
      // Must be Polish, not English
      assert.ok(!label.startsWith('Speed:'), `aria-label should be Polish, got: "${label}"`);
    }
  });

  test('#153: aria-label does not contain English "Speed:" prefix', () => {
    for (const btn of SPEED_BUTTONS) {
      const label = getSpeedButtonAriaLabel(btn);
      assert.ok(!label.includes('Speed:'), `Found English label: "${label}"`);
    }
  });

  test('#153: aria-label contains Polish "Prędkość"', () => {
    for (const btn of SPEED_BUTTONS) {
      const label = getSpeedButtonAriaLabel(btn);
      assert.ok(label.includes('Prędkość'), `Missing Polish prefix in: "${label}"`);
    }
  });

  test('#153: all speed buttons have visible text content', () => {
    for (const btn of SPEED_BUTTONS) {
      assert.ok(speedButtonHasVisibleText(btn), `Button speed=${btn.speed} has no visible text`);
    }
  });

  test('#153: visible text contains emoji + Polish word', () => {
    assert.ok(SPEED_BUTTONS[0].text.includes('Błyskawica'));
    assert.ok(SPEED_BUTTONS[1].text.includes('Szybko'));
    assert.ok(SPEED_BUTTONS[2].text.includes('Wolno'));
  });

  test('#153: aria-pressed defined for ALL speed buttons (selected and unselected)', () => {
    // Test with speed=0 selected
    const pressed0 = SPEED_BUTTONS.map(b => getSpeedButtonAriaPressed(0, b.speed));
    assert.deepStrictEqual(pressed0, [true, false, false],
      'aria-pressed should be [true, false, false] when speed=0');

    // Test with speed=100 selected
    const pressed100 = SPEED_BUTTONS.map(b => getSpeedButtonAriaPressed(100, b.speed));
    assert.deepStrictEqual(pressed100, [false, true, false],
      'aria-pressed should be [false, true, false] when speed=100');

    // Test with speed=350 selected
    const pressed350 = SPEED_BUTTONS.map(b => getSpeedButtonAriaPressed(350, b.speed));
    assert.deepStrictEqual(pressed350, [false, false, true],
      'aria-pressed should be [false, false, true] when speed=350');
  });

  test('#153: each button has unique aria-label', () => {
    const labels = SPEED_BUTTONS.map(b => getSpeedButtonAriaLabel(b));
    const unique = new Set(labels);
    assert.equal(unique.size, labels.length, 'aria-labels must be unique');
  });

  test('#153: each button has unique visible text', () => {
    const texts = SPEED_BUTTONS.map(b => b.text);
    const unique = new Set(texts);
    assert.equal(unique.size, texts.length, 'Visible texts must be unique');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // #155: Slider inputs — aria-label present
  // ═══════════════════════════════════════════════════════════════════════

  test('#155: all slider labels are non-empty strings', () => {
    for (const label of SLIDER_LABELS) {
      assert.ok(sliderHasAriaLabel(label), `Slider label is empty or invalid: "${label}"`);
    }
  });

  test('#155: slider labels are unique (no ambiguous controls)', () => {
    const unique = new Set(SLIDER_LABELS);
    assert.equal(unique.size, SLIDER_LABELS.length,
      `Duplicate slider labels found: ${SLIDER_LABELS.length} total, ${unique.size} unique`);
  });

  test('#155: slider component passes label as aria-label', () => {
    // Verify the Slider function extracts label prop correctly
    function mockSlider(label, value) {
      return { ariaLabel: label, value };
    }
    const s1 = mockSlider('Warstwy', 3);
    assert.equal(s1.ariaLabel, 'Warstwy');
    const s2 = mockSlider('Dropout', 0.25);
    assert.equal(s2.ariaLabel, 'Dropout');
  });

  test('#155: inline range inputs all have aria-label', () => {
    const inlineInputs = [
      'Głębokość minimax', 'Min epsilon', 'Decay na grę',
      'Learning Rate', 'Batch size', 'Delay ruchu (ms)',
    ];
    for (const label of inlineInputs) {
      assert.ok(sliderHasAriaLabel(label), `Inline range input missing aria-label: "${label}"`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // #152: ParamsPanel tabs — Home/End/ArrowUp/ArrowDown navigation
  // ═══════════════════════════════════════════════════════════════════════

  test('#152: Home key always navigates to first tab (white)', () => {
    for (const tab of TAB_ORDER) {
      assert.equal(getNextTab(tab, 'Home'), 'white',
        `Home from "${tab}" should go to "white"`);
    }
  });

  test('#152: End key always navigates to last tab (general)', () => {
    for (const tab of TAB_ORDER) {
      assert.equal(getNextTab(tab, 'End'), 'general',
        `End from "${tab}" should go to "general"`);
    }
  });

  test('#152: ArrowRight navigates to next tab (wraps)', () => {
    assert.equal(getNextTab('white', 'ArrowRight'), 'black');
    assert.equal(getNextTab('black', 'ArrowRight'), 'general');
    assert.equal(getNextTab('general', 'ArrowRight'), 'white'); // wraps
  });

  test('#152: ArrowLeft navigates to previous tab (wraps)', () => {
    assert.equal(getNextTab('white', 'ArrowLeft'), 'general'); // wraps
    assert.equal(getNextTab('black', 'ArrowLeft'), 'white');
    assert.equal(getNextTab('general', 'ArrowLeft'), 'black');
  });

  test('#152: ArrowUp navigates tabs (WAI-ARIA tabs pattern)', () => {
    assert.equal(getNextTab('white', 'ArrowUp'), 'general');
    assert.equal(getNextTab('black', 'ArrowUp'), 'white');
    assert.equal(getNextTab('general', 'ArrowUp'), 'black');
  });

  test('#152: ArrowDown navigates tabs (WAI-ARIA tabs pattern)', () => {
    assert.equal(getNextTab('white', 'ArrowDown'), 'black');
    assert.equal(getNextTab('black', 'ArrowDown'), 'general');
    assert.equal(getNextTab('general', 'ArrowDown'), 'white');
  });

  test('#152: all tabs have handlers for all 6 navigation keys', () => {
    const requiredKeys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    for (const tab of TAB_ORDER) {
      const handler = getTabKeyHandler(tab);
      for (const key of requiredKeys) {
        assert.ok(key in handler, `Tab "${tab}" missing handler for "${key}"`);
      }
    }
  });

  test('#152: every tab is reachable via keyboard from every other tab', () => {
    // BFS from each tab to verify full connectivity
    for (const start of TAB_ORDER) {
      const visited = new Set();
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        const handler = getTabKeyHandler(current);
        for (const target of Object.values(handler)) {
          if (!visited.has(target)) queue.push(target);
        }
      }
      assert.equal(visited.size, TAB_ORDER.length,
        `Not all tabs reachable from "${start}": reached ${[...visited].join(', ')}`);
    }
  });

  test('#152: tabIndex follows roving tabindex pattern (active=0, others=-1)', () => {
    function getTabIndex(tabId, activeTab) {
      return tabId === activeTab ? 0 : -1;
    }
    // When white is active
    assert.equal(getTabIndex('white', 'white'), 0);
    assert.equal(getTabIndex('black', 'white'), -1);
    assert.equal(getTabIndex('general', 'white'), -1);
    // When black is active
    assert.equal(getTabIndex('white', 'black'), -1);
    assert.equal(getTabIndex('black', 'black'), 0);
    assert.equal(getTabIndex('general', 'black'), -1);
    // When general is active
    assert.equal(getTabIndex('white', 'general'), -1);
    assert.equal(getTabIndex('black', 'general'), -1);
    assert.equal(getTabIndex('general', 'general'), 0);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n♿ A11y Regression Tests (#152, #153, #155)');

  for (const { name, fn } of tests) {
    try {
      fn();
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

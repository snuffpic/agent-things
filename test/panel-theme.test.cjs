'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/session-status.js'), 'utf8');
const position = source.slice(source.indexOf('  function positionPanel()'), source.indexOf('  function updateDraft('));

function fixture(background) {
  const page = { backgroundColor: background, parentElement: null };
  const row = { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(230, 230, 230)', parentElement: page };
  const attributes = new Map();
  const panel = {
    entry: { row, host: { getBoundingClientRect: () => ({ right: 100, top: 100 }) } },
    root: { getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) },
    shell: { style: {}, getBoundingClientRect: () => ({ width: 340, height: 500 }) },
  };
  const context = { panel, embedded: null, getComputedStyle: node => node, innerWidth: 1000, innerHeight: 1000, matchMedia: () => ({ matches: false }) };
  vm.createContext(context);
  return { row, page, attributes, position: () => vm.runInContext(`${position}\npositionPanel()`, context) };
}
test('inactive window foreground does not change a dark panel to light', () => {
  const f = fixture('rgb(25, 25, 25)');
  f.position();
  assert.equal(f.attributes.get('data-color-mode'), 'dark');
  f.row.color = 'rgb(120, 120, 120)';
  f.position();
  assert.equal(f.attributes.get('data-color-mode'), 'dark');
});
test('panel follows an actual page theme change and preserves it across transparent frames', () => {
  const f = fixture('rgb(25, 25, 25)');
  f.position();
  f.page.backgroundColor = 'rgb(255, 255, 255)';
  f.position();
  assert.equal(f.attributes.get('data-color-mode'), 'light');
  f.page.backgroundColor = 'rgba(0, 0, 0, 0)';
  f.position();
  assert.equal(f.attributes.get('data-color-mode'), 'light');
});

test('light-mode flash prevention invariants across Codex, Antigravity, and Claude card sources', () => {
  // 1. session-status.js: detached root with data-color-mode set before append + no .shell background fade + light @media fallback
  const openPanelStart = source.indexOf('  function openPanel(entry)');
  const openPanelHead = source.slice(openPanelStart, openPanelStart + 700);
  assert.ok(!/\.shell\{[^}]*transition:background-color/.test(openPanelHead), '.shell must not transition background-color from initial dark default');
  assert.ok(openPanelHead.includes('detectPanelColorMode(entry)'), 'openPanel must detect color mode before appending root');
  assert.ok(openPanelHead.includes("root.setAttribute('data-color-mode', initialMode)"), 'openPanel must assign data-color-mode immediately on root');
  assert.ok(source.includes('@media(prefers-color-scheme:light){'), 'session-status.js provides light @media fallback');

  // 2. Codex MCP card shell has adaptive color-scheme before mount
  const codexCardSrc = fs.readFileSync(path.join(__dirname, '../src/harnesses/codex/codex-card.cjs'), 'utf8');
  assert.ok(codexCardSrc.includes('color-scheme:light dark;color:light-dark('));

  // 3. Antigravity things_board: fixes --at-panel-bg typo, runs syncThemeWithHost synchronously in <head>, and falls back to matchMedia when --background is empty
  const boardHtml = fs.readFileSync(path.join(__dirname, '../src/plugins/things/sidecars/things_board/index.html'), 'utf8');
  const headHtml = boardHtml.slice(0, boardHtml.indexOf('</head>'));
  assert.ok(headHtml.includes('--at-panel-bg: #ffffff;'));
  assert.ok(!/@media \(prefers-color-scheme: light\)[\s\S]*?--panel-bg:/.test(headHtml), 'things_board light @media must set --at-panel-bg rather than --panel-bg');
  assert.ok(headHtml.includes('syncThemeWithHost();'), 'things_board must sync theme in <head> before <body> paints');
  assert.ok(headHtml.includes("prefers-color-scheme: light"), 'syncThemeWithHost must fall back to prefers-color-scheme when --background is not yet pushed');
  assert.ok(!boardHtml.includes('setTimeout(syncThemeWithHost, 50)'), 'theme-change message must sync immediately without 50ms timeout');

  // 4. Antigravity card & harness: handles light official wrapper and data-color-mode in first-paint & THEME_SYNC
  const agyCardSrc = fs.readFileSync(path.join(__dirname, '../src/antigravity-card.cjs'), 'utf8');
  const agyHarnessSrc = fs.readFileSync(path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
  assert.ok(agyCardSrc.includes(':root[data-color-mode="light"]'));
  assert.ok(agyCardSrc.includes('applyHostThemeMode('));
  assert.ok(/class="\(\?:dark\|light\)"/.test(agyHarnessSrc), 'isOfficialWrapper must allow both dark and light official wrappers');
  assert.ok(agyHarnessSrc.includes('__agentThingsHostTheme'));
});

test('panel task rows prefer full task.title over task.summary', () => {
  assert.ok(source.includes('const text = task.title || task.summary;'), 'session-status.js must prefer full task.title');
  assert.ok(!source.includes('const text = task.summary || task.title;'));
});

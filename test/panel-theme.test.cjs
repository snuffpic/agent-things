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

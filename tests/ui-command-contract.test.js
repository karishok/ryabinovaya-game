const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('redesign keeps every established gameplay command reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  const staticActions = ['SELECT_ZONE', 'SELECT_STORE', 'PAUSE', 'END_SHIFT', 'OPEN_BUILDER', 'OPEN_VEHICLES', 'NAVIGATE'];
  const delegatedActions = ['ADD_ITEM', 'LOAD_PALLET', 'SET_ROUTE'];

  for (const action of staticActions) assert.match(html, new RegExp(`data-action="${action}"`));
  for (const action of delegatedActions) assert.match(app, new RegExp(`action === '${action}'`));
});

test('mobile shell keeps builder, transport, pause and report reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['builderModal', 'vehicleModal', 'reportModal', 'routeButton', 'nextShift']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

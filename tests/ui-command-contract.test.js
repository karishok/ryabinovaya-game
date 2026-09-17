const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('redesign keeps every established gameplay command reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  const reachableMarkup = `${html}\n${app}`;
  const actions = [
    'OPEN_TSD', 'CLOSE_TSD', 'ACCEPT_TASK',
    'SELECT_ZONE', 'SELECT_STORE', 'ADD_ITEM', 'LOAD_PALLET',
    'OPEN_BUILDER', 'OPEN_VEHICLES', 'SELECT_VEHICLE',
    'MOVE_STOP', 'SET_ROUTE', 'PAUSE', 'END_SHIFT',
  ];

  for (const action of actions) {
    assert.match(reachableMarkup, new RegExp(`(?:data-action="${action}"|action === '${action}')`));
  }
});

test('mobile shell keeps builder, transport, pause and report reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['builderModal', 'vehicleModal', 'reportModal', 'routeButton', 'nextShift']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { startLevel, reduceAction } = require('../app-state.js');
const { terminalViewFor } = require('../tsd-view.js');

test('briefing view uses the level story inside the TSD', () => {
  const view = terminalViewFor(startLevel(1));
  assert.equal(view.screen, 'briefing');
  assert.equal(view.open, true);
  assert.equal(view.title, 'Новая смена');
  assert.ok(view.message.length > 0);
});

test('task view names the store, goods and Russian zone', () => {
  const state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  const view = terminalViewFor(state);
  assert.equal(view.title, 'Новое задание');
  assert.equal(view.storeName, 'Северный');
  assert.equal(view.orderText, 'Вода 1,5 л · 2 шт.');
  assert.equal(view.zoneName, 'Сухач');
  assert.equal(view.canAccept, true);
});

test('current view reports pallet progress without changing task data', () => {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  const before = JSON.parse(JSON.stringify(state));
  assert.equal(terminalViewFor(state).progressText, '12 / 100 кг');
  assert.deepEqual(state, before);
});

test('feedback view puts operational errors on the TSD', () => {
  const state = {
    ...startLevel(1),
    feedback: { kind: 'error', code: 'wrong-zone', message: 'Этот товар нужно собирать в другой зоне.' },
  };
  const view = terminalViewFor(state);
  assert.equal(view.signal, 'error');
  assert.equal(view.message, 'Этот товар нужно собирать в другой зоне.');
});

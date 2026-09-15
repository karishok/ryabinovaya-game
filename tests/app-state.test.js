const test = require('node:test');
const assert = require('node:assert/strict');
const { reduceAction } = require('../app-state.js');

test('adding a compatible item increases pallet weight', () => {
  const initial = { pallet: { zone: 'chilled', storeId: 'north', weight: 0, items: [] } };
  const next = reduceAction(initial, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 2 });
  assert.equal(next.pallet.weight, 20);
});

test('wrong-zone feedback is preserved for the UI', () => {
  const initial = { pallet: { zone: 'dry', storeId: 'north', weight: 0, items: [] } };
  const next = reduceAction(initial, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  assert.equal(next.feedback.kind, 'error');
  assert.equal(next.feedback.code, 'wrong-zone');
});

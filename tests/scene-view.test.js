const test = require('node:test');
const assert = require('node:assert/strict');
const { warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

test('initial shift points the warehouse at the active order zone', () => {
  const view = warehouseViewFor(startLevel(1));
  assert.equal(view.activeZone, 'dry');
  assert.equal(view.selectedZone, 'dry');
  assert.equal(view.mode, 'idle');
});

test('idle status names the zone in Russian, not its internal code', () => {
  const view = warehouseViewFor(startLevel(1));
  assert.equal(view.statusText, 'Зона Сухач: можно начинать сборку.');
});

test('idle status names the chilled and frozen zones in Russian on later levels', () => {
  assert.equal(warehouseViewFor(startLevel(4)).statusText, 'Зона Сухач: можно начинать сборку.');
  const chilledFirst = { ...startLevel(4), orders: [{ id: 'x', storeId: 'east', zone: 'chilled', sku: 'milk', quantity: 1 }] };
  assert.equal(warehouseViewFor(chilledFirst).statusText, 'Зона Охлаждёнка: можно начинать сборку.');
  const frozenFirst = { ...startLevel(4), orders: [{ id: 'x', storeId: 'central', zone: 'frozen', sku: 'ice-cream', quantity: 1 }] };
  assert.equal(warehouseViewFor(frozenFirst).statusText, 'Зона Заморозка: можно начинать сборку.');
});

test('items on the current pallet turn the scene into collecting mode', () => {
  const state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'collecting');
  assert.equal(view.palletFillPercent, 24);
});

test('successful loading sends the AGV toward dispatch', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'to-dispatch');
  assert.equal(view.loadedPalletCount, 1);
});

test('loaded vehicle without a built route waits at the gate', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = { ...state, feedback: null };
  assert.equal(warehouseViewFor(state).mode, 'awaiting-route');
});

test('wrong-zone loading stops the AGV and names the spoilage', () => {
  let state = startLevel(4);
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'spoiled');
  assert.match(view.statusText, /испорчена/i);
});

test('over-capacity feedback maps to a blocked visual state', () => {
  const state = { ...startLevel(1), feedback: { kind: 'error', code: 'over-capacity', message: 'В машине не осталось места.' } };
  assert.equal(warehouseViewFor(state).mode, 'blocked');
});

test('demand changes request a short pulse on the active zone', () => {
  const state = { ...startLevel(1), feedback: { kind: 'info', code: 'demand-increase', message: 'Заявка выросла.' } };
  assert.equal(warehouseViewFor(state).eventCode, 'demand-increase');
});

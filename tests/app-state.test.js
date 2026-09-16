const test = require('node:test');
const assert = require('node:assert/strict');
const { reduceAction } = require('../app-state.js');
const { createPallet, createVehicle } = require('../game-engine.js');

const addMilk = (state, quantity = 1) => reduceAction(state, {
  type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity,
});

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

test('adding twice then removing once keeps one SKU record and consistent weight', () => {
  const initial = { pallet: createPallet({ storeId: 'north', zone: 'chilled' }) };
  const twiceAdded = addMilk(addMilk(initial));
  const next = addMilk(twiceAdded, -1);
  assert.equal(next.pallet.weight, 10);
  assert.deepEqual(next.pallet.items, [{ sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 }]);
});

test('rejected incompatible load preserves builder state and records spoilage', () => {
  const initial = {
    builderOpen: true,
    pallet: { ...createPallet({ storeId: 'north', zone: 'chilled' }), weight: 10 },
    vehicles: [createVehicle({ id: 'dry-1', zone: 'dry' })],
    metrics: { spoiledPallets: 0, routePenalty: 0 },
  };
  const next = reduceAction(initial, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  assert.equal(next.builderOpen, true);
  assert.equal(next.metrics.spoiledPallets, 1);
  assert.equal(next.metrics.routePenalty, 10);
  assert.equal(next.spoilageReasons[0].type, 'wrong-transport');
  assert.equal(next.feedback.code, 'wrong-zone');
});

test('end-shift score includes accumulated spoilage and penalty data', () => {
  const pallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 80,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 }],
  };
  const initial = {
    secondsRemaining: 120,
    orders: [{ id: 'order-north', storeId: 'north', zone: 'dry', sku: 'water', quantity: 2 }],
    loadedPallets: [pallet],
    vehicles: [{ id: 'dry-1', zone: 'dry', capacity: 100, pallets: [pallet] }],
    metrics: { spoiledPallets: 1, routePenalty: 10 },
    spoilageReasons: [{ message: 'паллета испорчена из-за несовместимого транспорта' }],
    route: { stops: ['north'], minutes: 12, distanceScore: 88 },
  };
  const next = reduceAction(initial, { type: 'END_SHIFT' });
  assert.ok(next.report.reasons.some((reason) => reason.includes('несовместимого транспорта')));
  assert.ok(next.report.reasons.includes('Маршрут оказался неэффективным'));
  assert.equal(next.report.inputs.deliveredPercent, 100);
  assert.equal(next.report.inputs.utilizationPercent, 80);
});

test('multi-stop route state preserves player-selected order', () => {
  const initial = { selectedVehicleId: 'dry-1', vehicles: [createVehicle({ id: 'dry-1', zone: 'dry' })] };
  const next = reduceAction(initial, { type: 'SET_ROUTE', stops: ['west', 'north', 'central'] });
  assert.deepEqual(next.route.stops, ['west', 'north', 'central']);
  assert.deepEqual(next.routeStops, ['west', 'north', 'central']);
});

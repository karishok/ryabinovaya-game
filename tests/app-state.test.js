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
    metrics: { spoiledPallets: 0 },
  };
  const next = reduceAction(initial, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  assert.equal(next.builderOpen, true);
  assert.equal(next.metrics.spoiledPallets, 1);
  assert.equal(next.spoilageReasons[0].type, 'wrong-transport');
  assert.equal(next.feedback.code, 'wrong-zone');
});

test('wrong-transport spoilage clears the builder pallet so its goods cannot later be delivered', () => {
  const initial = {
    builderOpen: true,
    pallet: {
      ...createPallet({ storeId: 'north', zone: 'chilled' }),
      weight: 10,
      items: [{ sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 }],
    },
    vehicles: [createVehicle({ id: 'dry-1', zone: 'dry' }), createVehicle({ id: 'chilled-1', zone: 'chilled' })],
    orders: [{ id: 'north-milk', storeId: 'north', zone: 'chilled', sku: 'milk', quantity: 1 }],
    metrics: { spoiledPallets: 0 },
    secondsRemaining: 120,
  };

  const spoiled = reduceAction(initial, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const laterLoad = reduceAction(spoiled, { type: 'LOAD_PALLET', vehicleId: 'chilled-1' });

  assert.equal(spoiled.builderOpen, true);
  assert.equal(spoiled.feedback.code, 'wrong-zone');
  assert.match(spoiled.feedback.message, /испорчен/i);
  assert.deepEqual(spoiled.pallet.items, []);
  assert.equal(spoiled.pallet.weight, 0);
  assert.equal((laterLoad.loadedPallets || []).length, 0);
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
    metrics: { spoiledPallets: 1 },
    spoilageReasons: [{ message: 'паллета испорчена из-за несовместимого транспорта' }],
    route: { stops: ['north'], minutes: 12, distanceScore: 88 },
  };
  const next = reduceAction(initial, { type: 'END_SHIFT' });
  assert.ok(next.report.reasons.some((reason) => reason.includes('несовместимого транспорта')));
  assert.ok(next.report.reasons.some((reason) => reason.includes('сверх заявки')));
  assert.equal(next.report.deliveredPercent, 100);
  assert.equal(next.report.precisionPercent, 30);
});

test('multi-stop route state preserves player-selected order', () => {
  const initial = { selectedVehicleId: 'dry-1', vehicles: [createVehicle({ id: 'dry-1', zone: 'dry' })] };
  const next = reduceAction(initial, { type: 'SET_ROUTE', stops: ['west', 'north', 'central'] });
  assert.deepEqual(next.route.stops, ['west', 'north', 'central']);
  assert.deepEqual(next.routeStops, ['west', 'north', 'central']);
});

test('a vehicle route cannot deliver a pallet loaded on another vehicle', () => {
  const northPallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const westPallet = {
    storeId: 'west', zone: 'dry', vehicleId: 'dry-2', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const state = {
    secondsRemaining: 120,
    orders: [
      { id: 'north-water', storeId: 'north', zone: 'dry', sku: 'water', quantity: 1 },
      { id: 'west-water', storeId: 'west', zone: 'dry', sku: 'water', quantity: 1 },
    ],
    loadedPallets: [northPallet, westPallet],
    vehicles: [
      { id: 'dry-1', zone: 'dry', capacity: 100, pallets: [northPallet] },
      { id: 'dry-2', zone: 'dry', capacity: 100, pallets: [westPallet] },
    ],
    routesByVehicle: { 'dry-1': { stops: ['north'], minutes: 15 } },
    route: { stops: ['north', 'west'], minutes: 30 },
    metrics: { spoiledPallets: 0 },
  };

  assert.equal(reduceAction(state, { type: 'END_SHIFT' }).report.deliveredPercent, 50);
});

test('legacy shared route only applies to the selected vehicle in a multi-vehicle state', () => {
  const northPallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const westPallet = {
    storeId: 'west', zone: 'dry', vehicleId: 'dry-2', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const state = {
    selectedVehicleId: 'dry-1',
    secondsRemaining: 120,
    orders: [
      { id: 'north-water', storeId: 'north', zone: 'dry', sku: 'water', quantity: 1 },
      { id: 'west-water', storeId: 'west', zone: 'dry', sku: 'water', quantity: 1 },
    ],
    loadedPallets: [northPallet, westPallet],
    vehicles: [
      { id: 'dry-1', zone: 'dry', capacity: 100, pallets: [northPallet] },
      { id: 'dry-2', zone: 'dry', capacity: 100, pallets: [westPallet] },
    ],
    route: { stops: ['north', 'west'], minutes: 30 },
    metrics: { spoiledPallets: 0 },
  };

  assert.equal(reduceAction(state, { type: 'END_SHIFT' }).report.deliveredPercent, 50);
});

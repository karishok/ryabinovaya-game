const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ZONES,
  ITEMS,
  createPallet,
  addItemToPallet,
  createVehicle,
  loadPallet,
  buildRoute,
  bestRoute,
  itemBySku,
} = require('../game-engine.js');

test('defines the three immutable warehouse zones', () => {
  assert.deepEqual(ZONES, { DRY: 'dry', FROZEN: 'frozen', CHILLED: 'chilled' });
  assert.equal(Object.isFrozen(ZONES), true);
  assert.equal(Object.isFrozen(ITEMS), true);
});

test('creates an empty pallet for exactly one store', () => {
  assert.deepEqual(createPallet({ storeId: 'north', zone: ZONES.CHILLED }), {
    storeId: 'north',
    zone: 'chilled',
    items: [],
    weight: 0,
    capacity: 100,
  });
});

test('milk can be added to chilled pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.CHILLED });
  const result = addItemToPallet(pallet, { sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10 }, 2);
  assert.equal(result.ok, true);
  assert.equal(result.pallet.weight, 20);
  assert.deepEqual(result.pallet.items, [{ sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10, quantity: 2 }]);
});

test('milk cannot be added to dry pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = addItemToPallet(pallet, { sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10 }, 1);
  assert.deepEqual(result, { ok: false, reason: 'wrong-zone' });
});

test('frozen item can be added to frozen pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.FROZEN });
  const result = addItemToPallet(pallet, ITEMS.ICE_CREAM, 2);
  assert.equal(result.ok, true);
  assert.equal(result.pallet.weight, ITEMS.ICE_CREAM.weightPerUnit * 2);
});

test('frozen item cannot be added to chilled pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.CHILLED });
  assert.deepEqual(addItemToPallet(pallet, ITEMS.ICE_CREAM, 1), { ok: false, reason: 'wrong-zone' });
});

test('rejects an item that would exceed pallet capacity', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = addItemToPallet(pallet, { sku: 'water', zone: ZONES.DRY, weightPerUnit: 25 }, 5);
  assert.deepEqual(result, { ok: false, reason: 'over-capacity' });
  assert.equal(pallet.weight, 0);
});

test('pallet item transitions are immutable', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = addItemToPallet(pallet, { sku: 'water', zone: ZONES.DRY, weightPerUnit: 12 }, 1);
  assert.notEqual(result.pallet, pallet);
  assert.notEqual(result.pallet.items, pallet.items);
  assert.deepEqual(pallet.items, []);
  assert.equal(pallet.weight, 0);
});

test('a vehicle accepts only pallets from its zone', () => {
  const vehicle = createVehicle({ id: 'dry-1', zone: ZONES.DRY });
  const pallet = createPallet({ storeId: 'north', zone: ZONES.CHILLED });
  const result = loadPallet(vehicle, pallet);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong-zone');
  assert.equal(result.spoilageReason.type, 'wrong-transport');
  assert.match(result.spoilageReason.message, /dry.*chilled|chilled.*dry/);
});

test('vehicle capacity applies across multiple pallets', () => {
  const vehicle = createVehicle({ id: 'dry-1', zone: ZONES.DRY, capacity: 100 });
  const first = { ...createPallet({ storeId: 'north', zone: ZONES.DRY }), weight: 60 };
  const second = { ...createPallet({ storeId: 'west', zone: ZONES.DRY }), weight: 41 };
  const loaded = loadPallet(vehicle, first);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.vehicle.pallets.length, 1);
  assert.deepEqual(loadPallet(loaded.vehicle, second), { ok: false, reason: 'over-capacity' });
});

test('a loaded pallet is tagged with the vehicle it was loaded onto', () => {
  const vehicle = createVehicle({ id: 'dry-1', zone: ZONES.DRY });
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = loadPallet(vehicle, pallet);
  assert.equal(result.pallet.vehicleId, 'dry-1');
  assert.equal(result.vehicle.pallets[0].vehicleId, 'dry-1');
});

test('vehicle loading is immutable', () => {
  const vehicle = createVehicle({ id: 'dry-1', zone: ZONES.DRY });
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = loadPallet(vehicle, pallet);
  assert.notEqual(result.vehicle, vehicle);
  assert.notEqual(result.vehicle.pallets, vehicle.pallets);
  assert.deepEqual(vehicle.pallets, []);
});

test('route preserves the player-selected stop order', () => {
  const route = buildRoute({ id: 'dry-1', zone: 'dry' }, ['north', 'central', 'west']);
  assert.deepEqual(route.stops, ['north', 'central', 'west']);
  assert.ok(route.minutes > 0);
  assert.ok(route.distanceScore > 0);
});

test('route does not mutate the selected stops', () => {
  const stops = ['north', 'west'];
  const route = buildRoute({ id: 'dry-1', zone: 'dry' }, stops);
  assert.notEqual(route.stops, stops);
  assert.deepEqual(stops, ['north', 'west']);
});

test('route order changes time and efficiency for the same stops', () => {
  const first = buildRoute({ id: 'dry-1', zone: 'dry' }, ['north', 'central', 'west']);
  const second = buildRoute({ id: 'dry-1', zone: 'dry' }, ['west', 'north', 'central']);
  assert.notEqual(first.minutes, second.minutes);
  assert.notEqual(first.distanceScore, second.distanceScore);
});

test('unlisted stops of equal length still get distinct, stable fallback distances', () => {
  const south = buildRoute({ id: 'dry-1', zone: 'dry' }, ['south']);
  const southRepeat = buildRoute({ id: 'dry-1', zone: 'dry' }, ['south']);
  const radio = buildRoute({ id: 'dry-1', zone: 'dry' }, ['radio']);
  assert.equal(south.minutes, southRepeat.minutes);
  assert.notEqual(south.minutes, radio.minutes);
});

test('bestRoute finds the shortest stop order', () => {
  const best = bestRoute(['north', 'west', 'central']);
  assert.deepEqual(best.stops, ['central', 'north', 'west']);
  assert.equal(best.minutes, 49);
});

test('bestRoute is trivial for a single stop', () => {
  assert.deepEqual(bestRoute(['north']), { stops: ['north'], minutes: 15 });
});

test('bestRoute handles an empty route', () => {
  assert.deepEqual(bestRoute([]), { stops: [], minutes: 0 });
});

test('bestRoute refuses to brute-force more than eight stops', () => {
  const tooMany = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  assert.throws(() => bestRoute(tooMany), RangeError);
});

test('every item carries a price and a display name', () => {
  for (const item of Object.values(ITEMS)) {
    assert.ok(item.price > 0, `${item.sku} без цены`);
    assert.ok(item.name.length > 0, `${item.sku} без названия`);
  }
  assert.equal(ITEMS.WATER.price, 1500);
  assert.equal(ITEMS.ICE_CREAM.price, 2200);
});

test('itemBySku resolves items and returns null for unknown goods', () => {
  assert.equal(itemBySku('water').weightPerUnit, 12);
  assert.equal(itemBySku('unicorn'), null);
});

test('store names cover every store used by the campaign', () => {
  const { LEVELS, STORE_NAMES } = require('../levels.js');
  for (const level of LEVELS) {
    for (const store of level.stores) {
      assert.ok(STORE_NAMES[store.id], `нет названия для ${store.id}`);
    }
  }
});

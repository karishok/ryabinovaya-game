const test = require('node:test');
const assert = require('node:assert/strict');

const { LEVELS } = require('../levels.js');
const { createShiftState, advanceScenario } = require('../game-engine.js');

test('campaign has eight levels in order', () => {
  assert.deepEqual(LEVELS.map(level => level.id), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('each level adds at most one primary mechanic', () => {
  const newMechanics = LEVELS.map(level => level.newMechanic);
  assert.deepEqual(newMechanics, ['one-order', 'two-stores', 'multi-pallet', 'three-zones', 'multi-vehicle', 'route', 'dynamic-demand', 'exam']);
});

test('level 4 is the first level with all three zones', () => {
  assert.deepEqual(LEVELS[2].unlockedZones, ['dry']);
  assert.deepEqual(LEVELS[3].unlockedZones, ['dry', 'frozen', 'chilled']);
});

test('every level contains a complete scenario definition', () => {
  for (const level of LEVELS) {
    assert.equal(typeof level.title, 'string');
    assert.equal(typeof level.durationSeconds, 'number');
    assert.ok(level.durationSeconds > 0);
    for (const field of ['unlockedZones', 'vehicles', 'stores', 'initialOrders', 'events']) {
      assert.ok(Array.isArray(level[field]), `${field} missing from level ${level.id}`);
    }
    for (const field of ['goal', 'storyBefore', 'storyAfter']) assert.equal(typeof level[field], 'string');
    assert.ok(level.vehicles.length > 0);
    assert.ok(level.stores.length > 0);
    assert.ok(level.initialOrders.length > 0);
  }
});

test('level 4 teaches zone compatibility without a spoilage timer', () => {
  const level = LEVELS[3];
  assert.equal(level.events.some(event => event.type === 'spoilage'), false);
  assert.equal(Object.hasOwn(level, 'spoilageSeconds'), false);
  assert.deepEqual(level.vehicles.map(vehicle => vehicle.zone), ['dry', 'frozen', 'chilled']);
});

test('level 7 expresses its changed request as one explicit event', () => {
  const events = LEVELS[6].events.filter(event => event.type === 'demand-increase');
  assert.equal(events.length, 1);
  assert.equal(events[0].orderId, 'order-west');
  assert.equal(events[0].quantity, 2);
});

test('createShiftState copies the level into a fresh shift state', () => {
  const state = createShiftState(LEVELS[0]);
  assert.deepEqual(state, {
    levelId: 1,
    secondsRemaining: LEVELS[0].durationSeconds,
    orders: LEVELS[0].initialOrders,
    pallets: [],
    vehicles: LEVELS[0].vehicles,
    events: [],
    metrics: {
      deliveredOrders: 0,
      cancelledOrders: 0,
      spoiledPallets: 0,
      routePenalty: 0,
    },
  });
  assert.notEqual(state.orders, LEVELS[0].initialOrders);
  assert.notEqual(state.vehicles, LEVELS[0].vehicles);
});

test('advanceScenario applies each explicit event immutably', () => {
  const source = createShiftState(LEVELS[6]);
  const increased = advanceScenario(source, { type: 'demand-increase', orderId: 'order-west', quantity: 2 });
  assert.equal(increased.orders.find(order => order.id === 'order-west').quantity, 4);
  const ready = advanceScenario(increased, { type: 'vehicle-ready', vehicleId: 'dry-1' });
  assert.equal(ready.vehicles.find(vehicle => vehicle.id === 'dry-1').ready, true);
  const reception = advanceScenario(ready, { type: 'store-reception-change', storeId: 'west', acceptsFromSecond: 90 });
  assert.equal(reception.orders.find(order => order.storeId === 'west').acceptsFromSecond, 90);
  const cancelled = advanceScenario(reception, { type: 'order-cancelled', orderId: 'order-west' });
  assert.equal(cancelled.orders.find(order => order.id === 'order-west').cancelled, true);
  assert.equal(cancelled.metrics.cancelledOrders, 1);
  assert.equal(cancelled.events.length, 4);
  assert.equal(source.orders.find(order => order.id === 'order-west').quantity, 2);
  assert.equal(source.vehicles.find(vehicle => vehicle.id === 'dry-1').ready, undefined);
  assert.equal(source.events.length, 0);
});

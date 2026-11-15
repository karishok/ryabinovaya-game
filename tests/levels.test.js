const test = require('node:test');
const assert = require('node:assert/strict');

const { LEVELS } = require('../levels.js');
const { createShiftState, advanceScenario } = require('../game-engine.js');

test('campaign has ten levels in order', () => {
  assert.deepEqual(LEVELS.map(level => level.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

/* Вводных смен две: первая показывает сборку и погрузку, вторая — всё
   остальное разом. Дальше восемь рабочих смен, и у каждой один свой поворот;
   последние две складывают повороты вместе. */
test('two shifts introduce the game, the other eight each bring one twist', () => {
  assert.deepEqual(LEVELS.map(level => level.teaches), [
    ['one-order'],
    ['inbound-receive', 'two-stores', 'three-zones', 'inbound-sorting', 'route'],
    ['capacity'],
    ['late-delivery'],
    ['dynamic-demand'],
    ['cancellation'],
    ['late-vehicle'],
    ['long-routes'],
    ['mixed-plan'],
    ['exam'],
  ]);
  assert.deepEqual(LEVELS.filter(level => level.guided !== false).map(level => level.id), [1, 2]);
  for (const level of LEVELS.slice(2)) assert.equal(level.teaches.length, 1, `смена ${level.id}: один поворот за смену`);
  assert.equal(new Set(LEVELS.map(level => level.title)).size, LEVELS.length, 'у каждой смены своё название');
});

test('the second shift is the first with all three zones, and it makes the player sort the dock', () => {
  assert.deepEqual(LEVELS[0].unlockedZones, ['dry']);
  assert.deepEqual(LEVELS[1].unlockedZones, ['dry', 'frozen', 'chilled']);
  assert.equal(new Set(LEVELS[1].inbound.map(pallet => pallet.zone)).size, 3, 'по фуре в каждую зону');
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

test('every campaign shift fits the global three-to-five-minute duration', () => {
  for (const level of LEVELS) {
    assert.ok(level.durationSeconds >= 180, `level ${level.id} is shorter than 180 seconds`);
    assert.ok(level.durationSeconds <= 300, `level ${level.id} is longer than 300 seconds`);
  }
});

test('the three-zone shift teaches zone compatibility without a spoilage timer', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('three-zones'));
  assert.equal(level.events.some(event => event.type === 'spoilage'), false);
  assert.equal(Object.hasOwn(level, 'spoilageSeconds'), false);
  assert.deepEqual(level.vehicles.map(vehicle => vehicle.zone), ['dry', 'frozen', 'chilled']);
});

/* Дозаказ привязан к прогрессу и бьёт по уже закрытой заявке: иначе это
   просто большее число на доске, а не перемена плана. */
test('the reorder shift reopens orders the player has already closed', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('dynamic-demand'));
  const events = level.events.filter(event => event.type === 'demand-increase');
  assert.ok(events.length >= 2);
  const position = (orderId) => level.initialOrders.findIndex(order => order.id === orderId);
  for (const event of events) {
    assert.ok(event.afterLoadedPallets > position(event.orderId),
      `заявка ${event.orderId} должна быть уже погружена к моменту дозаказа`);
  }
  // Первый дозаказ делает воду тяжелее одной паллеты.
  const water = level.initialOrders.find(order => order.id === events[0].orderId);
  assert.ok((water.quantity + events[0].quantity) * 12 > 100);
});

/* Отмена должна застать паллету уже в кузове, иначе она ничему не учит:
   заявка просто исчезает из списка. */
test('the cancellation shift cancels orders whose pallets are already loaded', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('cancellation'));
  const cancels = level.events.filter(event => event.type === 'order-cancelled');
  assert.equal(cancels.length, 2);
  const position = (orderId) => level.initialOrders.findIndex(order => order.id === orderId);
  for (const event of cancels) assert.ok(event.afterLoadedPallets > position(event.orderId));
});

/* Фура, которая приезжает посреди смены, везёт товар, которого на складе
   нет, — иначе её можно не заметить. И у приезда есть запасной срок: тот,
   кто просто ждёт, тоже её дождётся. То же — с фургоном из рейса. */
test('whatever arrives mid-shift is needed, and arrives even for a player who waits', () => {
  for (const level of LEVELS) {
    for (const event of level.events.filter(entry => entry.type === 'pallet-arrived')) {
      const { zone, sku } = event.pallet;
      assert.equal(level.stock?.[zone]?.[sku], 0, `смена ${level.id}: ${sku} и так лежит в зоне`);
      assert.ok(level.initialOrders.some(order => order.sku === sku), `смена ${level.id}: ${sku} никто не заказывал`);
      assert.equal(typeof event.orAtSecond, 'number', `смена ${level.id}: у фуры нет запасного срока`);
    }
    for (const event of level.events.filter(entry => entry.type === 'vehicle-ready')) {
      assert.equal(typeof event.orAtSecond, 'number', `смена ${level.id}: у фургона нет запасного срока`);
      assert.ok(event.orAtSecond < level.durationSeconds / 2);
    }
  }
});

test('the late-van shift cannot be closed with the vans standing at the gates', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('late-vehicle'));
  const late = level.events.find(event => event.type === 'vehicle-ready');
  const lateVan = level.vehicles.find(vehicle => vehicle.id === late.vehicleId);
  const weight = level.initialOrders.filter(order => order.zone === lateVan.zone)
    .reduce((total, order) => total + order.quantity * require('../game-engine.js').itemBySku(order.sku).weightPerUnit, 0);
  const ready = level.vehicles.filter(vehicle => vehicle.zone === lateVan.zone && vehicle.id !== lateVan.id)
    .reduce((total, vehicle) => total + vehicle.capacity, 0);
  assert.ok(weight > ready, 'без второго фургона груз увезти нельзя — иначе рейс ни на что не влияет');
  assert.ok(weight <= ready + lateVan.capacity);
});

test('createShiftState copies the level into a fresh shift state', () => {
  const state = createShiftState(LEVELS[0]);
  assert.deepEqual(state, {
    levelId: 1,
    secondsRemaining: LEVELS[0].durationSeconds,
    orders: LEVELS[0].initialOrders,
    pallets: [],
    vehicles: LEVELS[0].vehicles,
    inbound: [],
    stock: null,
    events: [],
    metrics: {
      deliveredOrders: 0,
      cancelledOrders: 0,
      spoiledPallets: 0,
    },
  });
  assert.notEqual(state.orders, LEVELS[0].initialOrders);
  assert.notEqual(state.vehicles, LEVELS[0].vehicles);
});

test('a receiving level starts with pallets on the dock and the goods missing from the zone', () => {
  const state = createShiftState(LEVELS.find(level => level.teaches.includes('inbound-receive')));
  assert.equal(state.inbound.length, 3);
  assert.equal(state.inbound[0].status, 'arrived');
  assert.equal(state.inbound[0].zone, 'dry');
  assert.equal(state.inbound[0].weight, 48);
  assert.equal(state.stock.dry.water, 0);
});

test('advanceScenario applies each explicit event immutably', () => {
  const source = createShiftState(LEVELS.find(level => level.teaches.includes('mixed-plan')));
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

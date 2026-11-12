const test = require('node:test');
const assert = require('node:assert/strict');

const { LEVELS } = require('../levels.js');
const { createShiftState, advanceScenario } = require('../game-engine.js');

test('campaign has six levels in order', () => {
  assert.deepEqual(LEVELS.map(level => level.id), [1, 2, 3, 4, 5, 6]);
});

/* Знакомство сжато: обучающая смена вводит два родственных правила, а не
   одно, — девять раундов по правилу растягивали вход, и первые проходились
   за пятнадцать секунд. Последние две смены правил не добавляют. */
test('four shifts teach the rules, the last two only change the plan', () => {
  assert.deepEqual(LEVELS.map(level => level.teaches), [
    ['one-order'],
    ['inbound-receive', 'two-stores'],
    ['three-zones', 'inbound-sorting'],
    ['route', 'capacity'],
    ['dynamic-demand', 'late-delivery', 'cancellation'],
    ['exam'],
  ]);
  for (const level of LEVELS) assert.ok(level.teaches.length <= 3, `смена ${level.id} вводит слишком много сразу`);
});

/* Приёмка стоит до правила зон, а сортировка поставок — в одной смене с ним:
   правило зон сразу применяется там, где ошибка стоит испорченной паллеты. */
test('receiving is taught before zones, and zone sorting together with them', () => {
  const positionOf = (mechanic) => LEVELS.findIndex(level => level.teaches.includes(mechanic));
  assert.ok(positionOf('inbound-receive') < positionOf('three-zones'));
  assert.equal(positionOf('inbound-sorting'), positionOf('three-zones'));
  assert.equal(positionOf('route'), positionOf('capacity'), 'маршрут и вместимость встречаются в одном кузове');
  assert.ok(positionOf('capacity') < positionOf('dynamic-demand'), 'план меняется только когда правила уже известны');
  assert.equal(positionOf('exam'), LEVELS.length - 1);
});

test('level 3 is the first level with all three zones', () => {
  assert.deepEqual(LEVELS[1].unlockedZones, ['dry']);
  assert.deepEqual(LEVELS[2].unlockedZones, ['dry', 'frozen', 'chilled']);
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
  const level = LEVELS[2];
  assert.equal(level.events.some(event => event.type === 'spoilage'), false);
  assert.equal(Object.hasOwn(level, 'spoilageSeconds'), false);
  assert.deepEqual(level.vehicles.map(vehicle => vehicle.zone), ['dry', 'frozen', 'chilled']);
});

test('the changing-plan shift expresses its changed request as one progress event', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('dynamic-demand'));
  const events = level.events.filter(event => event.type === 'demand-increase');
  assert.equal(events.length, 1);
  assert.equal(events[0].orderId, 'order-west');
  assert.equal(events[0].quantity, 2);
  assert.equal(events[0].afterLoadedPallets, 2);
});

/* Отмена должна застать паллету уже в кузове, иначе она ничему не учит:
   заявка просто исчезает из списка. Поэтому отменяют первую заявку смены и
   только после того, как погружено достаточно паллет. */
test('the changing-plan shift cancels an order whose pallet is already loaded', () => {
  const level = LEVELS.find(entry => entry.teaches.includes('cancellation'));
  const cancel = level.events.find(event => event.type === 'order-cancelled');
  assert.equal(cancel.orderId, level.initialOrders[0].id);
  assert.ok(cancel.afterLoadedPallets >= 1);
});

/* Фура, которая приезжает посреди смены, везёт товар, которого на складе
   нет, — иначе её можно не заметить. И заявка на него стоит последней:
   к ней игрок приходит, когда фура уже на приёмке. */
test('a late truck brings goods the warehouse lacks, for the last order in the queue', () => {
  for (const level of LEVELS) {
    for (const event of level.events.filter(entry => entry.type === 'pallet-arrived')) {
      const { zone, sku } = event.pallet;
      assert.equal(level.stock?.[zone]?.[sku], 0, `смена ${level.id}: ${sku} и так лежит в зоне`);
      const last = level.initialOrders.at(-1);
      assert.equal(last.sku, sku, `смена ${level.id}: заявка на ${sku} должна стоять последней`);
      assert.ok(event.afterLoadedPallets < level.initialOrders.length - 1, `смена ${level.id}: фура приезжает слишком поздно`);
    }
  }
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
  assert.equal(state.inbound.length, 1);
  assert.equal(state.inbound[0].status, 'arrived');
  assert.equal(state.inbound[0].zone, 'dry');
  assert.equal(state.inbound[0].weight, 48);
  assert.equal(state.stock.dry.water, 0);
});

test('advanceScenario applies each explicit event immutably', () => {
  const source = createShiftState(LEVELS.find(level => level.teaches.includes('dynamic-demand')));
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

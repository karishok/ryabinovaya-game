const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game-engine.js');
const { LEVELS } = require('../levels.js');
const { startLevel, reduceAction, finishShift, shiftOutcome, activeOrderFor, remainingFor } = require('../app-state.js');
const { terminalViewFor } = require('../tsd-view.js');
const { warehouseViewFor } = require('../scene-view.js');

const receiveLevel = LEVELS.find((level) => level.newMechanic === 'inbound-receive').id;
const sortingLevel = LEVELS.find((level) => level.newMechanic === 'inbound-sorting').id;
// Смена начинается так же, как у игрока: брифинг закрывается кнопкой.
const shift = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });

test('an arrived pallet is received once and only once', () => {
  const pallet = engine.createInboundPallet({ id: 'in-1', zone: 'chilled', sku: 'milk', quantity: 3 });
  assert.equal(pallet.status, 'arrived');
  assert.equal(pallet.weight, 30);

  const received = engine.receiveInbound(pallet);
  assert.equal(received.ok, true);
  assert.equal(received.pallet.status, 'received');
  assert.equal(pallet.status, 'arrived', 'приёмка не мутирует исходную паллету');
  assert.deepEqual(engine.receiveInbound(received.pallet), { ok: false, reason: 'already-received' });
});

test('putaway into the wrong zone spoils the pallet and names the mistake', () => {
  const received = engine.receiveInbound(engine.createInboundPallet({ id: 'in-1', zone: 'frozen', sku: 'ice-cream', quantity: 2 })).pallet;

  const placed = engine.placeInbound(received, 'frozen');
  assert.equal(placed.ok, true);
  assert.equal(placed.pallet.status, 'placed');

  const misplaced = engine.placeInbound(received, 'dry');
  assert.equal(misplaced.ok, false);
  assert.equal(misplaced.reason, 'wrong-zone');
  assert.equal(misplaced.pallet.status, 'spoiled');
  assert.equal(misplaced.spoilageReason.type, 'wrong-placement');
  assert.match(misplaced.spoilageReason.message, /размещени/i);
});

test('a pallet cannot be put away before it is received', () => {
  const arrived = engine.createInboundPallet({ id: 'in-1', zone: 'dry', sku: 'water', quantity: 1 });
  assert.deepEqual(engine.placeInbound(arrived, 'dry'), { ok: false, reason: 'not-received' });
});

test('a level lists only what is scarce: undeclared goods stay in stock', () => {
  const stock = engine.stockFrom({ dry: { water: 0 } });
  assert.equal(engine.availableStock(stock, 'dry', 'water'), 0);
  assert.equal(engine.availableStock(stock, 'dry', 'bread'), Infinity);
  assert.equal(engine.availableStock(stock, 'chilled', 'milk'), Infinity);
  assert.deepEqual(engine.takeFromStock(stock, 'dry', 'water', 1), { ok: false, reason: 'no-stock', available: 0 });
  assert.equal(engine.takeFromStock(stock, 'chilled', 'milk', 5).ok, true);
  assert.equal(engine.addToStock(stock, 'dry', 'water', 4).dry.water, 4);
});

test('the terminal shows the dock before the delivery order, because receiving blocks the racks', () => {
  const state = shift(receiveLevel);
  const view = terminalViewFor(state);
  assert.equal(view.screen, 'inbound');
  assert.equal(view.title, 'Приёмка');
  assert.equal(view.canReceive, true);
  assert.equal(view.awaitingPlacement, false);
  assert.match(view.storeName, /Аквалайн/);
  assert.equal(view.zoneName, 'Сухач');
  // Закрытый ТСД тоже обязан говорить, что стоит на приёмке.
  assert.match(view.compactTask, /Вода 1,5 л · 4 шт\. → Сухач/);
});

test('receiving hands the shift over to putaway and points at the rack', () => {
  const received = reduceAction(shift(receiveLevel), { type: 'RECEIVE_PALLET' });
  const view = terminalViewFor(received);

  assert.equal(view.screen, 'inbound');
  assert.equal(view.title, 'Размещение');
  assert.equal(view.awaitingPlacement, true);
  assert.equal(view.placementZone, 'dry');
  assert.equal(view.canReceive, false);
  // Затемнение не должно перехватывать нажатие по вывеске зоны на схеме.
  assert.equal(view.blocking, false);
  assert.equal(warehouseViewFor(received).mode, 'placing');
  assert.equal(warehouseViewFor(received).placementZone, 'dry');
});

test('goods reach the racks only after putaway, and then the order can be picked', () => {
  let state = shift(receiveLevel);
  const pick = (next) => reduceAction(next, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 4 });

  const blocked = pick(state);
  assert.equal(blocked.feedback.code, 'no-stock');
  assert.match(blocked.feedback.message, /примите и разместите поставку/i);
  assert.equal(blocked.pallet.weight, 0);

  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(state.feedback.kind, 'success');
  assert.equal(state.stock.dry.water, 4);

  state = pick(state);
  assert.equal(state.pallet.weight, 48);
  assert.equal(state.stock.dry.water, 0, 'отбор списывает товар из зоны');
});

test('putting a pallet on the wrong rack costs a spoiled pallet and the order behind it', () => {
  let state = shift(receiveLevel);
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'chilled' });

  assert.equal(state.feedback.kind, 'error');
  assert.equal(state.metrics.spoiledPallets, 1);
  assert.equal(state.inbound[0].status, 'spoiled');
  assert.equal(engine.availableStock(state.stock, 'dry', 'water'), 0, 'испорченный товар не попадает в зону');

  const report = finishShift(state).report;
  assert.equal(report.spoiledPallets, 1);
  assert.equal(report.deliveredPercent, 0);
  assert.notEqual(report.stars, 3);
  assert.ok(report.reasons.some((reason) => /размещени/i.test(reason)));
});

test('a pallet abandoned on the dock is named in the report', () => {
  const outcome = shiftOutcome(shift(receiveLevel));
  assert.equal(outcome.inboundTotal, 1);
  assert.equal(outcome.inboundPlaced, 0);
  assert.deepEqual(outcome.inboundLeftOnDock, [{ itemName: 'Вода 1,5 л', zoneName: 'Сухач' }]);

  const report = finishShift(shift(receiveLevel)).report;
  assert.ok(report.reasons.some((reason) => /На приёмке осталось паллет/.test(reason)));
});

test('the sorting shift queues every dock pallet and keeps the delivery order waiting', () => {
  let state = shift(sortingLevel);
  assert.equal(warehouseViewFor(state).inboundCount, 3);

  const zones = [];
  for (let guard = 0; guard < 3; guard += 1) {
    const view = terminalViewFor(state);
    assert.equal(view.screen, 'inbound', 'пока приёмка не разобрана, заявки ждут');
    state = reduceAction(state, { type: 'RECEIVE_PALLET' });
    zones.push(terminalViewFor(state).placementZone);
    state = reduceAction(state, { type: 'PLACE_PALLET', zone: zones.at(-1) });
  }

  assert.deepEqual(zones, ['chilled', 'frozen', 'dry'], 'паллеты разбираются в порядке прибытия');
  assert.equal(warehouseViewFor(state).inboundCount, 0);
  assert.equal(terminalViewFor(state).screen, 'current');
  // Только теперь появляется обычное задание на отгрузку.
  assert.ok(activeOrderFor(state));
  assert.equal(state.metrics.spoiledPallets, 0);
});

test('changing the pallet zone returns the picked goods to the rack', () => {
  let state = shift(sortingLevel);
  for (let i = 0; i < 3; i += 1) {
    const pending = state.inbound.find((pallet) => pallet.status === 'arrived' || pallet.status === 'received');
    state = reduceAction(state, { type: 'RECEIVE_PALLET' });
    state = reduceAction(state, { type: 'PLACE_PALLET', zone: pending.zone });
  }
  assert.equal(state.stock.chilled.milk, 2);

  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 2 });
  assert.equal(state.stock.chilled.milk, 0);

  /* Переключением зоны туда-сюда раньше можно было безвозвратно списать
     запас смены: паллета обнулялась, а товар в зону не возвращался. */
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'dry' });
  assert.equal(state.pallet.weight, 0);
  assert.equal(state.stock.chilled.milk, 2);
});

test('changing only the address keeps the goods already on the pallet', () => {
  let state = shift(sortingLevel);
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'dry' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 2 });
  const moved = reduceAction(state, { type: 'SELECT_STORE', storeId: 'central' });

  assert.equal(moved.pallet.storeId, 'central');
  assert.equal(moved.pallet.weight, 12, 'зона та же — груз годен, пересобирать нечего');
});

test('a chilled pallet rides in the chilled van even when a dry one is selected', () => {
  /* Раньше такая погрузка «портила» паллету, хотя в центре её просто не
     примут в кузов чужой зоны. Теперь склад сам ставит её к своей машине. */
  let state = shift(LEVELS.find((level) => level.newMechanic === 'three-zones').id);
  state = reduceAction(state, { type: 'SELECT_VEHICLE', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  const loaded = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });

  assert.equal(loaded.feedback.code, 'pallet-loaded');
  assert.equal(loaded.metrics.spoiledPallets, 0);
  assert.equal(loaded.loadedPallets[0].vehicleId, 'chilled-1');
  assert.match(loaded.feedback.message, /Охлаждёнка фургон/);
});

test('an order too big for one truck is split across the fleet without any truck picking', () => {
  const capacityLevel = LEVELS.find((level) => level.newMechanic === 'capacity').id;
  let state = shift(capacityLevel);
  const plus = (times) => {
    for (let i = 0; i < times; i += 1) {
      state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
    }
  };

  // Восемь мест — 96 кг, девятое уже не влезает в паллету.
  plus(8);
  assert.equal(state.pallet.weight, 96);
  plus(1);
  assert.equal(state.feedback.code, 'over-capacity');

  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(state.feedback.code, 'pallet-loaded');
  assert.match(state.feedback.message, /№1/);

  /* Остаток уходит во вторую машину сам. Раньше здесь был тупик: сборка
     упиралась в забитый кузов, а выбрать другой фургон было негде. */
  plus(2);
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(state.feedback.code, 'pallet-loaded');
  assert.match(state.feedback.message, /№2/);

  assert.equal(remainingFor(state, state.orders.find((order) => order.storeId === 'north')), 0);
  assert.deepEqual(state.loadedPallets.map((pallet) => pallet.vehicleId), ['dry-1', 'dry-2']);
});

test('when the zone fleet is full the refusal says so instead of blaming the pallet', () => {
  let state = shift(LEVELS.find((level) => level.newMechanic === 'one-order').id);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 8 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  const refused = reduceAction(state, { type: 'LOAD_PALLET' });

  assert.equal(refused.feedback.code, 'fleet-full');
  assert.match(refused.feedback.message, /Сухач/);
  assert.equal(refused.metrics.spoiledPallets, 0);
  assert.equal(refused.pallet.weight, 12, 'паллета остаётся собранной');
});

test('an overloaded truck can be emptied again, so a shift is never a dead end', () => {
  /* Со скриншота игрока: кузов забит лишним, заявка по второму адресу не
     влезает, и ни одно действие не освобождало место — смена становилась
     непроходимой на третьем уровне, где ещё экспериментируют. */
  const twoStores = LEVELS.find((level) => level.newMechanic === 'two-stores').id;
  let state = shift(twoStores);
  const put = (storeId, sku, weightPerUnit, quantity) => {
    state = reduceAction(state, { type: 'SELECT_STORE', storeId });
    state = reduceAction(state, { type: 'ADD_ITEM', sku, zone: 'dry', weightPerUnit, quantity });
    state = reduceAction(state, { type: 'LOAD_PALLET' });
  };

  put('north', 'water', 12, 8);
  const bread = state.orders.find((order) => order.storeId === 'west');
  state = reduceAction(state, { type: 'SELECT_STORE', storeId: 'west' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 3 });
  const stuck = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(stuck.feedback.code, 'fleet-full');
  assert.equal(remainingFor(stuck, bread), 3, 'заявка недостижима');
  assert.match(stuck.feedback.message, /снимите лишнюю паллету/i, 'подсказка обязана вести к выходу');

  const freed = reduceAction(stuck, { type: 'UNLOAD_PALLET', vehicleId: 'dry-1', palletIndex: 0 });
  assert.equal(freed.feedback.code, 'pallet-unloaded');
  assert.equal(freed.vehicles[0].pallets.length, 0);
  assert.equal(freed.loadedPallets.length, 0);
  assert.deepEqual(freed.routeStopsByVehicle['dry-1'], [], 'адрес снятой паллеты уходит из маршрута');

  const loaded = reduceAction(freed, { type: 'LOAD_PALLET' });
  assert.equal(loaded.feedback.code, 'pallet-loaded');
  assert.equal(remainingFor(loaded, bread), 0, 'заявка снова закрывается');
});

test('unloading returns the goods to the rack they were picked from', () => {
  let state = shift(receiveLevel);
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(state.stock.dry.water, 4);

  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 4 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(state.stock.dry.water, 0);

  const freed = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: 'dry-1', palletIndex: 0 });
  assert.equal(freed.stock.dry.water, 4, 'снятый товар снова доступен для отбора');
});

test('unloading a pallet keeps the other stops of the same truck', () => {
  const route = LEVELS.find((level) => level.newMechanic === 'route').id;
  let state = shift(route);
  const put = (storeId, sku, weightPerUnit, quantity) => {
    state = reduceAction(state, { type: 'SELECT_STORE', storeId });
    state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'dry' });
    state = reduceAction(state, { type: 'ADD_ITEM', sku, zone: 'dry', weightPerUnit, quantity });
    state = reduceAction(state, { type: 'LOAD_PALLET' });
  };
  put('north', 'water', 12, 2);
  put('central', 'bread', 6, 2);
  assert.deepEqual(state.routeStopsByVehicle['dry-1'], ['north', 'central']);

  const freed = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: 'dry-1', palletIndex: 0 });
  assert.deepEqual(freed.routeStopsByVehicle['dry-1'], ['central'], 'остаётся адрес оставшейся паллеты');
  assert.equal(freed.loadedPallets.length, 1);
  assert.equal(freed.loadedPallets[0].storeId, 'central');
});

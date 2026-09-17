const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game-engine.js');
const { LEVELS } = require('../levels.js');
const { startLevel, tick, reduceAction, finishShift, remainingFor } = require('../app-state.js');

// Приёмка: принять каждую входящую паллету и убрать её в зону из накладной.
function receiveAll(state) {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    const pending = (next.inbound || []).find((pallet) => pallet.status === 'arrived' || pallet.status === 'received');
    if (!pending) break;
    if (pending.status === 'arrived') next = reduceAction(next, { type: 'RECEIVE_PALLET' });
    next = reduceAction(next, { type: 'PLACE_PALLET', zone: pending.zone });
  }
  return next;
}

const usedCapacity = (vehicle) => vehicle.pallets.reduce((total, pallet) => total + pallet.weight, 0);

// Машина своей зоны, в которой осталось место хотя бы под одну единицу товара.
const vehicleWithRoom = (state, zone, weightPerUnit) => state.vehicles
  .find((vehicle) => vehicle.zone === zone && vehicle.ready !== false && vehicle.capacity - usedCapacity(vehicle) >= weightPerUnit);

// Закрывает остаток по каждой строке заявки, разбивая её на паллеты по
// вместимости паллеты и свободному месту в кузове.
function fillOrders(state, extraQuantityPerLine, stopsByVehicle) {
  let next = state;
  for (const order of next.orders.filter((entry) => !entry.cancelled)) {
    const item = engine.itemBySku(order.sku);
    let remaining = remainingFor(next, order) + extraQuantityPerLine;
    for (let guard = 0; remaining > 0 && guard < 20; guard += 1) {
      const vehicle = vehicleWithRoom(next, order.zone, item.weightPerUnit);
      if (!vehicle) break;
      const room = Math.min(next.pallet.capacity, vehicle.capacity - usedCapacity(vehicle));
      const units = Math.min(remaining, Math.floor(room / item.weightPerUnit));
      if (units <= 0) break;
      next = reduceAction(next, { type: 'SELECT_STORE', storeId: order.storeId });
      next = reduceAction(next, { type: 'SELECT_ZONE', zone: order.zone });
      next = reduceAction(next, {
        type: 'ADD_ITEM', sku: order.sku, zone: order.zone,
        weightPerUnit: item.weightPerUnit, quantity: units,
      });
      next = reduceAction(next, { type: 'LOAD_PALLET', vehicleId: vehicle.id });
      if (!stopsByVehicle.has(vehicle.id)) stopsByVehicle.set(vehicle.id, new Set());
      stopsByVehicle.get(vehicle.id).add(order.storeId);
      remaining -= units;
    }
  }
  return next;
}

const openDemand = (state) => state.orders
  .filter((order) => !order.cancelled)
  .reduce((total, order) => total + remainingFor(state, order), 0);

function play(levelId, extraQuantityPerLine = 0) {
  let state = { ...startLevel(levelId), phase: 'shift' };
  const stopsByVehicle = new Map();

  /* Несколько проходов, потому что часть событий смены привязана к прогрессу:
     заявка вырастает после погрузки, и остаток надо добрать вторым заходом. */
  for (let pass = 0; pass < 4; pass += 1) {
    state = receiveAll(state);
    state = fillOrders(state, extraQuantityPerLine, stopsByVehicle);
    state = tick(state, 1);
    if (openDemand(state) === 0) break;
  }

  for (const [vehicleId, stops] of stopsByVehicle) {
    const best = engine.bestRoute([...stops]);
    state = reduceAction(state, { type: 'SET_ROUTE', vehicleId, stops: best.stops });
  }
  return finishShift(state).report;
}

for (const level of LEVELS) {
  test(`level ${level.id} "${level.title}" is winnable with three stars and a profit`, () => {
    const report = play(level.id);
    assert.equal(report.deliveredPercent, 100, 'доставка');
    assert.equal(report.onTimePercent, 100, 'вовремя');
    assert.equal(report.precisionPercent, 100, 'точность');
    assert.equal(report.spoiledPallets, 0, 'порча');
    assert.equal(report.stars, 3, `звёзды, причины: ${report.reasons.join('; ')}`);
    assert.ok(report.profit > 0, `прибыль ${report.profit} должна быть положительной`);
  });
}

test('stuffing pallets beyond the order costs both stars and money', () => {
  const honest = play(1);
  const stuffed = play(1, 4);
  assert.equal(honest.stars, 3);
  assert.ok(stuffed.stars < 3, 'набивка не должна давать три звезды');
  assert.ok(stuffed.profit < honest.profit, `набивка ${stuffed.profit} должна быть невыгоднее честной игры ${honest.profit}`);
  assert.ok(stuffed.reasons.some((reason) => /сверх заявки/.test(reason)), 'отчёт должен назвать лишний груз');
});

// Уровень объявлен «одно новое правило за смену» — проверяем, что правило
// действительно включается, а не остаётся в описании.
test('every declared mechanic is actually exercised by its level data', () => {
  const byId = new Map(LEVELS.map((level) => [level.id, level]));
  const weightOf = (sku) => engine.itemBySku(sku).weightPerUnit;

  const inboundLevels = LEVELS.filter((level) => (level.inbound || []).length > 0);
  assert.deepEqual(inboundLevels.map((level) => level.newMechanic), ['inbound-receive', 'inbound-sorting', 'exam']);
  for (const level of inboundLevels) {
    for (const pallet of level.inbound) {
      assert.equal(engine.availableStock(engine.stockFrom(level.stock), pallet.zone, pallet.sku), 0,
        `уровень ${level.id}: привоз ${pallet.sku} бессмыслен, если товар и так лежит в зоне`);
    }
  }
  // Сортировка по зонам требует выбора: одной зоны для этого мало.
  assert.ok(new Set(byId.get(5).inbound.map((pallet) => pallet.zone)).size >= 3);

  // «Полный кузов» обязан не влезать ни в паллету, ни в одну машину.
  const capacity = byId.get(7);
  const dryWeight = capacity.initialOrders
    .filter((order) => order.zone === 'dry')
    .reduce((total, order) => total + order.quantity * weightOf(order.sku), 0);
  const dryFleet = capacity.vehicles.filter((vehicle) => vehicle.zone === 'dry');
  assert.ok(dryWeight > 100, `вместимость паллеты должна быть препятствием, а не формальностью: ${dryWeight} кг`);
  assert.ok(dryWeight > dryFleet[0].capacity, 'одной машины должно не хватать');
  assert.ok(dryWeight <= dryFleet.reduce((total, vehicle) => total + vehicle.capacity, 0), 'парка должно хватать');

  // События смены привязаны к прогрессу: расписание по секундам не наступало.
  for (const level of LEVELS) {
    for (const event of level.events) {
      assert.equal(typeof event.atSecond, 'undefined',
        `уровень ${level.id}: событие по таймеру не срабатывает, смену закрывают за 15 секунд`);
      assert.ok(typeof event.afterLoadedPallets === 'number' || typeof event.afterPlacedPallets === 'number',
        `уровень ${level.id}: у события нет условия по прогрессу`);
    }
  }
});

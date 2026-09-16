const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game-engine.js');
const { LEVELS } = require('../levels.js');
const { startLevel, tick, reduceAction, finishShift } = require('../app-state.js');

// Доводит смену до состояния, где все сценарные события уже случились:
// спрос окончательный, отложенные машины готовы.
function settled(levelId) {
  const level = LEVELS.find((entry) => entry.id === levelId);
  return tick({ ...startLevel(levelId), phase: 'shift' }, level.durationSeconds - 1);
}

// Раскладывает магазины по машинам их зоны по кругу.
function assignStores(state) {
  const byZone = new Map();
  for (const order of state.orders.filter((entry) => !entry.cancelled)) {
    if (!byZone.has(order.zone)) byZone.set(order.zone, new Set());
    byZone.get(order.zone).add(order.storeId);
  }
  const assignment = [];
  for (const [zone, storeSet] of byZone) {
    const vehicles = state.vehicles.filter((vehicle) => vehicle.zone === zone);
    const buckets = vehicles.map(() => []);
    [...storeSet].forEach((storeId, index) => buckets[index % vehicles.length].push(storeId));
    vehicles.forEach((vehicle, index) => {
      if (buckets[index].length > 0) assignment.push({ vehicleId: vehicle.id, stops: buckets[index] });
    });
  }
  return assignment;
}

function play(levelId, extraQuantityPerLine = 0) {
  let state = settled(levelId);
  const orders = state.orders.filter((entry) => !entry.cancelled);

  for (const { vehicleId, stops } of assignStores(state)) {
    for (const storeId of stops) {
      const lines = orders.filter((order) => order.storeId === storeId);
      state = reduceAction(state, { type: 'SELECT_STORE', storeId });
      state = reduceAction(state, { type: 'SELECT_ZONE', zone: lines[0].zone });
      for (const line of lines) {
        const item = engine.itemBySku(line.sku);
        state = reduceAction(state, {
          type: 'ADD_ITEM', sku: line.sku, zone: line.zone,
          weightPerUnit: item.weightPerUnit, quantity: line.quantity + extraQuantityPerLine,
        });
      }
      state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId });
    }
    const best = engine.bestRoute(stops);
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

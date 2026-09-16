const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { reduceAction, startLevel, tick, finishShift, liveMetrics } = require('../app-state.js');

test('level 1 starts with one dry store and one vehicle', () => {
  const state = startLevel(1);
  assert.equal(state.levelId, 1);
  assert.equal(state.stores.length, 1);
  assert.equal(state.vehicles.length, 1);
  assert.deepEqual(state.unlockedZones, ['dry']);
});

test('paused shift does not consume time', () => {
  const state = { ...startLevel(1), paused: true };
  assert.equal(tick(state, 10).secondsRemaining, state.secondsRemaining);
});

test('initial active-shift on-time KPI is zero until the player builds a route', () => {
  assert.equal(liveMetrics(startLevel(1)).onTimePercent, 0);
});

test('on-time KPI and report average all loaded vehicle routes, independent of selection', () => {
  const state = {
    secondsRemaining: 120,
    selectedVehicleId: 'dry-1',
    orders: [],
    loadedPallets: [
      { vehicleId: 'dry-1', zone: 'dry', storeId: 'north', weight: 10, items: [] },
      { vehicleId: 'dry-2', zone: 'dry', storeId: 'west', weight: 10, items: [] },
    ],
    vehicles: [
      { id: 'dry-1', zone: 'dry', capacity: 100, pallets: [{ weight: 10 }] },
      { id: 'dry-2', zone: 'dry', capacity: 100, pallets: [{ weight: 10 }] },
    ],
    routesByVehicle: {
      'dry-1': { stops: ['north'], minutes: 10 },
      'dry-2': { stops: ['west'], minutes: 30 },
    },
    metrics: { spoiledPallets: 0 },
  };

  assert.equal(liveMetrics(state).onTimePercent, 75);
  assert.equal(liveMetrics({ ...state, selectedVehicleId: 'dry-2' }).onTimePercent, 75);
  assert.equal(finishShift(state).report.onTimePercent, 75);
});

test('finished shift returns a report and unlocks the next level', () => {
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });
  const result = finishShift(state);
  assert.equal(result.report.deliveredPercent, 100);
  assert.equal(result.nextLevelId, 2);
});

test('tick applies a scheduled demand change once and exposes short feedback', () => {
  const state = startLevel(7);
  const next = tick(state, 120);
  assert.equal(next.orders.find((order) => order.id === 'order-west').quantity, 4);
  assert.deepEqual(next.events.map((event) => event.type), ['demand-increase']);
  assert.equal(next.feedback.code, 'demand-increase');
});

test('end-shift action keeps all report metrics available at the top level', () => {
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });
  const next = reduceAction(state, { type: 'END_SHIFT' });
  assert.deepEqual(next.report, {
    stars: 3,
    profit: 1260,
    deliveredPercent: 100,
    onTimePercent: 100,
    precisionPercent: 100,
    spoiledPallets: 0,
    reasons: ['Смена отработана идеально'],
  });
});

test('dismiss-feedback removes an operational notification without changing shift state', () => {
  const state = { ...startLevel(1), feedback: { kind: 'info', code: 'vehicle-ready', message: 'Машина готова.' } };
  const next = reduceAction(state, { type: 'DISMISS_FEEDBACK' });
  assert.equal(next.feedback, null);
  assert.equal(next.levelId, 1);
});

test('wrong West pallet after the level 7 demand change does not fulfil demand or count as on time without a route', () => {
  let state = tick(startLevel(7), 120);
  state = reduceAction(state, { type: 'SELECT_STORE', storeId: 'west' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });

  const report = finishShift(state).report;
  assert.equal(report.deliveredPercent, 0);
  assert.equal(report.onTimePercent, 0);
  assert.notEqual(report.stars, 3);
});

test('matching SKU and quantity count as delivered only when their store is on the route', () => {
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });

  const report = finishShift(state).report;
  assert.equal(report.deliveredPercent, 100);
  assert.ok(report.onTimePercent > 0);
});

test('one loaded quantity is allocated only once across matching order lines', () => {
  const pallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 24,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 }],
  };
  const state = {
    ...startLevel(1),
    orders: [
      { id: 'first', storeId: 'north', zone: 'dry', sku: 'water', quantity: 2 },
      { id: 'second', storeId: 'north', zone: 'dry', sku: 'water', quantity: 2 },
    ],
    loadedPallets: [pallet],
    vehicles: [{ id: 'dry-1', zone: 'dry', capacity: 100, pallets: [pallet] }],
    route: { stops: ['north'], minutes: 15 },
  };
  assert.equal(finishShift(state).report.deliveredPercent, 50);
});

test('campaign shell includes briefing, operational feedback, and a complete report', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<script src="levels\.js"><\/script>\s*<script src="scoring\.js"><\/script>\s*<script src="app-state\.js(?:\?[^\"]*)?"><\/script>/);
  for (const id of ['levelBriefing', 'storyCard', 'eventBanner', 'reportDelivered', 'reportOnTime', 'reportSpoiled', 'nextShift']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Следующая смена/);
});

test('finished shift reports which loaded vehicles never got a route built', () => {
  const northPallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const westPallet = {
    storeId: 'west', zone: 'dry', vehicleId: 'dry-2', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const state = {
    ...startLevel(1),
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
  };

  const report = finishShift(state).report;
  assert.match(report.reasons[0], /Маршрут не построен.*dry-2/);
});

test('shiftOutcome describes the shift in plain data for the scorer', () => {
  const { shiftOutcome, reduceAction, startLevel } = require('../app-state.js');
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });

  const outcome = shiftOutcome(state);
  assert.equal(outcome.loadedWeight, 24);
  assert.equal(outcome.usefulWeight, 24);
  assert.deepEqual(outcome.delivered, [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }]);
  assert.deepEqual(outcome.routes, [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }]);
  assert.deepEqual(outcome.vehiclesWithoutRoute, []);
  assert.equal(outcome.demand[0].storeName, 'Северный');
  assert.equal(outcome.demand[0].itemName, 'Вода 1,5 л');
});

test('a perfectly played first level now earns three stars', () => {
  const { reduceAction, startLevel, finishShift } = require('../app-state.js');
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });

  const { report } = finishShift(state);
  assert.equal(report.stars, 3);
  assert.equal(report.deliveredPercent, 100);
  assert.equal(report.onTimePercent, 100);
  assert.equal(report.precisionPercent, 100);
  assert.equal(report.profit, 1260);
  assert.deepEqual(report.reasons, ['Смена отработана идеально']);
});

test('orders screen is populated from current state instead of static level 1 copy', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.doesNotMatch(html, /В этой смене одна срочная заявка: «Северный» ждёт воду из зоны «Сухач»\./);
  assert.match(html, /id="ordersList"/);
  assert.match(app, /nextState\.orders/);
  assert.match(app, /byId\(document, 'ordersList'\)\.innerHTML/);
  assert.match(app, /orderLabel\(order\)/);
});

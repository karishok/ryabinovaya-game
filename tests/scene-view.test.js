const test = require('node:test');
const assert = require('node:assert/strict');
const { warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

test('initial shift selects the order zone without highlighting the only rack', () => {
  const view = warehouseViewFor(startLevel(1));
  // Уровень 1 открывает одну зону: подсвечивать нечего, выбирать не из чего.
  assert.equal(view.activeZone, null);
  assert.equal(view.selectedZone, 'dry');
  assert.equal(view.mode, 'idle');
});

test('idle status names the zone in Russian, not its internal code', () => {
  const view = warehouseViewFor(startLevel(1));
  assert.equal(view.statusText, 'Зона Сухач: можно начинать сборку.');
});

test('idle status names the chilled and frozen zones in Russian on later levels', () => {
  assert.equal(warehouseViewFor(startLevel(4)).statusText, 'Зона Сухач: можно начинать сборку.');
  const chilledFirst = { ...startLevel(4), orders: [{ id: 'x', storeId: 'east', zone: 'chilled', sku: 'milk', quantity: 1 }] };
  assert.equal(warehouseViewFor(chilledFirst).statusText, 'Зона Охлаждёнка: можно начинать сборку.');
  const frozenFirst = { ...startLevel(4), orders: [{ id: 'x', storeId: 'central', zone: 'frozen', sku: 'ice-cream', quantity: 1 }] };
  assert.equal(warehouseViewFor(frozenFirst).statusText, 'Зона Заморозка: можно начинать сборку.');
});

test('items on the current pallet turn the scene into collecting mode', () => {
  const state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'collecting');
  assert.equal(view.palletFillPercent, 24);
});

test('successful loading sends the AGV toward dispatch', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'to-dispatch');
  assert.equal(view.loadedPalletCount, 1);
});

test('loading a pallet builds its route at once, so the truck never waits without one', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = { ...state, feedback: null };
  assert.deepEqual(state.routesByVehicle['dry-1'].stops, ['north']);
  assert.equal(warehouseViewFor(state).mode, 'route-ready');
  assert.equal(warehouseViewFor(state).routeReady, true);
});

test('wrong putaway stops the AGV and names the spoilage', () => {
  /* Порча осталась только на приёмке: там товар действительно простоял в
     чужой температуре. Погрузка в чужой кузов паллету не портит — её
     просто везут к своему фургону. */
  let state = reduceAction(startLevel(5), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'spoiled');
  assert.match(view.statusText, /испорчен/i);
});

test('over-capacity feedback maps to a blocked visual state', () => {
  const state = { ...startLevel(1), feedback: { kind: 'error', code: 'over-capacity', message: 'В машине не осталось места.' } };
  assert.equal(warehouseViewFor(state).mode, 'blocked');
});

test('demand changes request a short pulse on the active zone', () => {
  const state = { ...startLevel(1), feedback: { kind: 'info', code: 'demand-increase', message: 'Заявка выросла.' } };
  assert.equal(warehouseViewFor(state).eventCode, 'demand-increase');
});

test('misplacement highlights the pallet while a full fleet highlights the truck', () => {
  const misplaced = { ...startLevel(1), feedback: { kind: 'error', code: 'wrong-placement', message: 'Не та зона' } };
  const capacity = { ...startLevel(1), feedback: { kind: 'error', code: 'over-capacity', message: 'Нет места' } };
  const fleetFull = { ...startLevel(1), feedback: { kind: 'error', code: 'fleet-full', message: 'Все фургоны загружены' } };
  assert.equal(warehouseViewFor(misplaced).highlightObject, 'pallet');
  assert.equal(warehouseViewFor(capacity).highlightObject, 'truck');
  assert.equal(warehouseViewFor(fleetFull).highlightObject, 'truck');
});

test('pallet-capacity feedback highlights the pallet', () => {
  const state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 9 });
  assert.equal(state.feedback?.code, 'over-capacity');
  assert.equal(warehouseViewFor(state).highlightObject, 'pallet');
});

test('a full fleet highlights the truck instead of blaming the pallet', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 8 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  // На первом уровне сухач обслуживает одна машина, поэтому свободной нет.
  assert.equal(state.feedback?.code, 'fleet-full');
  assert.equal(warehouseViewFor(state).highlightObject, 'truck');
});

test('a single unlocked zone needs no highlight because there is nothing to choose', () => {
  const single = warehouseViewFor({ ...startLevel(1), phase: 'shift' });
  assert.equal(single.activeZone, null);
});

test('three unlocked zones highlight the zone the current order belongs to', () => {
  const many = warehouseViewFor({ ...startLevel(4), phase: 'shift' });
  assert.ok(['dry', 'frozen', 'chilled'].includes(many.activeZone));
});

test('the gates blink only while the stop order can still be shortened', () => {
  const { LEVELS } = require('../levels.js');
  const route = LEVELS.find((level) => level.newMechanic === 'route').id;
  const put = (state, storeId, sku, weightPerUnit, quantity) => {
    let next = reduceAction(state, { type: 'SELECT_STORE', storeId });
    next = reduceAction(next, { type: 'SELECT_ZONE', zone: 'dry' });
    next = reduceAction(next, { type: 'ADD_ITEM', sku, zone: 'dry', weightPerUnit, quantity });
    next = reduceAction(next, { type: 'LOAD_PALLET' });
    return reduceAction(next, { type: 'DISMISS_FEEDBACK' });
  };

  let state = reduceAction(startLevel(route), { type: 'CONTINUE_STORY' });
  state = put(state, 'north', 'water', 12, 2);
  /* Одна остановка переставлять нечем — мигать не над чем. Раньше ворота
     мигали всю смену с первой же погруженной паллеты. */
  assert.equal(warehouseViewFor(state).routeCanBeShortened, false);

  state = put(state, 'central', 'bread', 6, 2);
  assert.equal(warehouseViewFor(state).routeCanBeShortened, true, 'порядок можно сократить — есть ради чего открыть ворота');

  state = reduceAction(state, { type: 'SELECT_VEHICLE', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'MOVE_STOP', index: 1, direction: -1 });
  assert.equal(warehouseViewFor(state).routeCanBeShortened, false, 'порядок стал лучшим — внимание больше не нужно');
});

test('an unfinished pallet outranks an already routed truck', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  state = reduceAction(state, { type: 'DISMISS_FEEDBACK' });
  assert.equal(warehouseViewFor(state).mode, 'route-ready');

  // Игрок начал следующую паллету: подсвечивать надо её, а не транспорт.
  const collecting = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  assert.equal(warehouseViewFor(collecting).mode, 'collecting');
});

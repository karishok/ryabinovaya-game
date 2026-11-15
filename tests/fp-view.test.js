const test = require('node:test');
const assert = require('node:assert/strict');
const appState = require('../app-state.js');
const engine = require('../game-engine.js');
const sceneView = require('../scene-view.js');
const fpView = require('../fp-view.js');

const { reduceAction, startLevel } = appState;
const { locationAfter, frameFor, canPick, FRAMES, LOCATIONS } = fpView;

/* Проигрывает действия и записывает, где кладовщик оказался после каждого.
   Действие с полем view — действие экрана: редьюсер его не знает, меняется
   только то, что перечислено в view. */
function walk(state, location, actions) {
  const trail = [];
  for (const action of actions) {
    const before = state;
    state = action.view ? { ...state, ...action.view } : reduceAction(state, action);
    const moved = locationAfter(location, before, state, action);
    location = moved.location;
    trail.push(moved.via ? `${moved.via}>${location}` : location);
  }
  return { state, location, trail };
}
const add = (sku, quantity) => {
  const item = engine.itemBySku(sku);
  return { type: 'ADD_ITEM', sku, zone: item.zone, weightPerUnit: item.weightPerUnit, quantity };
};
const shiftOf = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });
const goShelf = (zone) => ({ type: 'GO_SHELF', zone, view: {} });
const goHub = { type: 'GO_HUB', view: { builderOpen: false } };
const goShipping = { type: 'GO_SHIPPING', view: { builderOpen: false } };
const openBuilder = { type: 'OPEN_BUILDER', view: { builderOpen: true } };

test('there are exactly six places and each has a frame', () => {
  assert.deepEqual(LOCATIONS, ['hub', 'receiving', 'shelf:dry', 'shelf:chilled', 'shelf:frozen', 'shipping']);
  for (const location of LOCATIONS) {
    assert.match(FRAMES[location], /^assets\/fp\/[a-z-]+\.webp$/);
    assert.deepEqual(frameFor(location), { key: location, src: FRAMES[location] });
  }
  assert.deepEqual(frameFor('nowhere'), { key: 'hub', src: FRAMES.hub });
});

test('outside a shift the worker is always in the aisle', () => {
  const briefing = startLevel(1);
  assert.deepEqual(locationAfter('shipping', briefing, briefing, { type: 'OPEN_GUIDE' }), { location: 'hub', via: null });
});

test('guided receiving: the truck, then the aisle to choose a zone, then the shelf the player chose', () => {
  const { state, trail } = walk(startLevel(2), 'hub', [
    { type: 'CONTINUE_STORY' },
    { type: 'RECEIVE_PALLET' },
    { type: 'TICK' },
  ]);
  assert.deepEqual(trail, ['receiving', 'hub', 'hub']);

  const pallet = state.inbound.find((entry) => entry.status === 'received');
  const right = walk(state, 'hub', [{ type: 'PLACE_PALLET', zone: pallet.zone }, { type: 'TICK' }, { type: 'OPEN_TSD' }]);
  // Полка держится, пока игрок не сделал следующий шаг; дальше — следующая фура.
  assert.deepEqual(right.trail, [`shelf:${pallet.zone}`, `shelf:${pallet.zone}`, 'receiving']);

  const wrongZone = pallet.zone === 'dry' ? 'frozen' : 'dry';
  const wrong = walk(state, 'hub', [{ type: 'PLACE_PALLET', zone: wrongZone }]);
  assert.equal(wrong.state.feedback.code, 'wrong-placement');
  // Испорченная паллета стоит там, куда её привезли, а не там, где ей место.
  assert.deepEqual(wrong.trail, [`shelf:${wrongZone}`]);
});

test('placement never marks the right zone', () => {
  const placing = reduceAction(shiftOf(2), { type: 'RECEIVE_PALLET' });
  const view = sceneView.warehouseViewFor(placing);
  assert.equal(view.awaitingPlacement, true);
  assert.equal(view.activeZone, null);
});

test('a pallet received away from the dock passes the truck on the way to the aisle', () => {
  const shift = shiftOf(4);
  const { trail, state } = walk(shift, 'shipping', [{ type: 'ACCEPT_TASK' }]);
  assert.equal(sceneView.sceneInboundFor(state).status, 'received');
  assert.deepEqual(trail, ['receiving>hub']);
});

test('guided picking: the card drives to the shelf and to shipping, the gate is the player\'s', () => {
  const { trail } = walk(shiftOf(1), 'hub', [
    openBuilder,
    add('water', 2),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'frozen' },
    { type: 'LOAD_PALLET', gateZone: 'dry' },
  ]);
  assert.deepEqual(trail, ['shelf:dry', 'shelf:dry', 'shipping', 'shipping', 'shipping']);
});

test('queue picking: the aisle, a wrong shelf, back, the right shelf, shipping', () => {
  const { trail, state } = walk(shiftOf(3), 'shipping', [
    { type: 'ACCEPT_TASK' },
    goShelf('frozen'),
    goHub,
    goShelf('chilled'),
    add('milk', 2),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'chilled' },
  ]);
  assert.deepEqual(trail, ['hub', 'shelf:frozen', 'hub', 'shelf:chilled', 'shelf:chilled', 'shipping', 'shipping']);
  assert.equal(appState.currentTaskFor(state), null);
});

test('an order heavier than a pallet brings the worker back to the aisle after loading', () => {
  let state = shiftOf(3);
  state = walk(state, 'hub', [{ type: 'ACCEPT_TASK' }, add('milk', 2), { type: 'LOAD_PALLET', gateZone: 'chilled' }]).state;
  const { trail, state: after } = walk(state, 'shipping', [
    { type: 'ACCEPT_TASK' },
    goShelf('dry'),
    add('water', 8),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'dry' },
  ]);
  // 120 кг воды при паллете на 100: задание ещё в работе, но следующая
  // паллета, как и любая, начинается с проезда.
  assert.equal(appState.currentTaskFor(after).id, 'pick:order-north');
  assert.deepEqual(trail, ['hub', 'shelf:dry', 'shelf:dry', 'shipping', 'hub']);
});

test('taking a pallet off a truck starts at shipping', () => {
  let state = walk(shiftOf(3), 'hub', [{ type: 'ACCEPT_TASK' }, add('milk', 2), { type: 'LOAD_PALLET', gateZone: 'chilled' }]).state;
  state = { ...state, orders: state.orders.map((order) => order.id === 'order-east' ? { ...order, cancelled: true } : order) };
  const { trail, state: after } = walk(state, 'hub', [{ type: 'ACCEPT_TASK' }]);
  assert.equal(appState.currentTaskFor(after).kind, 'unload');
  assert.deepEqual(trail, ['shipping']);
});

test('an open builder means the worker stands at the shelf of the pallet zone', () => {
  const shift = shiftOf(2);
  const placed = { ...shift, inbound: shift.inbound.map((entry) => ({ ...entry, status: 'placed' })) };
  const open = { ...placed, builderOpen: true, pallet: { ...placed.pallet, zone: 'chilled' } };
  assert.deepEqual(locationAfter('shelf:dry', { ...placed, builderOpen: true }, open, { type: 'SELECT_ZONE', zone: 'chilled' }), { location: 'shelf:chilled', via: null });
});

test('canPick: only when there is something to collect right now', () => {
  assert.equal(canPick(startLevel(1)), false);
  assert.equal(canPick(shiftOf(1)), true);
  // Вводная смена с фурами у ворот: сначала приёмка.
  assert.equal(canPick(shiftOf(2)), false);
  // Смена с очередью: пока задание не принято, собирать нечего.
  assert.equal(canPick(shiftOf(3)), false);
  assert.equal(canPick(reduceAction(shiftOf(3), { type: 'ACCEPT_TASK' })), true);
});

test('sceneInboundFor: guided shifts see the dock, queue shifts only the accepted task', () => {
  assert.equal(sceneView.sceneInboundFor(shiftOf(2)).status, 'arrived');
  assert.equal(sceneView.sceneInboundFor(shiftOf(4)), null);
  assert.equal(sceneView.sceneInboundFor(reduceAction(shiftOf(4), { type: 'ACCEPT_TASK' })).id, 'in-butter');
});

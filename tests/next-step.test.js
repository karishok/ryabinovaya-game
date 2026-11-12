const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStepFor, warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

const add = (state, quantity = 1) => reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity });
const begin = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });

/* Карточка «Сейчас» должна отвечать на вопрос «куда нажать» в каждом
   состоянии смены, а не только после первого удачного действия. */

test('there is no step before the shift starts: the briefing owns the screen', () => {
  assert.equal(nextStepFor(startLevel(1)), null);
});

test('an untouched shift already points at the pallet, before any item is added', () => {
  const step = nextStepFor(begin(1));
  assert.equal(step.key, 'collect');
  assert.equal(step.action, 'OPEN_BUILDER');
  assert.equal(step.focus, 'pallet');
  assert.match(step.title, /Тушино/);
  assert.match(step.detail, /ещё 2 шт\./);
});

test('a half-built pallet keeps the player on the pallet and counts what is left', () => {
  const step = nextStepFor(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  assert.equal(step.key, 'collect');
  assert.match(step.detail, /ещё 1 шт\./);
});

test('a pallet that covers the order switches the step to loading', () => {
  const state = add(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  const step = nextStepFor(state);
  assert.equal(step.key, 'load');
  assert.equal(step.action, 'LOAD_PALLET');
  assert.equal(step.focus, 'pallet');
});

test('with every order loaded the step is to end the shift', () => {
  let state = add(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  const step = nextStepFor(state);
  assert.equal(step.key, 'finish');
  assert.equal(step.action, 'END_SHIFT');
});

test('an arrived delivery comes before picking, and placement names the zone', () => {
  let state = begin(2);
  let step = nextStepFor(state);
  assert.equal(step.key, 'receive');
  assert.equal(step.action, 'OPEN_TSD');
  assert.equal(step.focus, 'dock');
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  step = nextStepFor(state);
  assert.equal(step.key, 'place');
  assert.equal(step.action, 'SELECT_ZONE');
  assert.equal(step.zone, 'dry');
  assert.equal(step.focus, 'zone');
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(nextStepFor(state).key, 'collect');
});

test('the scene view carries the focus of the step so the hotspot can light up', () => {
  const view = warehouseViewFor(begin(1));
  assert.equal(view.focus, 'pallet');
  assert.equal(view.nextStep.key, 'collect');
});

/* Игрок, который не думает: делает только то, что называет nextStepFor.
   Если так проходится каждая смена на три звезды — шаг нигде не заводит в
   тупик и не называет действие, которое нельзя выполнить. На сменах без
   поводыря карточка этот шаг не показывает, но расчёт остаётся тем же, и
   тест доказывает, что смена решаема. */
const engine = require('../game-engine.js');
const { LEVELS } = require('../levels.js');
const { tick, finishShift, activeOrderFor, remainingFor, orphanPalletsFor } = require('../app-state.js');

function followTheCard(levelId) {
  let state = begin(levelId);
  const seen = [];
  for (let guard = 0; guard < 80; guard += 1) {
    state = tick(state, 1);
    const step = nextStepFor(state);
    seen.push(step.key);
    if (step.key === 'finish') break;
    if (step.key === 'receive') state = reduceAction(state, { type: 'RECEIVE_PALLET' });
    else if (step.key === 'place') state = reduceAction(state, { type: 'PLACE_PALLET', zone: step.zone });
    else if (step.key === 'collect') {
      const order = activeOrderFor(state);
      const item = engine.itemBySku(order.sku);
      assert.equal(state.pallet.storeId, order.storeId, `уровень ${levelId}: паллета адресована не тому даркстору, что в задании`);
      assert.equal(state.pallet.zone, order.zone, `уровень ${levelId}: паллета не в зоне задания`);
      const onPallet = state.pallet.items.filter((entry) => entry.sku === order.sku).reduce((sum, entry) => sum + entry.quantity, 0);
      const fits = Math.floor((state.pallet.capacity - state.pallet.weight) / item.weightPerUnit);
      const quantity = Math.min(remainingFor(state, order) - onPallet, fits);
      const next = reduceAction(state, { type: 'ADD_ITEM', sku: order.sku, zone: order.zone, weightPerUnit: item.weightPerUnit, quantity });
      assert.notEqual(next.feedback?.kind, 'error', `уровень ${levelId}: сборка упёрлась — ${next.feedback?.message}`);
      state = next;
    } else if (step.key === 'load') {
      const next = reduceAction(state, { type: 'LOAD_PALLET' });
      assert.notEqual(next.feedback?.kind, 'error', `уровень ${levelId}: погрузка упёрлась — ${next.feedback?.message}`);
      state = next;
    } else if (step.key === 'unload') {
      const [orphan] = orphanPalletsFor(state);
      assert.equal(step.vehicleId, orphan.vehicleId);
      state = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex });
    } else if (step.key === 'route') {
      for (const vehicle of state.vehicles) {
        const stops = state.routeStopsByVehicle[vehicle.id] || [];
        if (stops.length > 1) state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: vehicle.id, stops: engine.bestRoute(stops).stops });
      }
    } else assert.fail(`неизвестный шаг ${step.key}`);
  }
  return { report: finishShift(state).report, seen, state };
}

for (const level of LEVELS) {
  test(`level ${level.id} "${level.title}" is completed with three stars by following the card alone`, () => {
    const { report, seen } = followTheCard(level.id);
    assert.equal(seen.at(-1), 'finish', `карточка не дошла до конца: ${seen.join(' → ')}`);
    assert.equal(report.deliveredPercent, 100, `доставка, шаги: ${seen.join(' → ')}`);
    assert.equal(report.stars, 3, `звёзды, причины: ${report.reasons.join('; ')}`);
  });
}

test('the two live shifts make the player unload a cancelled order and re-plan a route', () => {
  const changing = followTheCard(5).seen;
  assert.ok(changing.includes('unload'), 'на «План меняется» отменённую паллету приходится снять');
  assert.ok(changing.indexOf('receive') > changing.indexOf('load'), 'фура с мороженым приходит уже во время смены');
  const rush = followTheCard(6).seen;
  for (const key of ['receive', 'place', 'collect', 'load', 'unload', 'route']) {
    assert.ok(rush.includes(key), `в «Час пик» должен встретиться шаг ${key}`);
  }
});

test('a pallet that cannot take one more unit is loaded, not topped up', () => {
  let state = reduceAction(begin(4), { type: 'ACCEPT_TASK' });
  state = add(state, 8);
  const step = nextStepFor(state);
  assert.equal(step.key, 'load');
  assert.match(step.detail, /Остаток заявки \(2 шт\.\)/);
});

/* Смены без поводыря: правила уже известны, и карточка «Сейчас» молчит.
   Вместо шага игрок видит состояние — доску заявок — и решает сам. */
const unguided = LEVELS.filter((level) => level.guided === false).map((level) => level.id);

test('only the two live shifts drop the guidance, and they are the last two', () => {
  assert.deepEqual(unguided, [5, 6]);
});

test('an unguided shift shows no step, no focus and no zone or route hint', () => {
  for (const levelId of unguided) {
    let state = begin(levelId);
    let view = warehouseViewFor(state);
    assert.equal(view.guided, false);
    assert.equal(view.nextStep, null);
    assert.equal(view.focus, '');
    assert.equal(view.activeZone, null);
    assert.equal(view.routeCanBeShortened, false);
    assert.ok(Array.isArray(view.orderBoard) && view.orderBoard.length === state.orders.length);
  }
  // На приёмке зона-цель не выделена: она написана в накладной.
  let state = begin(6);
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  const placing = warehouseViewFor(state);
  assert.equal(placing.placementZone, 'chilled', 'вывески остаются кнопками размещения');
  assert.equal(placing.activeZone, null, 'но нужная среди них не подсвечена');
});

test('a guided shift has the card and no board', () => {
  const view = warehouseViewFor(begin(4));
  assert.equal(view.guided, true);
  assert.equal(view.orderBoard, null);
  assert.equal(view.nextStep.key, 'collect');
});

test('the order board reports state: progress, missing stock and a cancelled pallet still in the truck', () => {
  const { orderBoardFor } = require('../scene-view.js');
  let state = begin(5);
  let board = orderBoardFor(state);
  assert.deepEqual(board.map((row) => row.status), ['open', 'open', 'open', 'open']);
  assert.equal(board.at(-1).note, 'нет на складе', 'мороженое ещё в пути');

  // Игрок без подсказок: вода, хлеб, хлеб — и Тушино отменяет заявку.
  const ship = (sku, weightPerUnit, storeId) => {
    state = reduceAction(state, { type: 'SELECT_STORE', storeId });
    state = reduceAction(state, { type: 'ADD_ITEM', sku, zone: 'dry', weightPerUnit, quantity: 2 });
    state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  };
  ship('water', 12, 'north');
  ship('bread', 6, 'west');
  ship('bread', 6, 'west');

  board = orderBoardFor(state);
  const north = board.find((row) => row.orderId === 'order-north');
  assert.equal(north.status, 'cancelled');
  assert.equal(north.alert, true);
  assert.match(north.note, /в кузове 2 шт\./);
  assert.equal(board.find((row) => row.orderId === 'order-west').status, 'done');
  // Диспетчер сообщает факт, а что делать с паллетой — решает игрок.
  assert.equal(state.feedback.code, 'order-cancelled');
  assert.doesNotMatch(state.feedback.message, /снимите/);

  const [orphan] = orphanPalletsFor(state);
  state = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex });
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-north').alert, false);
});

test('a guided shift still tells the player to unload a cancelled pallet', () => {
  // То же событие на смене с поводырём называет действие прямо.
  let state = { ...begin(5), levelId: 4 };
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  state = { ...state, scheduledEvents: [{ type: 'order-cancelled', orderId: 'order-north', afterLoadedPallets: 1 }], appliedEventIndexes: [] };
  state = tick(state, 1);
  assert.match(state.feedback.message, /снимите/);
  assert.equal(nextStepFor(state).key, 'unload');
});

test('the board, the order pick and the dock hotspot exist on the page', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /id="orderBoard"[^>]*hidden/);
  assert.match(app, /data-action="PICK_ORDER"/);
  assert.match(app, /action === 'PICK_ORDER'/);
  // Ворота приёмки обязаны позиционироваться как остальные хотспоты.
  assert.match(css, /\.scene-pallet,\s*\.truck-bay,\s*\.scene-dock\s*\{\s*position:\s*absolute/);
});

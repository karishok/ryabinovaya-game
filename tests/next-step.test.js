const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStepFor, warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

const add = (state, quantity = 1) => reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity });
const begin = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });
// Смены ищем по тому, что они вводят, а не по номеру: кампанию перекраивают.
const shiftFor = (mechanic) => require('../levels.js').LEVELS.find((level) => level.teaches.includes(mechanic)).id;
const TUTORIAL = shiftFor('inbound-receive');
const CAPACITY = shiftFor('capacity');
const MIXED = shiftFor('mixed-plan');
const RUSH = shiftFor('exam');

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

test('an arrived delivery comes before picking, and placement never names the zone', () => {
  let state = begin(TUTORIAL);
  let step = nextStepFor(state);
  assert.equal(step.key, 'receive');
  assert.equal(step.action, 'OPEN_TSD');
  assert.equal(step.focus, 'dock');
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  step = nextStepFor(state);
  assert.equal(step.key, 'place');
  // У размещения нет кнопки и нет зоны: шаг говорит «что», а «куда» решает игрок.
  assert.equal(step.action, null);
  assert.equal(Object.hasOwn(step, 'zone'), false);
  assert.equal(step.focus, 'zones');
  assert.doesNotMatch(`${step.title} ${step.detail}`, /Сухач|\+18°/);
  // Пока на приёмке стоят фуры, отбор ждёт: следующая — снова приёмка.
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(nextStepFor(state).key, 'receive');
  for (const zone of ['chilled', 'frozen']) {
    state = reduceAction(state, { type: 'RECEIVE_PALLET' });
    state = reduceAction(state, { type: 'PLACE_PALLET', zone });
  }
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
const { LEVELS, ZONE_NAMES, ZONE_MARKS } = require('../levels.js');
const { tick, finishShift, activeOrderFor, remainingFor, orphanPalletsFor } = require('../app-state.js');

function followTheCard(levelId) {
  let state = begin(levelId);
  const guided = LEVELS.find((level) => level.id === levelId).guided !== false;
  const seen = [];
  for (let guard = 0; guard < 240; guard += 1) {
    state = tick(state, 1);
    const step = nextStepFor(state);
    if (seen.at(-1) !== step.key || step.key !== 'wait') seen.push(step.key);
    if (step.key === 'finish') break;
    // Ждать — значит просто дать смене идти: фура приедет, фургон вернётся.
    if (step.key === 'wait') continue;
    if (step.key === 'receive') state = reduceAction(state, { type: 'RECEIVE_PALLET' });
    // Зону шаг не называет — бот знает её из состояния, как игрок из головы.
    else if (step.key === 'place') state = reduceAction(state, { type: 'PLACE_PALLET', zone: state.inbound.find((pallet) => pallet.status === 'received').zone });
    else if (step.key === 'collect') {
      const order = state.orders.find((entry) => entry.id === step.orderId);
      const item = engine.itemBySku(order.sku);
      /* На смене с поводырём паллета обязана быть уже адресована заявке из
         карточки. Без поводыря игрок выбирает заявку на доске — бот делает
         то же, что нажатие на её строку. */
      if (state.pallet.weight === 0 && !guided) {
        state = reduceAction(state, { type: 'SELECT_ZONE', zone: order.zone });
        state = reduceAction(state, { type: 'SELECT_STORE', storeId: order.storeId });
      }
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
  const changing = followTheCard(MIXED).seen;
  assert.ok(changing.includes('unload'), 'на «План меняется» отменённую паллету приходится снять');
  assert.ok(changing.indexOf('receive') > changing.indexOf('load'), 'фура с мороженым приходит уже во время смены');
  const rush = followTheCard(RUSH).seen;
  for (const key of ['receive', 'place', 'collect', 'load', 'unload', 'route']) {
    assert.ok(rush.includes(key), `в «Час пик» должен встретиться шаг ${key}`);
  }
});

test('every twist of a working shift actually happens when it is played', () => {
  const steps = (mechanic) => followTheCard(shiftFor(mechanic)).seen;
  const count = (list, key) => list.filter((entry) => entry === key).length;
  assert.equal(count(steps('cancellation'), 'unload'), 2, 'обе отмены застают паллету в кузове');
  assert.equal(count(steps('late-delivery'), 'receive'), 3, 'одна фура у ворот и две приезжают по ходу');
  assert.ok(steps('capacity').includes('route'));
  assert.ok(steps('long-routes').includes('route'));
  assert.ok(steps('late-vehicle').includes('route'));
  // На «Дозаказе» три заявки возвращаются: семь паллет вместо четырёх.
  assert.equal(count(steps('dynamic-demand'), 'load'), 7);
});

test('the step skips an order that cannot be done yet and waits when none can', () => {
  // Мороженого нет на складе, фура в пути: шаг берёт заявки, которые выполнимы.
  let state = begin(MIXED);
  assert.equal(nextStepFor(state).orderId, 'order-north');
  state = { ...state, orders: state.orders.filter((order) => order.id === 'order-central') };
  assert.equal(nextStepFor(state).key, 'wait', 'осталась одна заявка, и собрать её нечем');
  state = tick(state, 30);
  assert.equal(nextStepFor(state).key, 'receive', 'фура приехала — ожидание кончилось');
});

test('a van still on its run refuses the pallet honestly and comes back on its own', () => {
  const lateVan = shiftFor('late-vehicle');
  let state = begin(lateVan);
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'dry-2').ready, false);
  // Вода занимает единственный готовый сухой фургон почти целиком.
  state = add(state, 8);
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  // Хлеб уже не влезает: отказ говорит про рейс, а не «снимите лишнее».
  state = reduceAction(state, { type: 'SELECT_STORE', storeId: 'west' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 5 });
  const refused = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(refused.feedback.code, 'vehicle-not-ready');
  assert.match(refused.feedback.message, /в рейсе/);
  assert.doesNotMatch(refused.feedback.message, /снимите/);
  // Через сорок секунд фургон возвращается сам, и та же паллета грузится.
  const back = tick(refused, 40);
  assert.equal(back.vehicles.find((vehicle) => vehicle.id === 'dry-2').ready, true);
  assert.match(back.feedback.message, /Сухач фургон №2.*вернулся из рейса/);
  assert.equal(reduceAction(back, { type: 'LOAD_PALLET' }).feedback.code, 'pallet-loaded');
});

test('a pallet that cannot take one more unit is loaded, not topped up', () => {
  let state = reduceAction(begin(CAPACITY), { type: 'ACCEPT_TASK' });
  state = add(state, 8);
  const step = nextStepFor(state);
  assert.equal(step.key, 'load');
  assert.match(step.detail, /Остаток заявки \(2 шт\.\)/);
});

/* Смены без поводыря: правила уже известны, и карточка «Сейчас» молчит.
   Вместо шага игрок видит состояние — доску заявок — и решает сам. */
const unguided = LEVELS.filter((level) => level.guided === false).map((level) => level.id);

test('only the first two shifts are guided; the other eight leave the player alone', () => {
  assert.deepEqual(LEVELS.filter((level) => level.guided !== false).map((level) => level.id), [1, 2]);
  assert.deepEqual(unguided, [3, 4, 5, 6, 7, 8, 9, 10]);
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
  // На приёмке вывески становятся кнопками, но верная среди них не выделена.
  let state = begin(RUSH);
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  const placing = warehouseViewFor(state);
  assert.equal(placing.awaitingPlacement, true);
  assert.equal(placing.activeZone, null);
});

test('no shift reveals where an incoming pallet belongs, guided or not', () => {
  const { terminalViewFor } = require('../tsd-view.js');
  const { orderBoardFor } = require('../scene-view.js');
  for (const level of LEVELS.filter((entry) => (entry.inbound || []).length > 0)) {
    let state = begin(level.id);
    const pallet = state.inbound[0];
    const names = new RegExp(`${ZONE_NAMES[pallet.zone]}|${ZONE_MARKS[pallet.zone].replace('+', '\\+')}`);
    for (const stage of ['arrived', 'received']) {
      if (stage === 'received') state = reduceAction(state, { type: 'RECEIVE_PALLET' });
      const scene = warehouseViewFor(state);
      const tsd = terminalViewFor(state);
      const shown = [scene.statusText, scene.nextStep?.title, scene.nextStep?.detail, scene.nextStep?.actionLabel,
        tsd.title, tsd.message, tsd.compactTask, tsd.compactMeta, tsd.zoneName, tsd.orderText].join(' ');
      assert.doesNotMatch(shown, names, `смена ${level.id}, паллета ${stage}: зона названа`);
      assert.equal(scene.activeZone, null, `смена ${level.id}: вывеска подсвечена`);
    }
    // И доска заявок не показывает температуру товара, которого ещё нет в зоне.
    const row = orderBoardFor(state).find((entry) => entry.itemName === engine.itemBySku(pallet.sku).name);
    assert.equal(row.zoneMark, '');
  }
});

test('every zone sign lights up alike while a received pallet waits, on any shift', () => {
  const fs = require('node:fs');
  const css = fs.readFileSync('styles.css', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  // Класс is-target получают все вывески разом — от того, ждёт ли паллета зону.
  assert.match(app, /classList\.toggle\('is-target', Boolean\(view\.awaitingPlacement\)\)/);
  assert.match(css, /\.scene-zone-sign\.is-target\s*\{[^}]*animation:\s*focus-pulse/);
  for (const levelId of [TUTORIAL, RUSH]) {
    const state = reduceAction(begin(levelId), { type: 'RECEIVE_PALLET' });
    assert.equal(warehouseViewFor(state).awaitingPlacement, true);
    assert.match(state.feedback.message, /Выберите зону на схеме/);
  }
});

test('a guided shift has the card and no board', () => {
  const view = warehouseViewFor(begin(TUTORIAL));
  assert.equal(view.guided, true);
  assert.equal(view.orderBoard, null);
  assert.equal(view.nextStep.key, 'receive');
});

test('the order board reports state: progress, missing stock and a cancelled pallet still in the truck', () => {
  const { orderBoardFor } = require('../scene-view.js');
  let state = begin(MIXED);
  let board = orderBoardFor(state);
  assert.deepEqual(board.map((row) => row.status), ['open', 'open', 'open', 'open']);
  assert.equal(board.at(-1).note, 'фура в пути', 'мороженого нет, но оно едет — это не тупик');

  // Игрок без подсказок: вода, хлеб, хлеб — и Тушино отменяет заявку.
  const ship = (sku, weightPerUnit, storeId) => {
    state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'dry' });
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

test('the board says where missing goods are: on the road, at the dock, or lost', () => {
  const { orderBoardFor } = require('../scene-view.js');
  const iceNote = (state) => orderBoardFor(state).find((row) => row.orderId === 'order-central').note;
  let state = begin(MIXED);
  assert.equal(iceNote(state), 'фура в пути');

  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  assert.equal(iceNote(state), 'стоит на приёмке', 'фура приехала после первой погрузки');

  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  const spoiled = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(iceNote(spoiled), 'поставка испорчена', 'ошибка зоны — заявку уже не закрыть, и доска это говорит');

  const placed = reduceAction(state, { type: 'PLACE_PALLET', zone: 'frozen' });
  assert.equal(iceNote(placed), '', 'товар в зоне — заявку можно собирать');
});

test('a truck that is on the road also arrives for a player who just waits', () => {
  const { orderBoardFor } = require('../scene-view.js');
  let state = begin(MIXED);
  state = tick(state, 29);
  assert.equal(state.inbound.length, 0);
  state = tick(state, 1);
  assert.equal(state.inbound.length, 1, 'через полминуты фура приезжает сама, без единой погрузки');
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-central').note, 'стоит на приёмке');
  // И не приезжает второй раз, когда наконец погружена первая паллета.
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'frozen' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  assert.equal(state.inbound.length, 1);
});

test('a guided shift still tells the player to unload a cancelled pallet', () => {
  // То же событие на смене с поводырём называет действие прямо.
  let state = { ...begin(MIXED), levelId: 1 };
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  state = { ...state, scheduledEvents: [{ type: 'order-cancelled', orderId: 'order-north', afterLoadedPallets: 1 }], appliedEventIndexes: [] };
  state = tick(state, 1);
  assert.match(state.feedback.message, /снимите/);
  assert.equal(nextStepFor(state).key, 'unload');
});

test('the board is a read-only display and the dock hotspot sits at the gates', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /id="orderBoard"[^>]*hidden/);
  // Доска — табло: заявку с неё не выбирают, задания выдаёт ТСД.
  assert.doesNotMatch(app, /PICK_ORDER/);
  assert.doesNotMatch(app, /<button class="order-line"/);
  // Ворота приёмки обязаны позиционироваться как остальные хотспоты.
  assert.match(css, /\.scene-pallet,\s*\.truck-bay,\s*\.scene-dock\s*\{\s*position:\s*absolute/);
});

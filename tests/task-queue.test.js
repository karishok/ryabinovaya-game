const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const engine = require('../game-engine.js');
const A = require('../app-state.js');
const { LEVELS } = require('../levels.js');
const { terminalViewFor } = require('../tsd-view.js');
const { warehouseViewFor, orderBoardFor } = require('../scene-view.js');

const { reduceAction, startLevel, tick, taskQueueFor, currentTaskFor, nextTaskFor } = A;
const shiftFor = (mechanic) => LEVELS.find((level) => level.teaches.includes(mechanic)).id;
const begin = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });
const ids = (state) => taskQueueFor(state).map((task) => task.id);
const MIXED = shiftFor('mixed-plan');
const CAPACITY = shiftFor('capacity');
const WORKING = LEVELS.filter((level) => level.guided === false);
// Смена без сроков: тесты про саму очередь не должны зависеть от того, кто когда уезжает.
const untimed = (state) => ({ ...state, vehicles: state.vehicles.map((vehicle) => ({ ...vehicle, departsAt: null })) });

/* Выполнить предложенное задание целиком, как игрок: принять, сделать работу,
   дать смене секунду на события. */
function doTask(input) {
  let state = reduceAction(input, { type: 'ACCEPT_TASK' });
  const task = currentTaskFor(state);
  if (!task) return state;
  if (task.kind === 'receive') {
    const pallet = state.inbound.find((entry) => entry.id === task.inboundId);
    return tick(reduceAction(state, { type: 'PLACE_PALLET', zone: pallet.zone }), 1);
  }
  if (task.kind === 'unload') {
    const orphan = A.orphanPalletsFor(state).find((entry) => entry.vehicleId === task.vehicleId);
    return tick(reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex }), 1);
  }
  for (let guard = 0; guard < 4 && currentTaskFor(state)?.id === task.id; guard += 1) {
    for (const orderId of currentTaskFor(state).orderIds) {
      const order = state.orders.find((entry) => entry.id === orderId);
      const item = engine.itemBySku(order.sku);
      const quantity = Math.min(A.remainingFor(state, order), Math.floor((state.pallet.capacity - state.pallet.weight) / item.weightPerUnit));
      if (quantity > 0) state = reduceAction(state, { type: 'ADD_ITEM', sku: order.sku, zone: order.zone, weightPerUnit: item.weightPerUnit, quantity });
    }
    state = reduceAction(state, { type: 'LOAD_PALLET' });
  }
  return tick(state, 1);
}
// Работать, пока терминал не предложит нужное задание.
function advanceTo(input, taskId) {
  let state = input;
  for (let guard = 0; guard < 20 && nextTaskFor(state)?.id !== taskId; guard += 1) state = doTask(state);
  assert.equal(nextTaskFor(state)?.id, taskId, `терминал так и не предложил ${taskId}`);
  return state;
}

/* На сменах без поводыря работу выдаёт ТСД: одно задание за раз. В жизни
   кладовщик заявки не выбирает — они приходят на терминал. Порядок строит
   сам терминал; у игрока одно решение об очереди — взять ли срочное
   задание, бросив начатую паллету. */

test('the queue lists work in arrival order and sinks what cannot be done yet', () => {
  const state = begin(MIXED);
  // Мороженого нет на складе: его заявка в хвосте, терминал её не предлагает.
  assert.deepEqual(ids(state), ['pick:order-north', 'pick:order-west', 'pick:order-east', 'pick:order-central']);
  assert.equal(taskQueueFor(state).at(-1).blocked, 'no-stock');
  assert.equal(nextTaskFor(state).id, 'pick:order-north');
  assert.equal(currentTaskFor(state), null);
});

test('the terminal hands out the leaving van\'s work first', () => {
  /* Молоко в списке заявок последнее, но фургон охлаждёнки уходит первым —
     терминал ставит его вперёд сам. Раньше он этого не делал, а игроку
     давали три «отложения»; было неясно, когда откладывать. */
  const state = begin(CAPACITY);
  assert.equal(state.orders.at(-1).id, 'order-east');
  assert.equal(nextTaskFor(state).id, 'pick:order-east');
  // Без срока порядок — как в списке заявок.
  assert.equal(nextTaskFor(untimed(state)).id, 'pick:order-north');
});

test('there is no deferring: the terminal offers one task and one button', () => {
  const state = begin(CAPACITY);
  assert.equal(reduceAction(state, { type: 'DEFER_TASK' }).activeTaskId, null, 'действия «отложить» больше нет');
  assert.deepEqual(ids(reduceAction(state, { type: 'DEFER_TASK' })), ids(state));
  const view = terminalViewFor(state);
  assert.equal(view.canAccept, true);
  assert.equal(Object.hasOwn(view, 'canDefer'), false);
  assert.equal(Object.hasOwn(state, 'defersLeft'), false);
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.doesNotMatch(`${html}\n${app}`, /DEFER_TASK|tsdDefer|Отложить/);
});

test('accepting a task addresses the pallet to it and makes it the current work', () => {
  const state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  assert.equal(currentTaskFor(state).id, 'pick:order-north');
  assert.equal(state.pallet.storeId, 'north');
  assert.equal(state.pallet.zone, 'dry');
  // Второе задание поверх принятого не берётся: сначала закончить.
  assert.equal(reduceAction(state, { type: 'ACCEPT_TASK' }), state);
});

test('a task finishes when its work is done, and the terminal calls for the next one', () => {
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(currentTaskFor(state), null);
  assert.equal(state.tsd.signal, 'new');
  assert.equal(nextTaskFor(state).id, 'pick:order-west');
});

test('an order heavier than a pallet stays the current task between its two pallets', () => {
  let state = advanceTo(begin(CAPACITY), 'pick:order-north');
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 8 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(currentTaskFor(state).id, 'pick:order-north', 'заявка закрыта не вся — задание в работе');
  assert.equal(state.pallet.storeId, 'north', 'новая паллета адресована той же заявке');
  assert.equal(state.pallet.weight, 0);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(currentTaskFor(state), null);
});

test('what an event brings mid-shift arrives as an urgent task at the head of the queue', () => {
  const state = doTask(begin(MIXED));
  // Приехала фура с мороженым.
  const head = taskQueueFor(state)[0];
  assert.equal(head.id, 'receive:in-ice');
  assert.equal(head.urgent, true);
  assert.equal(state.tsd.signal, 'new');
  assert.equal(terminalViewFor(state).title, 'Срочное задание');
});

test('accepting a delivery task receives the pallet: there is no second tap', () => {
  let state = doTask(begin(MIXED));
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(currentTaskFor(state).id, 'receive:in-ice');
  assert.equal(state.inbound[0].status, 'received');
  assert.equal(warehouseViewFor(state).awaitingPlacement, true);
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'frozen' });
  assert.equal(currentTaskFor(state), null);
  assert.equal(taskQueueFor(state).find((task) => task.id === 'pick:order-central').blocked, null, 'товар в зоне — заявка выполнима');
});

test('taking the urgent task drops the pallet in progress', () => {
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  assert.equal(reduceAction(state, { type: 'TAKE_URGENT' }), state, 'срочного нет — переключаться не на что');
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  // Срочное задание приходит посреди сборки: фура приезжает сама по запасному сроку.
  state = tick(state, 10);
  assert.equal(nextTaskFor(state).id, 'receive:in-ice');
  assert.equal(terminalViewFor(state).canTakeUrgent, true);
  const taken = reduceAction(state, { type: 'TAKE_URGENT' });
  assert.equal(currentTaskFor(taken).id, 'receive:in-ice');
  assert.equal(taken.pallet.weight, 0, 'собранное вернулось на полку');
  assert.equal(taken.inbound[0].status, 'received');
  // Брошенная заявка никуда не делась — она снова в очереди.
  assert.ok(ids(taken).includes('pick:order-north'));
  // А вот паллету, уже снятую с фуры, бросить нельзя.
  assert.equal(reduceAction(taken, { type: 'TAKE_URGENT' }), taken);
});

test('a cancelled order with its pallet in the truck becomes an urgent unload task', () => {
  let state = untimed(begin(MIXED));
  for (let guard = 0; guard < 10 && !taskQueueFor(state).some((task) => task.kind === 'unload'); guard += 1) state = doTask(state);
  const unload = taskQueueFor(state).find((task) => task.kind === 'unload');
  assert.ok(unload, 'отмена должна была застать паллету в кузове');
  assert.equal(unload.urgent, true);
  assert.equal(nextTaskFor(state).id, unload.id);
  const view = terminalViewFor({ ...state, tsd: { ...state.tsd, open: true } });
  assert.deepEqual(view.taskLabels, ['Фургон', 'Что снять', 'Причина']);
  assert.match(view.taskValues[1], /Тушино/);

  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(state.selectedVehicleId, unload.vehicleId, 'задание открывает нужный фургон');
  state = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: unload.vehicleId, palletIndex: 0 });
  assert.equal(currentTaskFor(state), null);
});

test('the terminal offers the next task and names it in the first line', () => {
  const view = terminalViewFor(begin(MIXED));
  assert.equal(view.screen, 'task');
  assert.equal(view.title, 'Новое задание');
  assert.equal(view.canAccept, true);
  assert.deepEqual(view.taskValues, ['Тушино', 'Вода 1,5 л · 2 шт.', 'Сухач']);
  assert.equal(view.message, 'Тушино — Вода 1,5 л · 2 шт.');
});

test('when only blocked work is left the terminal says it is waiting, not that the shift is over', () => {
  let state = begin(MIXED);
  state = { ...state, orders: state.orders.filter((order) => order.id === 'order-central') };
  const view = terminalViewFor(state);
  assert.equal(view.title, 'Ждём');
  assert.equal(view.canAccept, false);
  assert.match(view.message, /Ждём поставку/);
});

test('the guided shifts keep their old terminal: no queue', () => {
  assert.equal(terminalViewFor(begin(shiftFor('inbound-receive'))).queue, undefined);
});

test('the board is a display: it marks the task in work and the one the terminal offers', () => {
  let state = begin(MIXED);
  let rows = orderBoardFor(state);
  assert.equal(rows.find((row) => row.orderId === 'order-north').next, true);
  assert.equal(rows.filter((row) => row.active).length, 0);
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  rows = orderBoardFor(state);
  assert.equal(rows.find((row) => row.orderId === 'order-north').active, true);
  assert.equal(rows.find((row) => row.orderId === 'order-west').next, true);
});

test('the offer shows what comes next and whose van is leaving', () => {
  // Окно ТСД закрывает и доску, и таймер на воротах — очередь под кнопкой показывает то же.
  const view = terminalViewFor(tick(begin(CAPACITY), 5));
  assert.equal(view.message, 'Беломорская — Молоко · 2 шт. Фургон уходит через 0:10.');
  assert.deepEqual(view.queueAhead.map((task) => task.text), [
    'Тушино · Вода 1,5 л',
    'Беломорская · Хлеб',
    'Медведково · Хлеб, Вода 1,5 л',
  ]);
  assert.deepEqual(view.queueAhead.map((task) => task.deadlineText), ['', '', ''], 'у сухих фургонов срока нет');
});

test('the queue under the offer counts what is waiting and disappears once a task is taken', () => {
  const offer = terminalViewFor(begin(MIXED));
  assert.equal(offer.queueAhead.length, 2);
  assert.match(offer.queueNote, /Ещё 1 ждёт/, 'мороженое ещё в пути — его в очереди нет, но оно посчитано');
  const working = terminalViewFor(reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' }));
  assert.deepEqual(working.queueAhead, []);
});

/* ---- Сборные заявки ---- */

test('everything a darkstore ordered from one zone is one task and one pallet', () => {
  // Медведково заказало хлеб и воду: раньше это были два задания по одному товару.
  let state = begin(CAPACITY);
  const task = taskQueueFor(state).find((entry) => entry.id === 'pick:order-northeast');
  assert.deepEqual(task.orderIds, ['order-northeast', 'order-northeast-water']);
  assert.equal(ids(state).includes('pick:order-northeast-water'), false, 'второй строки отдельным заданием нет');

  state = advanceTo(state, 'pick:order-northeast');
  const view = terminalViewFor(state);
  assert.equal(view.taskValues[0], 'Медведково');
  assert.equal(view.taskValues[1], 'Хлеб · 3 шт., Вода 1,5 л · 2 шт.');
  assert.equal(view.message, 'Медведково — Хлеб · 3 шт., Вода 1,5 л · 2 шт.');

  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(warehouseViewFor(state).palletGoalText, 'ещё 5 шт.', 'цель паллеты — по обеим строкам');
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 3 });
  assert.equal(warehouseViewFor(state).palletGoalText, 'ещё 2 шт.');
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  assert.equal(warehouseViewFor(state).palletGoalText, 'готова');
  const before = state.loadedPallets.length;
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(currentTaskFor(state), null, 'одна паллета закрыла обе строки');
  assert.equal(state.loadedPallets.length, before + 1);
  assert.equal(state.loadedPallets.at(-1).weight, 42);
});

test('loading only part of a mixed order keeps the task in work for the rest', () => {
  let state = advanceTo(begin(CAPACITY), 'pick:order-northeast');
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 3 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  assert.equal(currentTaskFor(state).id, 'pick:order-northeast');
  assert.deepEqual(currentTaskFor(state).orderIds, ['order-northeast-water']);
  assert.equal(state.pallet.storeId, 'northeast');
});

test('a line whose goods are still on the road is not part of the task, and its zone is not named', () => {
  // «Фура в пути»: Беломорская ждёт масло и молоко, но молоко ещё едет.
  let state = begin(shiftFor('late-delivery'));
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'chilled' });
  const task = taskQueueFor(state).find((entry) => entry.id === 'pick:order-east-butter');
  assert.deepEqual(task.orderIds, ['order-east-butter'], 'в задании только масло');
  // Доводим смену до этого задания, не давая приехать молоку.
  state = { ...state, scheduledEvents: [], activeTaskId: null };
  state = advanceTo(state, 'pick:order-east-butter');
  assert.equal(terminalViewFor(state).taskValues[1], 'Масло · 3 шт.');
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'butter', zone: 'chilled', weightPerUnit: 8, quantity: 3 });
  assert.equal(warehouseViewFor(state).palletGoalText, 'готова');
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  // Остаток заявки ждёт фуру: задание не держит терминал, а возвращается позже.
  assert.equal(currentTaskFor(state), null);
  assert.equal(taskQueueFor(state).find((entry) => entry.kind === 'pick' && entry.storeId === 'east').blocked, 'no-stock');
});

test('an order that will be cancelled never shares a pallet with one that stays', () => {
  /* Иначе отмена оставляла бы паллету наполовину лишней, а снять с неё
     одну строку нельзя — только всю паллету. */
  for (const level of WORKING) {
    for (const event of level.events.filter((entry) => entry.type === 'order-cancelled')) {
      const cancelled = level.initialOrders.find((order) => order.id === event.orderId);
      const mates = level.initialOrders.filter((order) => order.id !== cancelled.id && order.storeId === cancelled.storeId && order.zone === cancelled.zone);
      assert.deepEqual(mates, [], `смена ${level.id}: ${event.orderId} делит паллету с ${mates.map((order) => order.id).join(', ')}`);
    }
  }
});

test('several working shifts actually ask for a mixed pallet', () => {
  const mixed = WORKING.filter((level) => {
    const seen = new Set();
    return level.initialOrders.some((order) => {
      const key = `${order.storeId}:${order.zone}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  });
  assert.ok(mixed.length >= 4, `сборная заявка должна встречаться хотя бы в четырёх сменах, а встречается в ${mixed.length}`);
});

/* ---- Уход фургонов ---- */

const departAt = LEVELS.find((level) => level.id === CAPACITY).departures['chilled-1'];

test('a van leaves on the shift clock, and from then on takes nothing and gives nothing back', () => {
  let state = begin(CAPACITY);
  const chilled = () => state.vehicles.find((vehicle) => vehicle.id === 'chilled-1');
  assert.equal(chilled().departsAt, departAt);
  state = tick(state, departAt - 1);
  assert.equal(chilled().departed, false);
  state = tick(state, 1);
  assert.equal(chilled().departed, true);
  assert.equal(state.feedback.code, 'vehicle-departed');
  assert.match(state.feedback.message, /Охлаждёнка фургон.*ушёл в рейс пустым/);

  // Молоко теперь не на чем увезти: заявка перестаёт быть заданием и помечена на доске.
  assert.equal(ids(state).includes('pick:order-east'), false);
  const row = orderBoardFor(state).find((entry) => entry.orderId === 'order-east');
  assert.equal(row.status, 'lost');
  assert.match(row.note, /фургон ушёл/);

  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'SELECT_STORE', storeId: 'east' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 2 });
  assert.equal(reduceAction(state, { type: 'LOAD_PALLET' }).feedback.code, 'vehicle-departed');
});

test('missing the van costs the order and the stars: nobody waits for a late pallet', () => {
  const late = A.finishShift(tick(begin(CAPACITY), departAt)).report;
  assert.ok(late.deliveredPercent < 100);
  assert.ok(late.stars < 3);
});

test('what was loaded before the van left still counts, and its route is frozen', () => {
  let state = doTask(begin(CAPACITY));
  assert.equal(A.remainingFor(state, state.orders.find((order) => order.id === 'order-east')), 0);
  state = tick(state, departAt);
  for (const action of [
    { type: 'UNLOAD_PALLET', vehicleId: 'chilled-1', palletIndex: 0 },
    { type: 'SET_ROUTE', vehicleId: 'chilled-1', stops: ['east'] },
  ]) assert.equal(reduceAction(state, action).feedback.code, 'vehicle-departed');
});

test('the time left before a van leaves is on the scene, on the board and in the task', () => {
  const state = tick(begin(CAPACITY), 5);
  const left = `0:${String(departAt - 5).padStart(2, '0')}`;
  const [soonest] = warehouseViewFor(state).departures;
  assert.equal(soonest.vehicleId, 'chilled-1');
  assert.equal(soonest.leftText, left);
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-east').deadlineText, left);
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-north').deadlineText, '', 'у сухих фургонов срока нет');
  assert.match(terminalViewFor(state).message, new RegExp(`Фургон уходит через ${left}`));
});

/* ---- Сроки проверяются игрой ----
   Игрок берёт задания в порядке терминала; темп — множитель времени на
   каждое действие: 1 — обычный, 2 — вдвое медленнее. Срок должен быть
   реальным: успеть можно, но не с запасом в минуту. */

const COST = { accept: 2, pallet: 2, unit: 0.5, load: 2, place: 3, unload: 5, route: 6 };
// Игрок берёт задания в порядке терминала. Возвращает отчёт и момент, когда каждый фургон получил последнюю правку.
function play(levelId, pace = 1, departures = null) {
  let state = A.reduceAction(A.startLevel(levelId), { type: 'CONTINUE_STORY' });
  if (departures) state = { ...state, vehicles: state.vehicles.map((v) => ({ ...v, departsAt: departures[v.id] ?? null })) };
  const touched = {};
  const spend = (seconds) => { state = A.tick(state, Math.max(1, Math.round(seconds * pace))); };
  const optimise = (vehicleId) => {
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    const stops = state.routeStopsByVehicle?.[vehicleId] || [];
    if (!vehicle || vehicle.departed || stops.length < 2) return;
    const best = engine.bestRoute(stops);
    if (best.minutes >= engine.buildRoute(null, stops).minutes) return;
    spend(COST.route);
    if (state.vehicles.find((v) => v.id === vehicleId).departed) return;
    state = A.reduceAction(state, { type: 'SET_ROUTE', vehicleId, stops: best.stops });
    touched[vehicleId] = state.elapsedSeconds;
  };
  for (let guard = 0; guard < 400 && state.secondsRemaining > 0; guard += 1) {
    const queue = A.taskQueueFor(state);
    const current = queue.find((t) => t.active);
    const doable = queue.filter((t) => !t.active && !t.blocked);
    if (current) {
      if (current.kind === 'pick') {
        for (const orderId of current.orderIds) {
          const order = state.orders.find((o) => o.id === orderId);
          const item = engine.itemBySku(order.sku);
          const on = state.pallet.items.filter((e) => e.sku === order.sku).reduce((a, e) => a + e.quantity, 0);
          const stock = engine.availableStock(state.stock, order.zone, order.sku);
          const qty = Math.min(A.remainingFor(state, order) - on, Math.floor((state.pallet.capacity - state.pallet.weight) / item.weightPerUnit), stock);
          if (qty > 0) { spend(COST.pallet + qty * COST.unit); state = A.reduceAction(state, { type: 'ADD_ITEM', sku: order.sku, zone: order.zone, weightPerUnit: item.weightPerUnit, quantity: qty }); }
        }
        if (state.pallet.weight === 0) { state = A.tick(state, 1); continue; }
        spend(COST.load);
        const before = state.loadedPallets.length;
        state = A.reduceAction(state, { type: 'LOAD_PALLET' });
        if (state.loadedPallets.length === before) { if (A.currentTaskFor(state)) { state = { ...state, activeTaskId: null }; state = A.tick(state, 1); } continue; }
        const vid = state.loadedPallets.at(-1).vehicleId; touched[vid] = state.elapsedSeconds;
        optimise(vid);
      } else if (current.kind === 'receive') {
        const pallet = state.inbound.find((p) => p.id === current.inboundId);
        spend(COST.place); state = A.reduceAction(state, { type: 'PLACE_PALLET', zone: pallet.zone });
      } else {
        spend(COST.unload);
        const orphan = A.orphanPalletsFor(state).find((o) => o.vehicleId === current.vehicleId && o.pallet.storeId === current.storeId);
        if (orphan) { state = A.reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex }); touched[orphan.vehicleId] = state.elapsedSeconds; }
        else state = A.tick(state, 1);
      }
      continue;
    }
    if (!doable.length) { if (queue.some((t) => t.blocked)) { state = A.tick(state, 1); continue; } break; }
    spend(COST.accept);
    state = A.reduceAction(state, { type: 'ACCEPT_TASK' });
  }
  for (const vehicle of state.vehicles) optimise(vehicle.id);
  return { report: A.finishShift(state).report, touched, elapsed: state.elapsedSeconds };
}

for (const level of WORKING) {
  test(`shift ${level.id} "${level.title}": the queue never dead-ends, and an ordinary pace earns three stars`, () => {
    for (const pace of [0.7, 1, 1.3]) {
      const { report } = play(level.id, pace);
      assert.equal(report.stars, 3, `темп ${pace}: ${report.reasons.join('; ')}`);
    }
  });
}

test('the deadlines are real: a slow player loses the order and the stars', () => {
  for (const level of WORKING.filter((entry) => entry.departures)) {
    const { report } = play(level.id, 3);
    assert.ok(report.stars < 3, `смена ${level.id}: втрое медленнее обычного — и всё равно три звезды`);
    assert.ok(report.deliveredPercent < 100 || report.onTimePercent < 100, `смена ${level.id}: потеря должна быть от ушедшего фургона`);
  }
});

test('no deadline leaves a minute to spare: each is within twice the time the work takes', () => {
  /* Сроки стояли 55–85 секунд при работе на 7–32: успевал кто угодно, и
     уход фургона ничего не значил. */
  for (const level of WORKING.filter((entry) => entry.departures)) {
    for (const [vehicleId, departsAt] of Object.entries(level.departures)) {
      const ready = play(level.id, 1, { ...Object.fromEntries(level.vehicles.map((vehicle) => [vehicle.id, null])), [vehicleId]: 9999 }).touched[vehicleId];
      assert.ok(departsAt >= ready * 1.3, `смена ${level.id}: срок ${departsAt} с при работе на ${ready} с — не успеть`);
      assert.ok(departsAt <= ready * 2.2, `смена ${level.id}: срок ${departsAt} с при работе на ${ready} с — слишком свободно`);
    }
  }
});

test('whatever a leaving van needs is already on its way before it could be missed', () => {
  // Фура с товаром для уходящего фургона приезжает задолго до его ухода — и по прогрессу, и по запасному сроку.
  for (const level of WORKING.filter((entry) => entry.departures)) {
    for (const [vehicleId, departsAt] of Object.entries(level.departures)) {
      const zone = level.vehicles.find((vehicle) => vehicle.id === vehicleId).zone;
      for (const event of level.events.filter((entry) => entry.type === 'pallet-arrived' && entry.pallet.zone === zone)) {
        assert.ok(event.orAtSecond <= departsAt / 2, `смена ${level.id}: фура приезжает на ${event.orAtSecond} с, а фургон уходит на ${departsAt} с`);
      }
    }
  }
});

test('the terminal screen carries the queue, and the board cannot be tapped', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(html, /id="tsdUrgent"[^>]*data-action="TAKE_URGENT"/);
  assert.match(html, /id="tsdQueue"/);
  assert.match(html, /id="truckTimer"/);
  assert.match(app, /function offerNextTask/);
  assert.doesNotMatch(app, /<button class="order-line/);
});

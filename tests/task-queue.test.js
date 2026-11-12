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

/* На сменах без поводыря работу выдаёт ТСД: одно задание за раз, в порядке
   поступления. В жизни кладовщик заявки не выбирает — они приходят на
   терминал. Выбор при этом остаётся, но редкий и дорогой: три отложения на
   смену и срочное задание ценой брошенной паллеты. */

test('the queue lists work in arrival order and sinks what cannot be done yet', () => {
  const state = begin(MIXED);
  // Мороженого нет на складе: его заявка в хвосте, терминал её не предлагает.
  assert.deepEqual(ids(state), ['pick:order-north', 'pick:order-west', 'pick:order-east', 'pick:order-central']);
  assert.equal(taskQueueFor(state).at(-1).blocked, 'no-stock');
  assert.equal(nextTaskFor(state).id, 'pick:order-north');
  assert.equal(currentTaskFor(state), null);
});

test('accepting a task addresses the pallet to it and makes it the current work', () => {
  const state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  assert.equal(currentTaskFor(state).id, 'pick:order-north');
  assert.equal(state.pallet.storeId, 'north');
  assert.equal(state.pallet.zone, 'dry');
  // Второе задание поверх принятого не берётся: сначала закончить.
  assert.equal(reduceAction(state, { type: 'ACCEPT_TASK' }), state);
});

test('deferring sends the task to the back and costs one of three deferrals', () => {
  let state = begin(MIXED);
  assert.equal(state.defersLeft, 3);
  state = reduceAction(state, { type: 'DEFER_TASK' });
  assert.equal(state.defersLeft, 2);
  assert.deepEqual(ids(state).slice(0, 3), ['pick:order-west', 'pick:order-east', 'pick:order-north']);
  assert.equal(state.feedback.code, 'task-deferred');

  state = reduceAction(reduceAction(state, { type: 'DEFER_TASK' }), { type: 'DEFER_TASK' });
  assert.equal(state.defersLeft, 0);
  const spent = reduceAction(state, { type: 'DEFER_TASK' });
  assert.equal(spent.feedback.code, 'defer-spent');
  assert.deepEqual(ids(spent), ids(state), 'без отложений очередь не двигается');
});

test('there is nothing to defer to when one task is all there is', () => {
  let state = begin(shiftFor('one-order'));
  state = { ...state, levelId: MIXED, orders: [state.orders[0]] };
  const refused = reduceAction(state, { type: 'DEFER_TASK' });
  assert.equal(refused.feedback.code, 'defer-nowhere');
  assert.equal(refused.defersLeft, 3, 'отложение не потрачено');
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
  let state = reduceAction(begin(CAPACITY), { type: 'ACCEPT_TASK' });
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
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  // Приехала фура с мороженым.
  const head = taskQueueFor(state)[0];
  assert.equal(head.id, 'receive:in-ice');
  assert.equal(head.urgent, true);
  assert.equal(state.tsd.signal, 'new');
  // Отложенное срочное перестаёт быть срочным и уходит в хвост.
  const deferred = reduceAction(state, { type: 'DEFER_TASK' });
  assert.equal(taskQueueFor(deferred).find((task) => task.id === 'receive:in-ice').urgent, false);
  assert.notEqual(taskQueueFor(deferred)[0].id, 'receive:in-ice');
});

test('accepting a delivery task receives the pallet: there is no second tap', () => {
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(currentTaskFor(state).id, 'receive:in-ice');
  assert.equal(state.inbound[0].status, 'received');
  assert.equal(warehouseViewFor(state).awaitingPlacement, true);
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'frozen' });
  assert.equal(currentTaskFor(state), null);
  assert.equal(taskQueueFor(state).find((task) => task.id === 'pick:order-central').blocked, null, 'товар в зоне — заявка выполнима');
});

test('an urgent task can be taken over the current one, and the half-built pallet goes back on the shelf', () => {
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  state = reduceAction(state, { type: 'DEFER_TASK' }); // фуру — позже
  state = reduceAction(state, { type: 'ACCEPT_TASK' }); // хлеб в Саларьево
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'bread', zone: 'dry', weightPerUnit: 6, quantity: 2 });
  state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1); // дозаказ Саларьево — срочный
  assert.equal(nextTaskFor(state).urgent, true);

  // Берём молоко, начинаем собирать — и переключаемся на срочное.
  state = reduceAction(state, { type: 'DEFER_TASK' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(currentTaskFor(state).id, 'pick:order-east');
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  assert.equal(reduceAction(state, { type: 'TAKE_URGENT' }), state, 'срочного нет — переключаться не на что');
});

test('taking the urgent task drops the pallet in progress', () => {
  let state = reduceAction(begin(MIXED), { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  // Срочное задание приходит посреди сборки: через полминуты фура приезжает сама.
  state = tick(state, 30);
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
  let state = begin(MIXED);
  const ship = (sku, weightPerUnit) => {
    state = reduceAction(state, { type: 'ACCEPT_TASK' });
    if (currentTaskFor(state)?.kind === 'receive') { state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'frozen' }); state = reduceAction(state, { type: 'ACCEPT_TASK' }); }
    state = reduceAction(state, { type: 'ADD_ITEM', sku, zone: 'dry', weightPerUnit, quantity: 2 });
    state = tick(reduceAction(state, { type: 'LOAD_PALLET' }), 1);
  };
  ship('water', 12); ship('bread', 6); ship('bread', 6);
  const head = taskQueueFor(state)[0];
  assert.equal(head.kind, 'unload');
  assert.equal(head.urgent, true);
  const view = terminalViewFor({ ...state, tsd: { ...state.tsd, open: true } });
  assert.deepEqual(view.taskLabels, ['Фургон', 'Что снять', 'Причина']);
  assert.match(view.taskValues[1], /Тушино/);

  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  assert.equal(state.selectedVehicleId, head.vehicleId, 'задание открывает нужный фургон');
  state = reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: head.vehicleId, palletIndex: 0 });
  assert.equal(currentTaskFor(state), null);
});

test('the terminal offers the next task with accept and defer, and says how many deferrals are left', () => {
  const view = terminalViewFor(begin(MIXED));
  assert.equal(view.screen, 'task');
  assert.equal(view.title, 'Новое задание');
  assert.equal(view.canAccept, true);
  assert.equal(view.canDefer, true);
  assert.equal(view.deferLabel, 'Отложить · осталось 3');
  assert.deepEqual(view.taskValues, ['Тушино', 'Вода 1,5 л · 2 шт.', 'Сухач']);
});

test('when only blocked work is left the terminal says it is waiting, not that the shift is over', () => {
  let state = begin(MIXED);
  state = { ...state, orders: state.orders.filter((order) => order.id === 'order-central') };
  const view = terminalViewFor(state);
  assert.equal(view.title, 'Ждём');
  assert.equal(view.canAccept, false);
  assert.match(view.message, /Ждём поставку/);
});

test('the guided shifts keep their old terminal: no queue, no deferrals', () => {
  const view = terminalViewFor(begin(shiftFor('inbound-receive')));
  assert.equal(view.queue, undefined);
  assert.equal(reduceAction(begin(1), { type: 'DEFER_TASK' }).defersLeft, 3);
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

/* ---- Уход фургонов ---- */

test('a van leaves on the shift clock, and from then on takes nothing and gives nothing back', () => {
  let state = begin(CAPACITY);
  const chilled = () => state.vehicles.find((vehicle) => vehicle.id === 'chilled-1');
  assert.equal(chilled().departsAt, 55);
  state = tick(state, 54);
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

test('what was loaded before the van left still counts, and its route is frozen', () => {
  let state = begin(CAPACITY);
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'SELECT_STORE', storeId: 'east' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  state = tick(state, 60);
  assert.equal(A.remainingFor(state, state.orders.find((order) => order.id === 'order-east')), 0);
  for (const action of [
    { type: 'UNLOAD_PALLET', vehicleId: 'chilled-1', palletIndex: 0 },
    { type: 'SET_ROUTE', vehicleId: 'chilled-1', stops: ['east'] },
  ]) assert.equal(reduceAction(state, action).feedback.code, 'vehicle-departed');
});

test('the time left before a van leaves is on the scene, on the board and in the task', () => {
  let state = tick(begin(CAPACITY), 10);
  const [soonest] = warehouseViewFor(state).departures;
  assert.equal(soonest.vehicleId, 'chilled-1');
  assert.equal(soonest.leftText, '0:45');
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-east').deadlineText, '0:45');
  assert.equal(orderBoardFor(state).find((row) => row.orderId === 'order-north').deadlineText, '', 'у сухих фургонов срока нет');
  // Терминал печатает срок задания, но очередь по нему не строит.
  for (let i = 0; i < 3; i += 1) state = reduceAction(state, { type: 'DEFER_TASK' });
  assert.equal(nextTaskFor(state).id, 'pick:order-east');
  assert.match(terminalViewFor(state).message, /Фургон уходит через 0:45/);
});

test('the terminal does not know about departures: the leaving van\'s order sits behind longer work', () => {
  for (const level of WORKING.filter((entry) => entry.departures)) {
    for (const [vehicleId, departsAt] of Object.entries(level.departures)) {
      const zone = level.vehicles.find((vehicle) => vehicle.id === vehicleId).zone;
      const first = level.initialOrders.findIndex((order) => order.zone === zone);
      assert.ok(first >= 1, `смена ${level.id}: заявка уходящего фургона не должна стоять первой`);
      assert.ok(departsAt >= 50 && departsAt < level.durationSeconds / 2, `смена ${level.id}: срок ${departsAt} с`);
    }
  }
});

/* ---- Два игрока ----
   Сроки ухода фургонов проверяются не числами, а игрой. Послушный берёт
   задания в том порядке, в каком их выдаёт терминал. Вдумчивый первым делом
   смотрит, какой фургон уходит, и откладывает то, что подождёт. Темп — это
   множитель времени на каждое действие: 1 — уверенный игрок, 2 — вдвое
   медленнее. */

// Сколько секунд занимает действие у игрока в обычном темпе.
const COST = { accept: 2, defer: 2, pallet: 2, unit: 0.5, load: 2, place: 3, unload: 5, route: 6 };

function play(levelId, policy, pace = 1) {
  let state = A.reduceAction(A.startLevel(levelId), { type: 'CONTINUE_STORY' });
  const log = [];
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
  };
  const estimate = (task) => {
    if (task.kind === 'pick') {
      const order = state.orders.find((o) => o.id === task.orderId);
      const item = engine.itemBySku(order.sku);
      const left = A.remainingFor(state, order);
      const pallets = Math.ceil((left * item.weightPerUnit) / 100);
      return COST.accept + pallets * (COST.pallet + COST.load) + left * COST.unit;
    }
    return task.kind === 'receive' ? COST.accept + COST.place : COST.accept + COST.unload;
  };

  for (let guard = 0; guard < 400 && state.secondsRemaining > 0; guard += 1) {
    const queue = A.taskQueueFor(state);
    const current = queue.find((t) => t.active);
    const doable = queue.filter((t) => !t.active && !t.blocked);
    if (current) {
      if (current.kind === 'pick') {
        const order = state.orders.find((o) => o.id === current.orderId);
        const item = engine.itemBySku(order.sku);
        const on = state.pallet.items.filter((e) => e.sku === order.sku).reduce((a, e) => a + e.quantity, 0);
        const qty = Math.min(A.remainingFor(state, order) - on, Math.floor((state.pallet.capacity - state.pallet.weight) / item.weightPerUnit));
        if (qty > 0) { spend(COST.pallet + qty * COST.unit); state = A.reduceAction(state, { type: 'ADD_ITEM', sku: order.sku, zone: order.zone, weightPerUnit: item.weightPerUnit, quantity: qty }); }
        spend(COST.load);
        const before = state.loadedPallets.length;
        state = A.reduceAction(state, { type: 'LOAD_PALLET' });
        if (state.loadedPallets.length === before) { log.push('X(' + (state.feedback?.code || '?') + ')'); if (A.currentTaskFor(state)) { state = { ...state, activeTaskId: null }; state = A.tick(state, 1); } continue; }
        log.push('L');
        if (policy.optimise) optimise(state.loadedPallets.at(-1).vehicleId);
      } else if (current.kind === 'receive') {
        const pallet = state.inbound.find((p) => p.id === current.inboundId);
        spend(COST.place); state = A.reduceAction(state, { type: 'PLACE_PALLET', zone: pallet.zone }); log.push('P');
      } else {
        spend(COST.unload);
        const orphan = A.orphanPalletsFor(state).find((o) => o.vehicleId === current.vehicleId && o.pallet.storeId === current.storeId);
        if (orphan) { state = A.reduceAction(state, { type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex }); log.push('U'); }
        else state = A.tick(state, 1);
      }
      continue;
    }
    if (!doable.length) {
      if (queue.some((t) => t.blocked)) { state = A.tick(state, 1); if (log.at(-1) !== 'w') log.push('w'); continue; }
      break;
    }
    const head = doable[0];
    const choice = policy.choose(state, doable, estimate, pace);
    if (choice === 'defer' && (state.defersLeft ?? 0) > 0 && doable.length > 1) { spend(COST.defer); state = A.reduceAction(state, { type: 'DEFER_TASK' }); log.push('d'); continue; }
    spend(COST.accept);
    state = A.reduceAction(state, { type: 'ACCEPT_TASK' });
    log.push(head.kind === 'pick' ? 'a' : head.kind === 'receive' ? 'R' : 'au');
  }
  if (policy.optimise) for (const vehicle of state.vehicles) optimise(vehicle.id);
  const report = A.finishShift(state).report;
  return { report, log: log.join(' '), elapsed: state.elapsedSeconds, defersLeft: state.defersLeft };
}

// Послушный: берёт задания в том порядке, в каком их выдаёт терминал.
const obedient = { optimise: true, choose: () => 'accept' };

// Вдумчивый: сначала то, что уходит. Если у выполнимого задания есть срок,
// а терминал предлагает другое — откладывает, пока хватает отложений.
const thoughtful = {
  optimise: true,
  choose(state, doable) {
    const head = doable[0];
    const deadlineOf = (task) => A.taskDeadlineFor(state, task) ?? Infinity;
    const timed = doable.filter((task) => Number.isFinite(deadlineOf(task))).sort((a, b) => deadlineOf(a) - deadlineOf(b));
    if (!timed.length || timed[0].id === head.id) return 'accept';
    // Отложения тратим, только если ими реально добраться до задания со сроком.
    const distance = doable.findIndex((task) => task.id === timed[0].id);
    return distance <= (state.defersLeft ?? 0) ? 'defer' : 'accept';
  },
};

for (const level of WORKING) {
  test(`shift ${level.id} "${level.title}": the queue never dead-ends and a thoughtful player gets three stars at any pace`, () => {
    for (const pace of [1, 1.5, 2]) {
      const { report, log } = play(level.id, thoughtful, pace);
      assert.equal(report.stars, 3, `темп ${pace}: ${report.reasons.join('; ')} — ${log}`);
    }
  });
}

test('where a van leaves early, taking tasks in the terminal\'s order loses the order at an ordinary pace', () => {
  for (const level of WORKING.filter((entry) => entry.departures)) {
    const blind = play(level.id, obedient, 1.5);
    assert.ok(blind.report.stars < 3, `смена ${level.id}: послушный игрок не должен успевать — ${blind.log}`);
    assert.ok(blind.report.deliveredPercent < 100, `смена ${level.id}: теряться должна именно заявка`);
  }
});

test('deferring is what saves the leaving van: the thoughtful player spends deferrals exactly there', () => {
  for (const level of WORKING) {
    const { defersLeft } = play(level.id, thoughtful, 1.5);
    if (level.departures) assert.ok(defersLeft < 3, `смена ${level.id}: без отложений срок не взять`);
    else assert.equal(defersLeft, 3, `смена ${level.id}: срока нет — откладывать незачем`);
  }
});

test('a fast player can still brute-force the order: the deadline is a clock, not a lock', () => {
  // Срок реальный, а не сюжетный: кто работает быстро, успевает и без отложений.
  const fast = WORKING.filter((level) => level.departures).map((level) => play(level.id, obedient, 1).report.stars);
  assert.ok(fast.every((stars) => stars === 3));
});

test('the terminal screen carries the queue buttons, and the board cannot be tapped', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(html, /id="tsdDefer"[^>]*data-action="DEFER_TASK"/);
  assert.match(html, /id="tsdUrgent"[^>]*data-action="TAKE_URGENT"/);
  assert.match(html, /id="truckTimer"/);
  assert.match(app, /function offerNextTask/);
  assert.doesNotMatch(app, /<button class="order-line/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../flow-engine.js');

const { STATIONS, DURATIONS } = flow;

const run = (state, seconds) => {
  let next = state;
  for (let i = 0; i < seconds; i += 1) next = flow.tick(next);
  return next;
};

/* Довести действие до конца: игрок жмёт кнопку, а эффект наступает, когда
   истекает его длительность. Из-за этого почти каждый тест тикает. */
const finishAction = (state) => run(state, (state.busy?.endsAt ?? state.elapsed) - state.elapsed);

/* Тесты приёмки и размещения написаны для ровного потока фур: за сорок
   секунд на гейтах стоит несколько машин. В смене фуры идут волнами с
   паузой почти в минуту, поэтому здесь поток задан явно. */
const STEADY = { minGap: 7, maxGap: 11, waveMax: 1 };
const shiftWith = (options) => flow.createFlowShift({ seed: 7, ...STEADY, ...options });

test('the warehouse produces work on its own while the player is busy elsewhere', () => {
  /* Это единственное, ради чего затевался режим: без самостоятельной работы
     склада переключение между станциями было бы меню из двух вкладок. */
  const start = shiftWith({});
  assert.equal(start.gates.every((gate) => !gate.truck), true);
  const later = run(start, 30);
  assert.ok(later.gates.some((gate) => gate.truck), 'за полминуты хоть одна фура должна встать на гейт');
});

test('trucks beyond the gates wait in a queue instead of vanishing', () => {
  const state = run(shiftWith({ gates: 1 }), 60);
  assert.equal(state.gates.filter((gate) => gate.truck).length, 1);
  assert.ok(state.queue.length > 0, 'лишние фуры должны ждать, а не исчезать');
});

test('the schedule stops sending trucks nobody could finish in time', () => {
  const state = shiftWith({ seconds: 60 });
  const last = state.schedule[state.schedule.length - 1];
  assert.ok(last.at <= 60 - (DURATIONS.unload + DURATIONS.putaway + DURATIONS.walk),
    'последняя фура должна успевать пройти разгрузку и размещение');
});

test('a full buffer blocks receiving instead of swallowing the pallet', () => {
  let state = run(shiftWith({ bufferSlots: 1, gates: 3 }), 40);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  assert.equal(state.buffer.length, 1);

  const second = state.gates.find((item) => item.truck);
  const blocked = flow.unload(state, second.id);
  assert.equal(blocked.feedback.code, 'buffer-full');
  assert.equal(blocked.busy, null, 'отказ не должен занимать игрока');
});

test('the player can only act at the station they are standing at', () => {
  const state = run(shiftWith({}), 40);
  const refused = flow.putaway(state, 'pallet-truck-1', 'dry');
  assert.equal(refused.feedback.code, 'wrong-station');

  const walking = flow.goTo(state, STATIONS.PUTAWAY);
  assert.equal(walking.busy.kind, 'walk');
  assert.equal(walking.station, STATIONS.RECEIVING, 'станция меняется по приходу, а не по нажатию');
  assert.equal(finishAction(walking).station, STATIONS.PUTAWAY);
});

test('a busy player cannot start a second action', () => {
  const state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck);
  const busy = flow.unload(state, gate.id);
  assert.equal(flow.goTo(busy, STATIONS.PUTAWAY).feedback.code, 'busy');
  assert.equal(flow.unload(busy, gate.id).feedback.code, 'busy');
});

test('the freshness clock runs in the buffer and stops once the pallet is in its zone', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone !== 'dry');
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];
  assert.equal(pallet.shelf, flow.SHELF_SECONDS[pallet.zone]);

  // Пять секунд, а не десять: заморозка с дорогой до зоны иначе не доживает.
  const waited = run(state, 5);
  const aged = waited.buffer.find((item) => item.id === pallet.id);
  assert.equal(aged.shelf, pallet.shelf - 5, 'в буфере часы идут');

  let placed = flow.goTo(waited, STATIONS.PUTAWAY);
  placed = finishAction(placed);
  placed = finishAction(flow.putaway(placed, pallet.id, pallet.zone));
  const stored = placed.stored.find((item) => item.id === pallet.id);
  const shelfOnArrival = stored.shelf;
  // Встала в свою температуру — часы больше не идут.
  assert.equal(run(placed, 20).stored.find((item) => item.id === pallet.id).shelf, shelfOnArrival);
});

test('dry goods never spoil, so they are the tempting easy work', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone === 'dry');
  if (!gate) return;
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];
  assert.equal(pallet.shelf, null);
  assert.equal(run(state, 60).buffer.find((item) => item.id === pallet.id).shelf, null);
});

test('a perishable left in the buffer spoils and frees its slot', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone === 'frozen')
    || state.gates.find((item) => item.truck && item.truck.zone === 'chilled');
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];

  const rotted = run(state, pallet.shelf + 1);
  assert.equal(rotted.buffer.some((item) => item.id === pallet.id), false, 'слот должен освободиться');
  assert.equal(rotted.spoiled.some((item) => item.id === pallet.id && item.reason === 'shelf'), true);
});

test('a tie between the shelf clock and the putaway goes to the player', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone !== 'dry');
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];

  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  // Ждём так, чтобы срок истекал ровно на секунде окончания размещения.
  const spare = state.buffer.find((item) => item.id === pallet.id).shelf - DURATIONS.putaway;
  state = run(state, spare);
  state = finishAction(flow.putaway(state, pallet.id, pallet.zone));
  assert.equal(state.stored.some((item) => item.id === pallet.id), true, 'спорную секунду отдаём игроку');
  assert.equal(state.spoiled.length, 0);
});

test('putting a pallet in the wrong zone writes it off', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];
  const wrong = pallet.zone === 'dry' ? 'frozen' : 'dry';

  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  state = finishAction(flow.putaway(state, pallet.id, wrong));
  assert.equal(state.stored.length, 0);
  assert.equal(state.spoiled[0].reason, 'wrong-zone');
});

test('a pallet that rots mid-carry cancels the carry instead of arriving empty', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone !== 'dry');
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];
  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));

  // Берём её в последнюю секунду срока — довезти уже нечего.
  const spare = state.buffer.find((item) => item.id === pallet.id).shelf - 1;
  state = run(state, spare);
  state = run(flow.putaway(state, pallet.id, pallet.zone), DURATIONS.putaway);
  assert.equal(state.busy, null, 'действие должно сняться вместе с паллетой');
  assert.equal(state.stored.length, 0);
  assert.equal(state.spoiled[0].reason, 'shelf');
});

test('handling a perishable in the first half of its life earns the speed bonus', () => {
  let state = run(shiftWith({}), 40);
  const gate = state.gates.find((item) => item.truck && item.truck.zone !== 'dry');
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer[state.buffer.length - 1];

  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  state = finishAction(flow.putaway(state, pallet.id, pallet.zone));
  assert.equal(state.bonusFresh, 1);
  assert.equal(state.stored[0].fast, true);
});

test('backlog counts every pallet the shift has not put away', () => {
  let state = run(shiftWith({ gates: 1 }), 60);
  assert.equal(flow.backlogOf(state),
    state.gates.filter((gate) => gate.truck).length + state.queue.length + state.buffer.length);

  /* Дальше проверяем, что с бэклогом делает игрок, поэтому расписание
     замораживаем: иначе считаем приехавшие фуры, а не свою работу. */
  state = { ...state, schedule: [] };
  const before = flow.backlogOf(state);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  assert.equal(flow.backlogOf(state), before, 'разгрузка только переносит паллету с гейта в буфер');

  const pallet = state.buffer[state.buffer.length - 1];
  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  state = finishAction(flow.putaway(state, pallet.id, pallet.zone));
  assert.equal(flow.backlogOf(state), before - 1, 'бэклог уменьшает только размещение');
});

test('the shift ends with a report the goals are judged from', () => {
  const state = run(shiftWith({ seconds: 20 }), 20);
  assert.equal(state.phase, 'report');
  assert.deepEqual(state.report.goals.map((goal) => goal.id), ['missed', 'perishables']);
  assert.equal(state.report.goals.find((goal) => goal.id === 'missed').limit, flow.DEFAULTS.missedLimit);
  assert.equal(typeof state.report.success, 'boolean');
  for (const field of ['shipped', 'missed', 'waiting', 'stored', 'spoiled', 'backlog']) assert.equal(typeof state.report[field], 'number');
  // После отчёта смена замирает: тик ничего не меняет.
  assert.deepEqual(flow.tick(state), state);
});

test('doing nothing at all fails the shift, so the goals actually bind', () => {
  const idle = run(flow.createFlowShift({ seed: 7 }), flow.DEFAULTS.seconds);
  assert.equal(idle.report.success, false);
  assert.equal(idle.report.shipped, 0);
  assert.ok(idle.report.missed > flow.DEFAULTS.missedLimit, 'фургоны уходят пустыми — заявки сорваны');
});

test('the same seed replays the same shift', () => {
  const left = flow.createFlowShift({ seed: 42 });
  const right = flow.createFlowShift({ seed: 42 });
  assert.deepEqual(left.schedule, right.schedule);
  assert.notDeepEqual(flow.createFlowShift({ seed: 43 }).schedule, left.schedule);
});

/* ---- Вторая половина склада: отбор и погрузка ---- */

// Фургон у ворот отгрузки и паллета его товара в зоне — заготовка для тестов выхода.
const outboundShift = (overrides = {}) => {
  const base = flow.createFlowShift({ seed: 7, initialStock: 0, ...overrides });
  return {
    ...base,
    schedule: [],
    orderSchedule: [],
    stock: [
      { id: 'p-milk', sku: 'milk', zone: 'chilled', quantity: 2, supplier: 'Запас' },
      { id: 'p-water', sku: 'water', zone: 'dry', quantity: 2, supplier: 'Запас' },
      { id: 'p-ice', sku: 'ice-cream', zone: 'frozen', quantity: 2, supplier: 'Запас' },
    ],
    vans: [
      { id: 'van-milk', storeId: 'north', sku: 'milk', zone: 'chilled', arrivedAt: 0, dueAt: 60 },
      { id: 'van-water', storeId: 'west', sku: 'water', zone: 'dry', arrivedAt: 0, dueAt: 60 },
      { id: 'van-ice', storeId: 'east', sku: 'ice-cream', zone: 'frozen', arrivedAt: 0, dueAt: 60 },
    ],
  };
};
const at = (state, station) => finishAction(flow.goTo(state, station));

test('the shift opens with stock in the zones and vans already on their way', () => {
  const state = flow.createFlowShift({ seed: 7 });
  assert.equal(state.stock.length, flow.DEFAULTS.initialStock, 'без запаса отбор и погрузка полминуты стояли бы пустыми');
  assert.ok(state.orderSchedule.length >= state.stock.length);
  assert.ok(run(state, 30).vans.length > 0, 'за полминуты хоть один фургон должен встать у ворот');
});

test('every van asks for goods the warehouse was actually given', () => {
  // Лишнего спроса нет: сорванная заявка всегда значит недоведённый товар.
  for (const seed of [1, 7, 42]) {
    const state = flow.createFlowShift({ seed });
    const supplied = new Map();
    for (const pallet of [...state.stock, ...state.schedule]) supplied.set(pallet.sku, (supplied.get(pallet.sku) || 0) + 1);
    const asked = new Map();
    for (const order of state.orderSchedule) asked.set(order.sku, (asked.get(order.sku) || 0) + 1);
    for (const [sku, count] of asked) assert.ok(count <= (supplied.get(sku) || 0), `смена ${seed}: ${sku} заказан ${count} раз, а привезён ${supplied.get(sku) || 0}`);
  }
});

test('a van for delivered goods never arrives before its truck', () => {
  const state = flow.createFlowShift({ seed: 7 });
  const trucks = state.schedule.map((truck) => truck.at);
  const fromTrucks = state.orderSchedule.slice().sort((a, b) => a.at - b.at).filter((order) => order.at >= flow.DEFAULTS.orderDelayMin);
  for (const order of fromTrucks) assert.ok(trucks.some((time) => time + flow.DEFAULTS.orderDelayMin <= order.at));
});

test('picking moves a pallet from its zone to the dock and only at the picking station', () => {
  let state = outboundShift();
  assert.equal(flow.pick(state, 'van-water').feedback.code, 'wrong-station');

  state = at(state, STATIONS.PICKING);
  const started = flow.pick(state, 'van-water');
  assert.equal(started.busy.kind, 'pick');
  assert.equal(started.busy.endsAt - started.busy.startedAt, DURATIONS.pick);
  assert.equal(started.stock.length, 3, 'пока паллету везут, она ещё числится в зоне');

  const done = finishAction(started);
  assert.deepEqual(done.stock.map((pallet) => pallet.id), ['p-milk', 'p-ice']);
  assert.deepEqual(done.staging.map((pallet) => pallet.id), ['p-water']);
  assert.equal(done.feedback.code, 'picked');
});

test('picking refuses what cannot be picked and says why', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  assert.equal(flow.pick(state, 'van-nobody').feedback.code, 'van-gone');

  const noStock = { ...state, stock: state.stock.filter((pallet) => pallet.sku !== 'milk') };
  assert.equal(flow.pick(noStock, 'van-milk').feedback.code, 'no-stock');
  assert.match(flow.pick(noStock, 'van-milk').feedback.message, /примите и разместите/);

  state = finishAction(flow.pick(state, 'van-water'));
  assert.equal(flow.pick(state, 'van-water').feedback.code, 'already-picked', 'одна паллета на фургон');

  const full = { ...state, settings: { ...state.settings, stagingSlots: 1 } };
  assert.equal(flow.pick(full, 'van-milk').feedback.code, 'staging-full');
  assert.equal(flow.pick(full, 'van-milk').busy, null, 'отказ не должен занимать игрока');
});

test('loading puts the picked pallet on its van and closes the order', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-water'));
  assert.equal(flow.load(state, 'van-water').feedback.code, 'wrong-station');

  state = at(state, STATIONS.LOADING);
  assert.equal(flow.load(state, 'van-milk').feedback.code, 'not-picked');

  const loading = flow.load(state, 'van-water');
  assert.equal(loading.busy.endsAt - loading.busy.startedAt, DURATIONS.load);
  const done = finishAction(loading);
  assert.equal(done.staging.length, 0);
  assert.deepEqual(done.vans.map((van) => van.id), ['van-milk', 'van-ice']);
  assert.deepEqual(done.shipped.map((van) => van.id), ['van-water']);
  assert.equal(done.feedback.code, 'shipped');
});

test('a perishable pulled out of its zone starts rotting again at the dock', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-ice'));
  const staged = state.staging[0];
  assert.equal(staged.shelf, flow.SHELF_SECONDS.frozen, 'срок идёт заново с полного');

  const waited = run(state, 5);
  assert.equal(waited.staging[0].shelf, staged.shelf - 5);

  const rotten = run(state, flow.SHELF_SECONDS.frozen);
  assert.equal(rotten.staging.length, 0);
  assert.equal(rotten.spoiled.at(-1).reason, 'staging');
  assert.equal(flow.goalsFor(rotten).find((goal) => goal.id === 'perishables').ok, false);
});

test('dry goods wait at the dock as long as needed', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-water'));
  assert.equal(run(state, 40).staging[0].shelf, null);
});

test('a pallet that rots mid-load cancels the load instead of shipping spoiled goods', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-ice'));
  state = at(state, STATIONS.LOADING);
  state = { ...state, staging: state.staging.map((pallet) => ({ ...pallet, shelf: 2 })) };
  const done = run(flow.load(state, 'van-ice'), DURATIONS.load);
  assert.equal(done.busy, null);
  assert.equal(done.shipped.length, 0);
  assert.equal(done.spoiled.at(-1).id, 'p-ice');
});

test('a van that is not served in time leaves empty and counts as a missed order', () => {
  const state = run(outboundShift(), 60);
  assert.equal(state.vans.length, 0);
  assert.equal(state.missed.length, 3);
  assert.equal(state.feedback.code, 'van-left');
  assert.equal(flow.goalsFor(state).find((goal) => goal.id === 'missed').ok, false);
});

test('a van being loaded does not drive off mid-load: the tie goes to the player', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-water'));
  state = at(state, STATIONS.LOADING);
  // Погрузка начинается за секунду до ухода фургона.
  state = { ...state, vans: state.vans.map((van) => (van.id === 'van-water' ? { ...van, dueAt: state.elapsed + 1 } : van)) };
  const done = finishAction(flow.load(state, 'van-water'));
  assert.deepEqual(done.shipped.map((van) => van.id), ['van-water']);
  assert.equal(done.missed.some((van) => van.id === 'van-water'), false);
});

test('a picked pallet whose van has left goes back to its zone instead of clogging the dock', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-water'));
  assert.equal(state.staging.length, 1);
  // Фургон за водой уходит; сухая паллета иначе занимала бы слот до конца смены.
  const left = run({ ...state, vans: state.vans.map((van) => (van.id === 'van-water' ? { ...van, dueAt: state.elapsed + 1 } : van)) }, 1);
  assert.equal(left.staging.length, 0);
  assert.ok(left.stock.some((pallet) => pallet.id === 'p-water'), 'паллета вернулась в зону и снова доступна');
});

test('what is put away becomes pickable: the two halves of the warehouse are one chain', () => {
  let state = run(shiftWith({ initialStock: 0 }), 12);
  assert.equal(state.stock.length, 0);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  const pallet = state.buffer.at(-1);
  state = at(state, STATIONS.PUTAWAY);
  state = finishAction(flow.putaway(state, pallet.id, pallet.zone));
  assert.deepEqual(state.stock.map((item) => item.id), [pallet.id]);

  // А списанная паллета в зону не попадает — отбирать под её фургон будет нечего.
  let wrong = run(shiftWith({ initialStock: 0 }), 12);
  wrong = finishAction(flow.unload(wrong, wrong.gates.find((item) => item.truck).id));
  const lost = wrong.buffer.at(-1);
  wrong = at(wrong, STATIONS.PUTAWAY);
  wrong = finishAction(flow.putaway(wrong, lost.id, lost.zone === 'dry' ? 'frozen' : 'dry'));
  assert.equal(wrong.stock.length, 0);
});

test('fresh arrivals come in waves with a pause between them', () => {
  const state = flow.createFlowShift({ seed: 7 });
  const times = state.schedule.map((truck) => truck.at);
  const gaps = times.slice(1).map((time, index) => time - times[index]);
  assert.ok(gaps.some((gap) => gap <= flow.DEFAULTS.waveSpacing), 'в волне фуры приходят почти разом');
  assert.ok(gaps.some((gap) => gap >= flow.DEFAULTS.minGap - flow.DEFAULTS.waveSpacing * flow.DEFAULTS.waveMax), 'между волнами — пауза');
});

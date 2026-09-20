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

const shiftWith = (options) => flow.createFlowShift({ seed: 7, ...options });

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

  const waited = run(state, 10);
  const aged = waited.buffer.find((item) => item.id === pallet.id);
  assert.equal(aged.shelf, pallet.shelf - 10, 'в буфере часы идут');

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
  assert.equal(state.report.goals.length, 2);
  assert.equal(state.report.goals.find((goal) => goal.id === 'backlog').limit, flow.DEFAULTS.backlogLimit);
  assert.equal(typeof state.report.success, 'boolean');
  // После отчёта смена замирает: тик ничего не меняет.
  assert.deepEqual(flow.tick(state), state);
});

test('doing nothing at all fails the shift, so the goals actually bind', () => {
  const idle = run(shiftWith({ seconds: 120 }), 120);
  assert.equal(idle.report.success, false);
  assert.ok(idle.report.backlog > flow.DEFAULTS.backlogLimit);
});

test('the same seed replays the same shift', () => {
  const left = flow.createFlowShift({ seed: 42 });
  const right = flow.createFlowShift({ seed: 42 });
  assert.deepEqual(left.schedule, right.schedule);
  assert.notDeepEqual(flow.createFlowShift({ seed: 43 }).schedule, left.schedule);
});

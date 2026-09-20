const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../flow-engine.js');
const { flowViewFor } = require('../flow-view.js');

const { STATIONS } = flow;

const run = (state, seconds) => {
  let next = state;
  for (let i = 0; i < seconds; i += 1) next = flow.tick(next);
  return next;
};
const finishAction = (state) => run(state, (state.busy?.endsAt ?? state.elapsed) - state.elapsed);
const busyShift = () => run(flow.createFlowShift({ seed: 7 }), 40);

test('the clock reads as minutes and seconds, not raw seconds', () => {
  assert.equal(flowViewFor(flow.createFlowShift({ seed: 7, seconds: 180 })).clock, '3:00');
  assert.equal(flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 180 }), 65)).clock, '1:55');
});

test('gates say what is on the truck without making the player open anything', () => {
  const view = flowViewFor(busyShift());
  const gate = view.gates.find((item) => item.occupied);
  assert.ok(gate.title.length > 0, 'поставщик');
  assert.match(gate.goods, /шт\./);
  assert.ok(gate.zoneMark.length > 0, 'температура зоны — значком, как на стеллажах');
});

test('a gate says why it cannot be unloaded instead of going quietly dead', () => {
  /* Мёртвая кнопка без причины — это тупик, который мы уже разбирали в
     кампании: игрок жмёт и не понимает, почему ничего не происходит. */
  let state = busyShift();
  const away = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  assert.equal(flowViewFor(away).gates.find((gate) => gate.occupied).blockedBy, 'station');

  // Забитый буфер — вторая причина, и она важнее: приёмка встала целиком.
  let full = flow.createFlowShift({ seed: 7, bufferSlots: 1 });
  full = run(full, 40);
  const gate = full.gates.find((item) => item.truck);
  full = finishAction(flow.unload(full, gate.id));
  const blocked = flowViewFor(full).gates.find((item) => item.occupied);
  assert.equal(blocked.canUnload, false);
  assert.equal(blocked.blockedBy, 'buffer');
});

test('the busy bar names the action and how long is left', () => {
  const state = busyShift();
  const gate = state.gates.find((item) => item.truck);
  const busy = flow.unload(state, gate.id);
  const view = flowViewFor(busy);
  assert.match(view.busy.label, /Разгружаю/);
  assert.equal(view.busy.secondsLeft, flow.DURATIONS.unload);
  assert.equal(view.busy.percent, 0);
  assert.equal(flowViewFor(run(busy, 2)).busy.percent, 67);
});

test('walking names the station being walked to', () => {
  const view = flowViewFor(flow.goTo(busyShift(), STATIONS.PUTAWAY));
  assert.match(view.busy.label, /Иду на «Размещение»/);
});

test('a perishable pallet shows its remaining life and grows urgent as it drains', () => {
  let state = busyShift();
  const gate = state.gates.find((item) => item.truck && item.truck.zone !== 'dry');
  state = finishAction(flow.unload(state, gate.id));
  const fresh = flowViewFor(state).buffer.pallets.at(-1);
  assert.equal(fresh.urgency, 'calm');
  assert.equal(fresh.shelfPercent, 100);

  const half = flowViewFor(run(state, Math.ceil(flow.SHELF_SECONDS[gate.truck.zone] * 0.6)));
  assert.equal(half.buffer.pallets.at(-1).urgency, 'warning');

  const late = flowViewFor(run(state, Math.ceil(flow.SHELF_SECONDS[gate.truck.zone] * 0.8)));
  assert.equal(late.buffer.pallets.at(-1).urgency, 'critical');
});

test('dry pallets are never urgent and say so plainly', () => {
  let state = busyShift();
  const gate = state.gates.find((item) => item.truck && item.truck.zone === 'dry');
  if (!gate) return;
  state = finishAction(flow.unload(state, gate.id));
  const pallet = flowViewFor(run(state, 60)).buffer.pallets.at(-1);
  assert.equal(pallet.urgency, 'calm');
  assert.equal(pallet.shelfText, 'не портится');
});

test('the station strip shows pressure on the station the player is not standing at', () => {
  const view = flowViewFor(busyShift());
  const putaway = view.stations.find((station) => station.id === STATIONS.PUTAWAY);
  const receiving = view.stations.find((station) => station.id === STATIONS.RECEIVING);
  assert.equal(receiving.here, true);
  assert.equal(putaway.here, false);
  assert.match(putaway.pressure, /в буфере/);
  assert.match(receiving.pressure, /\d+ фур\S* жд[уё]\S*|пусто/);
});

test('counts of trucks are declined, because the number changes every second', () => {
  const { plural } = require('../flow-view.js');
  const fura = (count) => `${count} ${plural(count, 'фура', 'фуры', 'фур')}`;
  assert.deepEqual([1, 2, 4, 5, 11, 14, 21, 22, 25].map(fura),
    ['1 фура', '2 фуры', '4 фуры', '5 фур', '11 фур', '14 фур', '21 фура', '22 фуры', '25 фур']);
});

test('the strip raises an alarm when a full buffer has stopped receiving', () => {
  let state = run(flow.createFlowShift({ seed: 7, bufferSlots: 1 }), 40);
  assert.equal(flowViewFor(state).stations.find((s) => s.id === STATIONS.RECEIVING).alert, false);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  assert.equal(flowViewFor(state).stations.find((s) => s.id === STATIONS.RECEIVING).alert, true,
    'забитый буфер останавливает приёмку — об этом надо кричать');
});

test('live goals read the same way before and after the shift ends', () => {
  const running = flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 30 }), 20));
  assert.deepEqual(running.goals.map((goal) => goal.id), ['backlog', 'perishables']);
  const finished = flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 30 }), 30));
  assert.deepEqual(finished.goals.map((goal) => goal.id), ['backlog', 'perishables']);
  assert.ok(finished.report, 'после смены появляется отчёт');
  assert.equal(finished.running, false);
});

test('only the station the player stands at offers its actions', () => {
  let state = busyShift();
  assert.equal(flowViewFor(state).buffer.pallets.every((pallet) => !pallet.canTake), true);

  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  state = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  const view = flowViewFor(state);
  assert.equal(view.buffer.pallets.at(-1).canTake, true);
  assert.equal(view.gates.filter((item) => item.occupied).every((item) => !item.canUnload), true);
});

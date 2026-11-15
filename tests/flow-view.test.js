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
// Ровный поток фур: тесты приёмки рассчитаны на несколько машин за сорок секунд.
const STEADY = { minGap: 7, maxGap: 11, waveMax: 1 };
const busyShift = () => run(flow.createFlowShift({ seed: 7, ...STEADY }), 40);

test('the clock reads as minutes and seconds, not raw seconds', () => {
  assert.equal(flowViewFor(flow.createFlowShift({ seed: 7, seconds: 180 })).clock, '3:00');
  assert.equal(flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 180 }), 65)).clock, '1:55');
});

test('gates say what is on the truck without making the player open anything', () => {
  const view = flowViewFor(busyShift());
  const gate = view.gates.find((item) => item.occupied);
  assert.ok(gate.title.length > 0, 'поставщик');
  assert.match(gate.goods, /шт\./);
  /* Зону фуры экран не называет: какому товару какая температура, игрок
     решает на размещении сам — как и в кампании. */
  assert.equal(Object.hasOwn(gate, 'zoneMark'), false);
  assert.equal(Object.hasOwn(gate, 'zone'), false);
});

test('a buffer pallet does not say which zone it belongs to either', () => {
  let state = busyShift();
  state = finishAction(flow.unload(state, state.gates.find((item) => item.truck).id));
  const pallet = flowViewFor(state).buffer.pallets.at(-1);
  for (const field of ['zone', 'zoneMark', 'zoneName']) assert.equal(Object.hasOwn(pallet, field), false);
  // Зоны остаются на кнопках выбора — это и есть решение игрока.
  assert.deepEqual(flowViewFor(state).zones.map((zone) => zone.id), ['dry', 'chilled', 'frozen']);
});

test('a gate says why it cannot be unloaded instead of going quietly dead', () => {
  /* Мёртвая кнопка без причины — это тупик, который мы уже разбирали в
     кампании: игрок жмёт и не понимает, почему ничего не происходит. */
  let state = busyShift();
  const away = finishAction(flow.goTo(state, STATIONS.PUTAWAY));
  assert.equal(flowViewFor(away).gates.find((gate) => gate.occupied).blockedBy, 'station');

  // Забитый буфер — вторая причина, и она важнее: приёмка встала целиком.
  let full = flow.createFlowShift({ seed: 7, ...STEADY, bufferSlots: 1 });
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
  let state = run(flow.createFlowShift({ seed: 7, ...STEADY, bufferSlots: 1 }), 40);
  assert.equal(flowViewFor(state).stations.find((s) => s.id === STATIONS.RECEIVING).alert, false);
  const gate = state.gates.find((item) => item.truck);
  state = finishAction(flow.unload(state, gate.id));
  assert.equal(flowViewFor(state).stations.find((s) => s.id === STATIONS.RECEIVING).alert, true,
    'забитый буфер останавливает приёмку — об этом надо кричать');
});

test('live goals read the same way before and after the shift ends', () => {
  const running = flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 30 }), 20));
  assert.deepEqual(running.goals.map((goal) => goal.id), ['missed', 'perishables']);
  const finished = flowViewFor(run(flow.createFlowShift({ seed: 7, seconds: 30 }), 30));
  assert.deepEqual(finished.goals.map((goal) => goal.id), ['missed', 'perishables']);
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

/* ---- Отбор и погрузка ---- */

const outboundShift = () => {
  const base = flow.createFlowShift({ seed: 7, initialStock: 0 });
  return {
    ...base,
    schedule: [],
    orderSchedule: [],
    stock: [
      { id: 'p-milk', sku: 'milk', zone: 'chilled', quantity: 2, supplier: 'Запас' },
      { id: 'p-water', sku: 'water', zone: 'dry', quantity: 2, supplier: 'Запас' },
    ],
    vans: [
      { id: 'van-water', storeId: 'west', sku: 'water', zone: 'dry', arrivedAt: 0, dueAt: 60 },
      { id: 'van-milk', storeId: 'north', sku: 'milk', zone: 'chilled', arrivedAt: 0, dueAt: 30 },
      { id: 'van-ice', storeId: 'east', sku: 'ice-cream', zone: 'frozen', arrivedAt: 0, dueAt: 45 },
    ],
  };
};
const at = (state, station) => finishAction(flow.goTo(state, station));
const vanOf = (state, id) => flowViewFor(state).vans.find((van) => van.id === id);

test('there are four stations, and the strip names all of them in warehouse order', () => {
  const view = flowViewFor(outboundShift());
  assert.deepEqual(view.stations.map((station) => station.name), ['Приёмка', 'Размещение', 'Отбор', 'Погрузка']);
  assert.equal(view.stations.filter((station) => station.here).length, 1);
});

test('vans are listed soonest-to-leave first, with the store, the goods and the time left', () => {
  const view = flowViewFor(outboundShift());
  assert.deepEqual(view.vans.map((van) => van.id), ['van-milk', 'van-ice', 'van-water']);
  const milk = view.vans[0];
  assert.equal(milk.storeName, 'Тушино');
  assert.equal(milk.goods, 'Молоко');
  assert.equal(milk.leftText, 'уйдёт через 30 с');
});

test('a van row says what stands between it and the action', () => {
  let state = outboundShift();
  // Вдали от отбора: товар есть, но игрок не там.
  assert.equal(vanOf(state, 'van-water').pickBlockedBy, 'station');
  assert.equal(vanOf(state, 'van-water').status, 'in-stock');
  // Мороженого в зонах нет вовсе — это важнее, чем где стоит игрок.
  assert.equal(vanOf(state, 'van-ice').pickBlockedBy, 'no-stock');
  assert.equal(vanOf(state, 'van-ice').loadBlockedBy, 'not-picked');

  state = at(state, STATIONS.PICKING);
  assert.equal(vanOf(state, 'van-water').canPick, true);
  assert.equal(vanOf(state, 'van-ice').canPick, false);

  const picking = flow.pick(state, 'van-water');
  assert.equal(vanOf(picking, 'van-water').picking, true);
  assert.equal(vanOf(picking, 'van-milk').pickBlockedBy, 'busy');

  state = finishAction(picking);
  assert.equal(vanOf(state, 'van-water').status, 'staged');
  assert.equal(vanOf(state, 'van-water').pickBlockedBy, 'staged');
  assert.equal(vanOf(state, 'van-water').loadBlockedBy, 'station', 'паллета у ворот, а игрок ещё на отборе');

  state = at(state, STATIONS.LOADING);
  assert.equal(vanOf(state, 'van-water').canLoad, true);
  assert.equal(vanOf(state, 'van-milk').canLoad, false);
});

test('a full dock blocks picking and says so', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-water'));
  state = { ...state, settings: { ...state.settings, stagingSlots: 1 } };
  assert.equal(vanOf(state, 'van-milk').pickBlockedBy, 'staging-full');
  assert.equal(flowViewFor(state).staging.full, true);
  assert.equal(flowViewFor(state).staging.free, 0);
});

test('a van grows urgent as its departure nears', () => {
  const state = outboundShift();
  assert.equal(vanOf(state, 'van-water').urgency, 'calm');
  assert.equal(vanOf(run(state, 12), 'van-milk').urgency, 'warning');
  assert.equal(vanOf(run(state, 22), 'van-milk').urgency, 'critical');
});

test('the dock shows each picked pallet with its remaining life', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-milk'));
  const staged = flowViewFor(state).staging.pallets[0];
  assert.equal(staged.goods, 'Молоко');
  assert.equal(staged.shelfText, `${flow.SHELF_SECONDS.chilled} с`);
  assert.equal(staged.shelfPercent, 100);
  assert.equal(flowViewFor(run(state, 12)).staging.pallets[0].urgency, 'warning');
});

test('the stock line counts pallets by goods, not by zone', () => {
  const view = flowViewFor(outboundShift());
  assert.deepEqual(view.stock, [
    { sku: 'milk', name: 'Молоко', count: 1 },
    { sku: 'water', name: 'Вода 1,5 л', count: 1 },
  ]);
});

test('the strip shows outbound pressure and raises the alarm where the player is not', () => {
  let state = outboundShift();
  const tab = (view, id) => view.stations.find((station) => station.id === id);
  let view = flowViewFor(state);
  assert.match(tab(view, STATIONS.PICKING).pressure, /2 фургона ждут/);
  assert.equal(tab(view, STATIONS.LOADING).pressure, 'пусто');
  assert.equal(tab(view, STATIONS.PICKING).alert, false);

  // Фургон за молоком вот-вот уйдёт, а молоко стоит в зоне.
  assert.equal(tab(flowViewFor(run(state, 12)), STATIONS.PICKING).alert, true);

  // Отобранный скоропорт тухнет у ворот — тревога переезжает на погрузку.
  state = at(state, STATIONS.PICKING);
  state = finishAction(flow.pick(state, 'van-milk'));
  view = flowViewFor(run(state, 12));
  assert.match(tab(view, STATIONS.LOADING).pressure, /1 паллета к погрузке/);
  assert.equal(tab(view, STATIONS.LOADING).alert, true);
});

test('with vans waiting and nothing in the zones, picking says the goods are missing', () => {
  const state = { ...outboundShift(), stock: [] };
  const picking = flowViewFor(state).stations.find((station) => station.id === STATIONS.PICKING);
  assert.equal(picking.pressure, 'товара нет в зонах');
});

test('the busy bar names the outbound actions too', () => {
  let state = at(outboundShift(), STATIONS.PICKING);
  assert.match(flowViewFor(flow.pick(state, 'van-water')).busy.label, /Везу к воротам отгрузки/);
  state = at(finishAction(flow.pick(state, 'van-water')), STATIONS.LOADING);
  assert.match(flowViewFor(flow.load(state, 'van-water')).busy.label, /Гружу в фургон/);
});

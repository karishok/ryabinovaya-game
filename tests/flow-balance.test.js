const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../flow-engine.js');

const { STATIONS, DURATIONS } = flow;

/* Числа смены — темп прибытия, сроки скоропорта, размер буфера — держатся
   друг за друга: перебор показал, что цель по бэклогу решает почти один
   темп прибытия, а умение игрока меряется скоропортом. Поэтому баланс
   проверяется не отдельными константами, а двумя игроками: смена должна
   быть проходимой для того, кто расставляет приоритеты, и проваливаться у
   того, кто возит в порядке поступления. */

// Умелый: батчит, пока батч не грозит убить самую срочную паллету.
function skilled(state) {
  const room = state.settings.bufferSlots - state.buffer.length;
  const truck = state.gates.find((gate) => gate.truck);
  const tightest = [...state.buffer].sort((a, b) => (a.shelf ?? Infinity) - (b.shelf ?? Infinity))[0];
  const drain = (count) => DURATIONS.walk + count * DURATIONS.putaway;
  const mustGo = tightest && tightest.shelf !== null && tightest.shelf <= drain(1) + DURATIONS.unload + 2;

  if (state.station === STATIONS.RECEIVING) {
    if (mustGo || room === 0 || !truck) return state.buffer.length ? flow.goTo(state, STATIONS.PUTAWAY) : state;
    return flow.unload(state, truck.id);
  }
  if (!tightest) return flow.goTo(state, STATIONS.RECEIVING);
  const canFetch = room > 1 && truck && state.buffer.length <= 1
    && (tightest.shelf === null || tightest.shelf > drain(state.buffer.length) + DURATIONS.unload + DURATIONS.walk);
  return canFetch ? flow.goTo(state, STATIONS.RECEIVING) : flow.putaway(state, tightest.id, tightest.zone);
}

// Небрежный: тот же объём работы, но в порядке поступления, без учёта срока.
function careless(state) {
  if (state.station === STATIONS.RECEIVING) {
    const gate = state.gates.find((item) => item.truck);
    if (gate && state.buffer.length < state.settings.bufferSlots) return flow.unload(state, gate.id);
    return flow.goTo(state, STATIONS.PUTAWAY);
  }
  if (state.buffer.length) return flow.putaway(state, state.buffer[0].id, state.buffer[0].zone);
  return flow.goTo(state, STATIONS.RECEIVING);
}

function playShift(seed, policy) {
  let state = flow.createFlowShift({ seed });
  let guard = 0;
  while (state.phase === 'running' && guard < 8000) {
    guard += 1;
    if (!state.busy) state = policy(state);
    state = flow.tick(state);
  }
  assert.ok(state.report, `смена ${seed} должна была закрыться`);
  return state.report;
}

const shareOf = (policy, predicate, seeds = 40) => {
  let hits = 0;
  for (let seed = 1; seed <= seeds; seed += 1) if (predicate(playShift(seed, policy))) hits += 1;
  return hits / seeds;
};

test('a player who prioritises by shelf life clears most shifts', () => {
  const won = shareOf(skilled, (report) => report.success);
  assert.ok(won >= 0.7, `умелый игрок должен проходить большинство смен, а прошёл ${Math.round(won * 100)}%`);
});

test('the shift is not a formality: prioritising wrong loses it', () => {
  const won = shareOf(careless, (report) => report.success);
  assert.ok(won <= 0.5, `небрежный игрок не должен проходить половину смен, а прошёл ${Math.round(won * 100)}%`);
});

test('the shelf clock is what separates the two, so it has to bite one and spare the other', () => {
  const skilledSpoils = shareOf(skilled, (report) => report.spoiled > 0);
  const carelessSpoils = shareOf(careless, (report) => report.spoiled > 0);
  assert.ok(skilledSpoils <= 0.2, `умелый почти не должен терять паллеты, теряет в ${Math.round(skilledSpoils * 100)}% смен`);
  assert.ok(carelessSpoils >= 0.5, `небрежный должен регулярно терять, теряет в ${Math.round(carelessSpoils * 100)}% смен`);
});

test('every shift stays finishable: the backlog goal is reachable, not a wall', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const report = playShift(seed, skilled);
    assert.ok(report.backlog <= flow.DEFAULTS.backlogLimit + 3,
      `смена ${seed}: бэклог ${report.backlog} — темп прибытия обгоняет любую работу`);
  }
});

test('the speed bonus is earned by working fast, not handed out for showing up', () => {
  const rushed = playShift(1, skilled);
  assert.ok(rushed.bonusFresh > 0, 'умелый игрок должен успевать брать бонус');
  const lazy = playShift(1, careless);
  assert.ok(lazy.bonusFresh < rushed.bonusFresh, 'небрежный должен брать бонус реже');
});

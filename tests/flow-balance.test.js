const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../flow-engine.js');

const { STATIONS: S, DURATIONS: D } = flow;

/* Числа смены — темп волн, сроки скоропорта, терпение фургонов, размеры
   буфера и зоны отгрузки — держатся друг за друга, поэтому баланс
   проверяется не константами, а двумя игроками: смена должна проходиться
   тем, кто смотрит на часы, и проваливаться у того, кто работает по кругу
   в порядке поступления.

   Оба игрока — с задержкой реакции. Бот, который жмёт мгновенно, ничего не
   говорит о человеке: при ровном потоке фур он проходил смену вплотную, а
   с одной секундой на решение проваливал её целиком. Смена, проходимая
   только без пауз, для живого игрока непроходима, и мерить её так — обман. */

const facts = (state) => {
  const staged = [...state.staging].sort((a, b) => (a.shelf ?? Infinity) - (b.shelf ?? Infinity));
  const loadable = state.vans.filter((van) => state.staging.some((p) => p.sku === van.sku)).sort((a, b) => a.dueAt - b.dueAt);
  const pickable = state.vans
    .filter((van) => state.stock.some((p) => p.sku === van.sku) && flow.stagedOf(state, van.sku) < flow.wantedOf(state, van.sku))
    .sort((a, b) => a.dueAt - b.dueAt);
  const buffer = [...state.buffer].sort((a, b) => (a.shelf ?? Infinity) - (b.shelf ?? Infinity));
  const truck = state.gates.find((gate) => gate.truck);
  const bufferRoom = state.settings.bufferSlots - state.buffer.length;
  const stagingRoom = state.settings.stagingSlots - state.staging.length;
  return { staged, loadable, pickable, buffer, truck, bufferRoom, stagingRoom };
};

// Умелый: смотрит на часы — и скоропорта, и фургонов — и не набирает больше, чем успеет довезти.
function skilled(state) {
  const f = facts(state);
  const here = state.station;
  const left = (van) => van.dueAt - state.elapsed;
  const go = (station) => (here === station ? state : flow.goTo(state, station));

  if (f.staged.length) {
    if (here === S.LOADING) {
      // Сначала паллета, которая ближе всех к порче; иначе фургон, который уйдёт первым.
      const tight = f.staged[0];
      const van = f.loadable.find((v) => v.sku === tight.sku) || f.loadable[0];
      return van ? flow.load(state, van.id) : go(S.PICKING);
    }
    if (here === S.PICKING && f.pickable.length && f.stagingRoom > 0) {
      const tight = f.staged[0];
      const cost = D.pick + D.walk + D.load * (f.staged.length + 1) + 2;
      const firstDue = Math.min(...f.loadable.map(left));
      if ((tight.shelf === null || tight.shelf > cost) && firstDue > cost) return flow.pick(state, f.pickable[0].id);
    }
    return go(S.LOADING);
  }

  const tightBuffer = f.buffer[0];
  if (tightBuffer && tightBuffer.shelf !== null && tightBuffer.shelf <= D.walk + D.putaway + 4) {
    return here === S.PUTAWAY ? flow.putaway(state, tightBuffer.id, tightBuffer.zone) : go(S.PUTAWAY);
  }
  const urgentVan = f.pickable.find((van) => left(van) <= D.walk * 2 + D.pick + D.load + 8);
  if (urgentVan && f.stagingRoom > 0) return here === S.PICKING ? flow.pick(state, urgentVan.id) : go(S.PICKING);

  if (here === S.PUTAWAY && tightBuffer) return flow.putaway(state, tightBuffer.id, tightBuffer.zone);
  if (here === S.PICKING && f.pickable.length && f.stagingRoom > 0) return flow.pick(state, f.pickable[0].id);
  if (here === S.RECEIVING && f.truck && f.bufferRoom > 0) {
    const waiting = tightBuffer && tightBuffer.shelf !== null && tightBuffer.shelf <= D.walk + D.putaway + D.unload + 2;
    if (!waiting && state.buffer.length < 2) return flow.unload(state, f.truck.id);
  }
  if (f.buffer.length) return go(S.PUTAWAY);
  if (f.pickable.length && f.stagingRoom > 0) return go(S.PICKING);
  if (f.truck && f.bufferRoom > 0) return go(S.RECEIVING);
  return state;
}

// Небрежный: тот же объём работы, но по кругу и в порядке поступления, без оглядки на часы.
function careless(state) {
  const f = facts(state);
  const here = state.station;
  const ring = [S.RECEIVING, S.PUTAWAY, S.PICKING, S.LOADING];
  if (here === S.RECEIVING && f.truck && f.bufferRoom > 0) return flow.unload(state, f.truck.id);
  if (here === S.PUTAWAY && state.buffer.length) return flow.putaway(state, state.buffer[0].id, state.buffer[0].zone);
  if (here === S.PICKING && f.stagingRoom > 0) {
    const van = [...state.vans].find((v) => state.stock.some((p) => p.sku === v.sku) && flow.stagedOf(state, v.sku) < flow.wantedOf(state, v.sku));
    if (van) return flow.pick(state, van.id);
  }
  if (here === S.LOADING) {
    const van = state.vans.find((v) => state.staging.some((p) => p.sku === v.sku));
    if (van) return flow.load(state, van.id);
  }
  const hasWork = { [S.RECEIVING]: f.truck && f.bufferRoom > 0, [S.PUTAWAY]: state.buffer.length > 0, [S.PICKING]: f.pickable.length > 0 && f.stagingRoom > 0, [S.LOADING]: f.loadable.length > 0 };
  for (let step = 1; step <= 4; step += 1) {
    const next = ring[(ring.indexOf(here) + step) % 4];
    if (next !== here && hasWork[next]) return flow.goTo(state, next);
  }
  return state;
}

// Человек: между концом действия и следующим нажатием проходит reaction секунд.
function playShift(seed, policy, reaction = 1, options = {}) {
  let state = flow.createFlowShift({ seed, ...options });
  let idle = 0;
  let guard = 0;
  while (state.phase === 'running' && guard < 9000) {
    guard += 1;
    if (state.busy) idle = 0;
    else if (idle < reaction) idle += 1;
    else {
      const next = policy(state);
      if (next !== state) idle = 0;
      state = next;
    }
    state = flow.tick(state);
  }
  assert.ok(state.report, `смена ${seed} должна была закрыться`);
  return state.report;
}

const shareOf = (policy, predicate, reaction = 1, seeds = 60) => {
  let hits = 0;
  for (let seed = 1; seed <= seeds; seed += 1) if (predicate(playShift(seed, policy, reaction))) hits += 1;
  return hits / seeds;
};
const percent = (share) => `${Math.round(share * 100)}%`;

test('a player who watches the clocks clears most shifts, even thinking a second per move', () => {
  const won = shareOf(skilled, (report) => report.success, 1);
  assert.ok(won >= 0.8, `умелый игрок должен проходить большинство смен, а прошёл ${percent(won)}`);
});

test('a slower player still has a real chance: two seconds per move is not a wall', () => {
  const won = shareOf(skilled, (report) => report.success, 2);
  assert.ok(won >= 0.55, `с двумя секундами на решение смена должна оставаться проходимой, а пройдено ${percent(won)}`);
});

test('the shift is not a formality: working in arrival order loses it', () => {
  const won = shareOf(careless, (report) => report.success, 1);
  assert.ok(won <= 0.35, `небрежный игрок не должен проходить и трети смен, а прошёл ${percent(won)}`);
});

test('the clocks are what separate the two players, so they bite one and spare the other', () => {
  const lostFresh = (report) => !report.goals.find((goal) => goal.id === 'perishables').ok;
  const skilledSpoils = shareOf(skilled, lostFresh, 1);
  const carelessSpoils = shareOf(careless, lostFresh, 1);
  assert.ok(skilledSpoils <= 0.2, `умелый почти не должен терять скоропорт, теряет в ${percent(skilledSpoils)} смен`);
  assert.ok(carelessSpoils >= 0.6, `небрежный должен регулярно терять, теряет в ${percent(carelessSpoils)} смен`);
});

test('every shift is solvable in principle: played without pauses, none is lost', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const report = playShift(seed, skilled, 0);
    assert.equal(report.success, true, `смена ${seed}: сорвано ${report.missed}, списано ${report.spoiled} — такой расклад не пройти никому`);
  }
});

test('both halves of the warehouse carry the shift: the goods shipped are the goods received', () => {
  /* Отгрузить можно только то, что стоит в зонах. Игрок, который не
     принимает фуры, отгрузит стартовый запас и на этом встанет. */
  const noReceiving = (state) => {
    const next = skilled(state);
    return next.busy?.kind === 'unload' || next.busy?.to === S.RECEIVING ? state : next;
  };
  for (const seed of [1, 2, 3, 4, 5]) {
    const full = playShift(seed, skilled, 0);
    const half = playShift(seed, noReceiving, 0);
    assert.ok(half.shipped <= flow.DEFAULTS.initialStock, `смена ${seed}: без приёмки отгружено ${half.shipped}`);
    assert.ok(full.shipped > half.shipped, `смена ${seed}: приёмка должна давать отгрузке товар`);
    assert.equal(half.success, false);
  }
});

test('the speed bonus is earned by working fast, not handed out for showing up', () => {
  let rushed = 0;
  let lazy = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    rushed += playShift(seed, skilled, 1).bonusFresh;
    lazy += playShift(seed, careless, 1).bonusFresh;
  }
  assert.ok(rushed > 0, 'умелый игрок должен успевать брать бонус');
  assert.ok(lazy < rushed, `небрежный должен брать бонус реже: ${lazy} против ${rushed}`);
});

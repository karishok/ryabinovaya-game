const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGame(levelId = 1) {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', disabled: false, hidden: false, className: '',
      dataset: {}, attributes: {},
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      classList: { values: new Set(), toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      focus() {},
    });
    return elements.get(id);
  };
  const zones = ['dry', 'chilled', 'frozen'].map((zone) => ({ ...elementFor(`zone-${zone}`), dataset: { sceneZone: zone } }));
  const gates = ['dry', 'chilled', 'frozen'].map((gateZone) => ({ ...elementFor(`gate-${gateZone}`), dataset: { gateZone } }));
  let clickHandler;
  const document = {
    getElementById: elementFor,
    querySelector: () => elementFor('pause'),
    querySelectorAll(selector) {
      if (selector === '[data-scene-zone]') return zones;
      return selector === '[data-gate-zone]' ? gates : [];
    },
    addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
  };
  const timers = [];
  const window = {
    RyabinovayaEngine: require('../game-engine.js'),
    RyabinovayaLevels: require('../levels.js'),
    RyabinovayaAppState: require('../app-state.js'),
    RyabinovayaSceneView: require('../scene-view.js'),
    RyabinovayaTsdView: require('../tsd-view.js'),
    RyabinovayaTsdSignal: require('../tsd-signal.js'),
    RyabinovayaFpView: require('../fp-view.js'),
    localStorage: { getItem: () => String(levelId), setItem() {} },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  const click = (dataset) => clickHandler({ target: { closest: () => ({ dataset, disabled: false, focus() {} }) } });
  const scene = () => elementFor('warehouseScene');
  return {
    window, elements, click, timers, gates,
    where: () => window.fpLocation(),
    scene,
    toast: () => elementFor('toast').textContent,
    start() { click({ action: 'CONTINUE_STORY' }); },
    zone: (zone) => click({ action: 'SELECT_ZONE', zone, sceneZone: zone }),
    gate: (zone) => click({ action: 'GATE', gateZone: zone }),
    add: (sku, zone, weight, quantity) => click({ action: 'ADD_ITEM', sku, zone, weight: String(weight), quantity: String(quantity) }),
  };
}

test('guided shift: the card drives to the shelf, the load button drives to shipping, the gate loads', () => {
  const game = loadGame(1);
  game.start();
  assert.equal(game.where(), 'hub');
  assert.equal(game.scene().dataset.location, 'hub');

  game.click({ action: 'OPEN_BUILDER' });
  assert.equal(game.where(), 'shelf:dry');
  assert.equal(game.scene().dataset.location, 'shelf');
  assert.equal(game.scene().dataset.shelfZone, 'dry');

  game.add('water', 'dry', 12, 2);
  // Кнопка сборки больше не грузит сама: она везёт к воротам.
  game.click({ action: 'LOAD_PALLET' });
  assert.equal(game.where(), 'shipping');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.window.dispatch({ type: 'TICK' }).loadedPallets.length, 0);

  game.gate('dry');
  assert.match(game.toast(), /в кузов/i);
  assert.equal(game.window.dispatch({ type: 'TICK' }).loadedPallets.length, 1);
  assert.equal(game.where(), 'shipping');
});

test('a gate of another zone refuses the pallet and the worker stays at shipping', () => {
  // Третья смена: машины есть у двух температур, так что ошибиться воротами можно.
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  assert.equal(game.elements.get('tsdDevice').dataset.screen, 'feedback');
  assert.match(game.elements.get('tsdMessage').textContent, /не берёт/);
  assert.equal(game.where(), 'shipping');
  assert.equal(game.window.dispatch({ type: 'DISMISS_FEEDBACK' }).loadedPallets.length, 0);
});

test('the load button with an empty pallet now drives to shipping, and the gate never loads an empty pallet', () => {
  const game = loadGame(1);
  game.start();
  game.click({ action: 'OPEN_BUILDER' });
  game.click({ action: 'LOAD_PALLET' });
  // К отгрузке едут всегда: взглянуть на машины можно и с пустой паллетой.
  assert.equal(game.where(), 'shipping');
  game.gate('dry');
  assert.equal(game.window.dispatch({ type: 'TICK' }).loadedPallets.length, 0);
  assert.equal(game.elements.get('vehicleModal').attributes['aria-hidden'], 'false');
});

test('guided receiving: the truck, the aisle, then the shelf of the tapped zone', () => {
  const game = loadGame(2);
  game.start();
  assert.equal(game.where(), 'receiving');
  game.click({ action: 'RECEIVE_PALLET' });
  assert.equal(game.where(), 'hub');
  game.zone('frozen');
  // Вода в заморозке: паллета испорчена, и видно, куда её привезли.
  assert.equal(game.where(), 'shelf:frozen');
  assert.equal(game.elements.get('tsdDevice').dataset.screen, 'feedback');
});

test('queue shift: accepting a pick task no longer opens the builder, it puts the worker in the aisle', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  assert.equal(game.where(), 'hub');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.elements.get('tsdDevice').dataset.open, 'false');
});

test('queue shift: the right shelf opens the builder, a wrong shelf only says so', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });

  game.zone('frozen');
  assert.equal(game.where(), 'shelf:frozen');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.match(game.toast(), /другая зона/);
  // Нажатие на паллету у чужой полки сборку тоже не открывает.
  game.click({ action: 'OPEN_BUILDER' });
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');

  game.click({ action: 'GO_HUB' });
  assert.equal(game.where(), 'hub');
  game.zone('chilled');
  assert.equal(game.where(), 'shelf:chilled');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'false');
});

test('queue shift: zone signs do nothing until a pick task is accepted', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'CLOSE_TSD' });
  game.zone('chilled');
  assert.equal(game.where(), 'hub');
  assert.match(game.toast(), /Сначала примите задание/);
});

test('queue shift: an order heavier than a pallet returns to the shelf with the builder open', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('chilled');
  assert.equal(game.where(), 'shipping');

  game.click({ action: 'ACCEPT_TASK' });
  game.zone('dry');
  game.add('water', 'dry', 12, 8);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  assert.equal(game.where(), 'shelf:dry');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'false');
});

test('a gate tapped with an empty pallet opens the vehicles panel of that zone', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'CLOSE_TSD' });
  game.gate('chilled');
  assert.equal(game.elements.get('vehicleModal').attributes['aria-hidden'], 'false');
  assert.match(game.elements.get('vehicleTask').textContent, /Охлажд/i);
  assert.equal(game.where(), 'shipping');
});

test('receiving in a queue shift shows the truck for a moment on the way to the aisle', () => {
  const game = loadGame(4);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  assert.equal(game.where(), 'hub');
  // Место уже проезд, а кадр ещё показывает фуру: его сменит таймер.
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'receiving');
  const pass = game.timers.find((timer) => timer.delay === 900);
  assert.ok(pass, 'the pass-through frame must be timed');
  pass.callback();
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'hub');
});

/* Доводит смену с очередью до момента, когда следующее задание срочное нужного
   вида, играя настоящими действиями через window.dispatch. Возвращает true,
   когда сборка уже открыта у полки (как её видит игрок с ТСД в руках). */
function reachUrgent(game, kind) {
  const A = game.window.RyabinovayaAppState;
  const E = game.window.RyabinovayaEngine;
  const d = (action) => game.window.dispatch(action);
  let s = d({ type: 'CONTINUE_STORY' });
  const urgent = () => A.nextTaskFor(s)?.urgent && A.nextTaskFor(s).kind === kind;
  for (let step = 0; step < 40; step++) {
    if (!A.currentTaskFor(s)) s = d({ type: 'ACCEPT_TASK' });
    const task = A.currentTaskFor(s);
    if (!task) { s = d({ type: 'TICK' }); continue; }
    if (task.kind === 'receive') {
      const pallet = s.inbound.find((entry) => entry.id === task.inboundId);
      s = d({ type: 'PLACE_PALLET', zone: pallet.zone });
      s = d({ type: 'TICK' });
      continue;
    }
    if (task.kind === 'unload') {
      const orphan = A.orphanPalletsFor(s).find((entry) => entry.vehicleId === task.vehicleId);
      s = d({ type: 'UNLOAD_PALLET', vehicleId: orphan.vehicleId, palletIndex: orphan.palletIndex });
      continue;
    }
    const order = s.orders.find((entry) => entry.id === task.orderIds[0]);
    const item = E.itemBySku(order.sku);
    s = d({ type: 'ADD_ITEM', sku: order.sku, zone: order.zone, weightPerUnit: item.weightPerUnit, quantity: 1 });
    for (let k = 0; k < 4 && !urgent(); k++) s = d({ type: 'TICK' });
    if (urgent()) {
      // Игрок стоит у полки с открытой сборкой: именно там ТСД предлагает срочное.
      game.click({ action: 'OPEN_BUILDER' });
      return true;
    }
    for (let g = 0; g < 4 && A.currentTaskFor(s)?.id === task.id; g++) {
      for (const id of A.currentTaskFor(s).orderIds) {
        const o = s.orders.find((entry) => entry.id === id);
        const it = E.itemBySku(o.sku);
        const q = Math.min(A.remainingFor(s, o), Math.floor((s.pallet.capacity - s.pallet.weight) / it.weightPerUnit));
        if (q > 0) s = d({ type: 'ADD_ITEM', sku: o.sku, zone: o.zone, weightPerUnit: it.weightPerUnit, quantity: q });
      }
      s = d({ type: 'LOAD_PALLET' });
    }
  }
  return false;
}

test('urgent unload taken from the open builder ends at shipping, and its gate opens the vehicles', () => {
  const game = loadGame(6);
  assert.ok(reachUrgent(game, 'unload'));
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'false');
  game.click({ action: 'TAKE_URGENT' });
  assert.equal(game.where(), 'shipping');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  const state = game.window.dispatch({ type: 'TICK' });
  assert.equal(state.builderOpen, false);
  const zone = game.window.RyabinovayaAppState.currentTaskFor(state).vehicleId;
  const vehicle = state.vehicles.find((entry) => entry.id === zone);
  game.gate(vehicle.zone);
  assert.equal(game.elements.get('vehicleModal').attributes['aria-hidden'], 'false');
});

test('urgent pick taken from the open builder ends in the aisle with the builder closed', () => {
  const game = loadGame(5);
  assert.ok(reachUrgent(game, 'pick'));
  game.click({ action: 'TAKE_URGENT' });
  assert.equal(game.where(), 'hub');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.window.dispatch({ type: 'TICK' }).builderOpen, false);
});

test('urgent receive taken from the open builder passes the truck, and the clock does not cut the frame', () => {
  const game = loadGame(9);
  assert.ok(reachUrgent(game, 'receive'));
  game.click({ action: 'TAKE_URGENT' });
  assert.equal(game.where(), 'hub');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'receiving');
  // Часы тикают раз в секунду и не должны гасить кадр фуры раньше таймера.
  game.window.dispatch({ type: 'TICK' });
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'receiving');
  game.timers.filter((timer) => timer.delay === 900).at(-1).callback();
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'hub');
});

test('shipping is reachable from the aisle with an empty pallet and has a way back', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'CLOSE_TSD' });
  assert.equal(game.where(), 'hub');
  game.window.dispatch({ type: 'GO_SHIPPING' });
  assert.equal(game.where(), 'shipping');
  game.window.dispatch({ type: 'GO_HUB' });
  assert.equal(game.where(), 'hub');
});

test('each shipping truck shows as many pallets as are loaded in it, up to three', () => {
  // Третья смена: две сухие машины и охлаждёнка.
  const game = loadGame(3);
  game.start();
  const load = (zone) => game.elements.get(`truckLoad-${zone}`).dataset.pallets;
  assert.equal(load('dry'), '0');
  assert.equal(load('chilled'), '0');

  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  // Привёз, но ещё не погрузил: кузов пуст.
  assert.equal(load('chilled'), '0');
  game.gate('chilled');
  assert.equal(load('chilled'), '1');
  assert.equal(load('dry'), '0');

  // Заявка на 120 кг воды едет двумя паллетами в две сухие машины — у ворот одна фура,
  // и в ней видны обе.
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('dry');
  game.add('water', 'dry', 12, 8);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  game.add('water', 'dry', 12, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  assert.equal(load('dry'), '2');
});

test('a pallet taken off a truck disappears from it', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('chilled');
  assert.equal(game.elements.get('truckLoad-chilled').dataset.pallets, '1');
  game.click({ action: 'UNLOAD_PALLET', vehicleId: 'chilled-1', palletIndex: '0' });
  assert.equal(game.elements.get('truckLoad-chilled').dataset.pallets, '0');
});

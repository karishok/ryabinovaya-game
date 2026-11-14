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
  let clickHandler;
  const document = {
    getElementById: elementFor,
    querySelector: () => elementFor('pause'),
    querySelectorAll(selector) { return selector === '[data-scene-zone]' ? zones : []; },
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
    window, elements, click, timers,
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

test('the load button with an empty pallet stays at the shelf and says why', () => {
  const game = loadGame(1);
  game.start();
  game.click({ action: 'OPEN_BUILDER' });
  game.click({ action: 'LOAD_PALLET' });
  assert.equal(game.where(), 'shelf:dry');
  assert.match(game.elements.get('builderFeedback').textContent + game.toast(), /Сначала добавьте товар/);
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

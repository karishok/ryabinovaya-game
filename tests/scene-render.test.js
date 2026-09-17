const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const appState = require('../app-state.js');
const sceneView = require('../scene-view.js');
const tsdView = require('../tsd-view.js');
const tsdSignal = require('../tsd-signal.js');
const levels = require('../levels.js');
const { LEVELS } = levels;

function loadUi() {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', disabled: false, hidden: false,
      dataset: {}, attributes: {},
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      classList: { values: new Set(), toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
    });
    return elements.get(id);
  };
  const zones = ['dry', 'chilled', 'frozen'].map((zone) => ({ ...elementFor(`zone-${zone}`), dataset: { sceneZone: zone } }));
  const document = {
    getElementById: elementFor,
    querySelector: () => elementFor('pause'),
    querySelectorAll(selector) { return selector === '[data-scene-zone]' ? zones : []; },
    addEventListener() {},
  };
  const window = {
    RyabinovayaEngine: engine,
    RyabinovayaLevels: levels,
    RyabinovayaAppState: appState,
    RyabinovayaSceneView: sceneView,
    RyabinovayaTsdView: tsdView,
    RyabinovayaTsdSignal: tsdSignal,
    setTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  return { window, elements, zones };
}

test('renderScene mirrors scene state into the warehouse layers', () => {
  const { window, elements, zones } = loadUi();
  window.renderScene({
    activeZone: 'chilled', selectedZone: 'chilled', selectedVehicleZone: 'chilled',
    mode: 'to-dispatch', palletFillPercent: 42, loadedPalletCount: 2,
    routeReady: false, eventCode: '', highlightObject: 'pallet', statusText: 'Тележка едет.', operatorName: 'Миша',
  }, {
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => zones,
  });

  assert.equal(elements.get('warehouseScene').dataset.mode, 'to-dispatch');
  assert.equal(elements.get('warehouseScene').dataset.activeZone, 'chilled');
  assert.equal(elements.get('warehouseScene').dataset.highlight, 'pallet');
  assert.equal(elements.get('sceneStatus').textContent, 'Тележка едет.');
  assert.equal(elements.get('sceneOperatorName').textContent, 'Миша');
  assert.equal(elements.get('scenePallet').style.values['--pallet-fill'], '42%');
  assert.equal(elements.get('sceneTruckBay').dataset.loadedPallets, '2');
  assert.equal(zones.find((zone) => zone.dataset.sceneZone === 'chilled').attributes['aria-current'], 'true');
});

test('renderTsd mirrors terminal state into semantic visibility and content', () => {
  const { window, elements } = loadUi();
  window.renderTsd({
    open: false, screen: 'current', signal: 'idle', title: 'Текущая работа',
    storeName: 'Северный', orderText: 'Вода · 2 шт.', zoneName: 'Сухач',
    progressText: '24 / 100 кг', message: 'Готово.', canAccept: false,
  }, { getElementById: (id) => elements.get(id) });

  assert.equal(elements.get('tsdDevice').dataset.open, 'false');
  assert.equal(elements.get('tsdDevice').dataset.screen, 'current');
  assert.equal(elements.get('tsdBackdrop').attributes['aria-hidden'], 'true');
  assert.equal(elements.get('tsdScreen').attributes['aria-hidden'], 'true');
  assert.equal(elements.get('tsdTitle').textContent, 'Текущая работа');
  assert.equal(elements.get('tsdZone').textContent, 'Зона: Сухач');
  assert.equal(elements.get('tsdAccept').hidden, true);
});

test('renderTsd shows exactly one panel and marks inactive panels hidden', () => {
  const { window, elements } = loadUi();
  const panelNames = ['briefing', 'task', 'current', 'builder', 'vehicles', 'feedback', 'report', 'guide'];
  const panels = panelNames.map((name) => ({
    dataset: { tsdPanel: name },
    hidden: true,
    attributes: {},
    setAttribute(attribute, value) { this.attributes[attribute] = String(value); },
  }));
  const document = {
    getElementById: (id) => elements.get(id),
    querySelectorAll: (selector) => {
      assert.equal(selector, '[data-tsd-panel]');
      return panels;
    },
  };

  window.renderTsd({
    open: true, screen: 'vehicles', signal: 'idle', title: 'Машины',
    storeName: '', orderText: '', zoneName: '', progressText: '0 / 100 кг',
    message: '', canAccept: false,
  }, document);

  assert.equal(panels.filter((panel) => !panel.hidden).length, 1);
  for (const panel of panels) {
    assert.equal(panel.hidden, panel.dataset.tsdPanel !== 'vehicles');
    assert.equal(panel.attributes['aria-hidden'], String(panel.hidden));
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const appState = require('../app-state.js');
const sceneView = require('../scene-view.js');
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
    routeReady: false, eventCode: '', statusText: 'Тележка едет.', operatorName: 'Миша',
  }, {
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => zones,
  });

  assert.equal(elements.get('warehouseScene').dataset.mode, 'to-dispatch');
  assert.equal(elements.get('warehouseScene').dataset.activeZone, 'chilled');
  assert.equal(elements.get('sceneStatus').textContent, 'Тележка едет.');
  assert.equal(elements.get('sceneOperatorName').textContent, 'Миша');
  assert.equal(elements.get('scenePalletFill').style.values['--pallet-fill'], '42%');
  assert.equal(elements.get('sceneTruckBay').dataset.loadedPallets, '2');
  assert.equal(zones.find((zone) => zone.dataset.sceneZone === 'chilled').attributes['aria-current'], 'true');
});

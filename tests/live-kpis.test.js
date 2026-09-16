const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const appState = require('../app-state.js');
const { LEVELS } = require('../levels.js');

function renderKpis(state) {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, {
      classList: { toggle() {} },
      setAttribute() {},
      textContent: '',
      innerHTML: '',
      disabled: false,
    });
    return elements.get(id);
  };
  const document = {
    getElementById: elementFor,
    querySelector: () => elementFor('pause'),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = {
    RyabinovayaEngine: engine,
    RyabinovayaLevels: { LEVELS },
    RyabinovayaAppState: appState,
    setTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  window.render(state, document);
  return { orders: elementFor('orders').textContent, precision: elementFor('precision').textContent };
}

test('live orders KPI counts fulfilled quantities instead of loaded pallet rows', () => {
  const pallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 12,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 }],
  };
  const state = {
    ...appState.startLevel(1),
    selectedVehicleId: 'dry-1',
    orders: [{ id: 'north-water', storeId: 'north', zone: 'dry', sku: 'water', quantity: 2 }],
    loadedPallets: [pallet],
    vehicles: [{ id: 'dry-1', zone: 'dry', capacity: 100, pallets: [pallet] }],
    route: { stops: ['north'], minutes: 15 },
    routesByVehicle: { 'dry-1': { stops: ['north'], minutes: 15 } },
  };

  assert.equal(renderKpis(state).orders, '1 / 2');
});

test('live and final precision agree regardless of the selected vehicle', () => {
  // dryPallet actually carries deliverable cargo (water for the level-1 "north" order),
  // while chilledPallet is dead weight with no matching order — so usefulWeight (24)
  // diverges from loadedWeight (100) and precision lands on a real, non-degenerate 24%.
  const dryPallet = {
    storeId: 'north', zone: 'dry', vehicleId: 'dry-1', weight: 80,
    items: [{ sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 }],
  };
  const chilledPallet = { storeId: 'central', zone: 'chilled', vehicleId: 'chilled-1', weight: 20, items: [] };
  const state = {
    ...appState.startLevel(1),
    loadedPallets: [dryPallet, chilledPallet],
    vehicles: [
      { id: 'dry-1', zone: 'dry', capacity: 100, pallets: [dryPallet] },
      { id: 'chilled-1', zone: 'chilled', capacity: 200, pallets: [chilledPallet] },
    ],
    route: { stops: ['north'], minutes: 15 },
    routesByVehicle: { 'dry-1': { stops: ['north'], minutes: 15 } },
    metrics: { spoiledPallets: 0, routePenalty: 0 },
  };

  // usefulWeight (24 = 2 * 12kg water) / loadedWeight (100 = 80 + 20) -> round(24) = 24%.
  assert.equal(renderKpis({ ...state, selectedVehicleId: 'dry-1' }).precision, '24%');
  assert.equal(renderKpis({ ...state, selectedVehicleId: 'chilled-1' }).precision, '24%');
  assert.equal(appState.finishShift(state).report.precisionPercent, 24);
});

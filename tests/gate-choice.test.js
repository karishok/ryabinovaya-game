const test = require('node:test');
const assert = require('node:assert/strict');
const appState = require('../app-state.js');
const engine = require('../game-engine.js');

const { reduceAction, startLevel, liveMetrics } = appState;

function shiftWithWaterOnPallet() {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  const water = engine.itemBySku('water');
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: water.weightPerUnit, quantity: 1 });
  assert.equal(state.pallet.weight, 12);
  return state;
}

const reportOf = (state) => reduceAction(reduceAction(state, { type: 'DISMISS_FEEDBACK' }), { type: 'END_SHIFT' }).report;

test('a gate of another zone refuses the pallet and costs nothing but time', () => {
  const before = shiftWithWaterOnPallet();
  const after = reduceAction(before, { type: 'LOAD_PALLET', gateZone: 'frozen' });

  assert.equal(after.feedback.kind, 'error');
  assert.equal(after.feedback.code, 'wrong-gate');
  assert.match(after.feedback.message, /не берёт/);
  // Паллета цела и осталась на тележке, машины пусты.
  assert.equal(after.loadedPallets.length, 0);
  assert.deepEqual(after.pallet, before.pallet);
  assert.deepEqual(after.vehicles, before.vehicles);
  // Ни показатели смены, ни отчёт об ошибке не узнают.
  assert.deepEqual(after.metrics, before.metrics);
  assert.deepEqual(liveMetrics(after), liveMetrics(before));
  assert.deepEqual(reportOf(after), reportOf(before));
});

test('the gate of the pallet zone loads it as before', () => {
  const after = reduceAction(shiftWithWaterOnPallet(), { type: 'LOAD_PALLET', gateZone: 'dry' });
  assert.equal(after.feedback.code, 'pallet-loaded');
  assert.equal(after.loadedPallets.length, 1);
});

test('LOAD_PALLET without a gate still lets the game pick the vehicle', () => {
  const after = reduceAction(shiftWithWaterOnPallet(), { type: 'LOAD_PALLET' });
  assert.equal(after.feedback.code, 'pallet-loaded');
  assert.equal(after.loadedPallets.length, 1);
});

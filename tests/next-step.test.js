const test = require('node:test');
const assert = require('node:assert/strict');
const { nextStepFor, warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

const add = (state, quantity = 1) => reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity });
const begin = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });

/* Карточка «Сейчас» должна отвечать на вопрос «куда нажать» в каждом
   состоянии смены, а не только после первого удачного действия. */

test('there is no step before the shift starts: the briefing owns the screen', () => {
  assert.equal(nextStepFor(startLevel(1)), null);
});

test('an untouched shift already points at the pallet, before any item is added', () => {
  const step = nextStepFor(begin(1));
  assert.equal(step.key, 'collect');
  assert.equal(step.action, 'OPEN_BUILDER');
  assert.equal(step.focus, 'pallet');
  assert.match(step.title, /Тушино/);
  assert.match(step.detail, /ещё 2 шт\./);
});

test('a half-built pallet keeps the player on the pallet and counts what is left', () => {
  const step = nextStepFor(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  assert.equal(step.key, 'collect');
  assert.match(step.detail, /ещё 1 шт\./);
});

test('a pallet that covers the order switches the step to loading', () => {
  const state = add(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  const step = nextStepFor(state);
  assert.equal(step.key, 'load');
  assert.equal(step.action, 'LOAD_PALLET');
  assert.equal(step.focus, 'pallet');
});

test('with every order loaded the step is to end the shift', () => {
  let state = add(add(reduceAction(begin(1), { type: 'ACCEPT_TASK' })));
  state = reduceAction(state, { type: 'LOAD_PALLET' });
  const step = nextStepFor(state);
  assert.equal(step.key, 'finish');
  assert.equal(step.action, 'END_SHIFT');
});

test('an arrived delivery comes before picking, and placement names the zone', () => {
  let state = begin(2);
  let step = nextStepFor(state);
  assert.equal(step.key, 'receive');
  assert.equal(step.action, 'OPEN_TSD');
  assert.equal(step.focus, 'dock');
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  step = nextStepFor(state);
  assert.equal(step.key, 'place');
  assert.equal(step.action, 'SELECT_ZONE');
  assert.equal(step.zone, 'dry');
  assert.equal(step.focus, 'zone');
  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  assert.equal(nextStepFor(state).key, 'collect');
});

test('the scene view carries the focus of the step so the hotspot can light up', () => {
  const view = warehouseViewFor(begin(1));
  assert.equal(view.focus, 'pallet');
  assert.equal(view.nextStep.key, 'collect');
});

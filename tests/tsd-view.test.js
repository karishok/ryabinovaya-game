const test = require('node:test');
const assert = require('node:assert/strict');
const { startLevel, reduceAction } = require('../app-state.js');
const { terminalViewFor } = require('../tsd-view.js');

test('briefing view uses the level story inside the TSD', () => {
  const view = terminalViewFor(startLevel(1));
  assert.equal(view.screen, 'briefing');
  assert.equal(view.open, true);
  assert.equal(view.title, 'Новая смена');
  assert.ok(view.message.length > 0);
  assert.equal(view.storyKind, 'before');
});

test('task view names the store, goods and Russian zone', () => {
  const state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  const view = terminalViewFor(state);
  assert.equal(view.title, 'Новое задание');
  assert.equal(view.storeName, 'Тушино');
  assert.equal(view.orderText, 'Вода 1,5 л · 2 шт.');
  assert.equal(view.zoneName, 'Сухач');
  assert.equal(view.canAccept, true);
});

test('current view reports pallet progress without changing task data', () => {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  const before = JSON.parse(JSON.stringify(state));
  assert.equal(terminalViewFor(state).progressText, '12 / 100 кг');
  assert.deepEqual(state, before);
});

test('feedback view puts operational errors on the TSD', () => {
  const state = {
    ...startLevel(1),
    feedback: { kind: 'error', code: 'wrong-zone', message: 'Этот товар нужно собирать в другой зоне.' },
  };
  const view = terminalViewFor(state);
  assert.equal(view.signal, 'error');
  assert.equal(view.message, 'Этот товар нужно собирать в другой зоне.');
});

test('feedback screen reopens the TSD when an error arrives while it is closed', () => {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = {
    ...state,
    feedback: { kind: 'error', code: 'wrong-zone', message: 'Этот товар нужно собирать в другой зоне.' },
  };
  const view = terminalViewFor(state);
  assert.equal(view.screen, 'feedback');
  assert.equal(view.open, true);
});

test('report and after-story screens reopen the TSD when their state is closed', () => {
  const initial = startLevel(1);
  const report = terminalViewFor({
    ...initial,
    phase: 'report',
    report: { reasons: ['Смена завершена.'] },
    tsd: { ...initial.tsd, open: false },
  });
  const story = terminalViewFor({
    ...initial,
    phase: 'story-after',
    story: { kind: 'after', text: 'Первая заявка закрыта.' },
    tsd: { ...initial.tsd, open: false },
  });
  assert.deepEqual({ screen: report.screen, open: report.open }, { screen: 'report', open: true });
  assert.deepEqual({ screen: story.screen, open: story.open }, { screen: 'briefing', open: true });
});

test('an already accepted task cannot be accepted again when reopened', () => {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'SHOW_TSD_TASK' });
  const view = terminalViewFor(state);
  assert.equal(view.screen, 'task');
  assert.equal(view.canAccept, false);
});

test('the closed terminal never labels an empty queue as a new task', () => {
  const { LEVELS } = require('../levels.js');
  const one = LEVELS.find((level) => level.newMechanic === 'one-order').id;
  let state = reduceAction(startLevel(one), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET' });

  const view = terminalViewFor(state);
  assert.equal(view.compactTask, 'Все заявки собраны');
  /* Подпись обязана согласовываться со строкой под ней: «Новое задание»
     над «Все заявки собраны» — прямое противоречие. */
  assert.notEqual(view.compactKicker, 'Новое задание');
  assert.equal(view.compactKicker, 'Готово');
});

test('the route map is drawn from the centre, named after the centre', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(app, /map-label[^>]*>Рябиновая</, 'точка отправления — это сам центр, а не безымянное «депо»');
  assert.doesNotMatch(app, />Депо</);
});

test('the docked terminal calls for attention only while an untouched task sits on it', () => {
  /* Прибор стоит в ряду кнопок и ничего не рассказывает, поэтому анимация —
     единственное, что зовёт его открыть. Звать она обязана ровно тогда,
     когда нажатие что-то меняет. */
  const { LEVELS } = require('../levels.js');
  const inboundLevel = LEVELS.find((level) => level.newMechanic === 'inbound-receive').id;
  let state = reduceAction(startLevel(inboundLevel), { type: 'CONTINUE_STORY' });
  assert.equal(terminalViewFor(state).screen, 'inbound');
  // Открытый терминал уже перед глазами — звать его незачем.
  assert.equal(terminalViewFor(state).attention, false);

  const closed = reduceAction(state, { type: 'CLOSE_TSD' });
  assert.equal(terminalViewFor(closed).open, false);
  assert.equal(terminalViewFor(closed).attention, true, 'паллету у ворот надо принять на ТСД');

  // Принята: дальше нажимают зону на схеме склада, а не прибор.
  state = reduceAction(state, { type: 'RECEIVE_PALLET' });
  assert.equal(terminalViewFor(state).awaitingPlacement, true);
  assert.equal(terminalViewFor(state).attention, false, 'на размещении зовёт схема, а не терминал');

  state = reduceAction(state, { type: 'PLACE_PALLET', zone: 'dry' });
  state = reduceAction(state, { type: 'DISMISS_FEEDBACK' });
  const open = terminalViewFor({ ...state, tsd: { ...state.tsd, open: true } });
  assert.equal(open.attention, false, 'открытый терминал звать себя не может');
});

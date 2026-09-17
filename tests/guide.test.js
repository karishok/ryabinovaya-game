const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const levels = require('../levels.js');
const appState = require('../app-state.js');
const { reduceAction, startLevel, tick } = require('../app-state.js');

function renderModalVisibility(state) {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        classList: {
          toggle(name, force) {
            if (force) classes.add(name);
            else classes.delete(name);
          },
          contains: (name) => classes.has(name),
        },
        setAttribute() {},
        dataset: {},
        style: { setProperty() {} },
        textContent: '',
        innerHTML: '',
        disabled: false,
      });
    }
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
    RyabinovayaLevels: levels,
    RyabinovayaAppState: appState,
    RyabinovayaSceneView: require('../scene-view.js'),
    RyabinovayaTsdView: require('../tsd-view.js'),
    setTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  window.render(state, document);
  return {
    guideOpen: elementFor('guideModal').classList.contains('open'),
    briefingOpen: elementFor('levelBriefing').classList.contains('open'),
  };
}

test('guide pauses a running shift while open and restores its previous timer state', () => {
  let state = reduceAction(startLevel(2), { type: 'CONTINUE_STORY' });
  const opened = reduceAction(state, { type: 'OPEN_GUIDE' });

  assert.equal(opened.guideOpen, true);
  assert.equal(opened.paused, true);
  assert.equal(opened.levelId, state.levelId);
  assert.equal(opened.secondsRemaining, state.secondsRemaining);
  assert.deepEqual(opened.orders, state.orders);
  assert.equal(tick(opened, 10).secondsRemaining, opened.secondsRemaining);

  const closed = reduceAction(opened, { type: 'CLOSE_GUIDE' });
  assert.equal(closed.guideOpen, false);
  assert.equal(closed.paused, false);

  state = { ...state, paused: true };
  assert.equal(reduceAction(reduceAction(state, { type: 'OPEN_GUIDE' }), { type: 'CLOSE_GUIDE' }).paused, true);
});

test('guide can open from the level briefing and return without skipping it', () => {
  const state = startLevel(2);
  const opened = reduceAction(state, { type: 'OPEN_GUIDE' });
  const closed = reduceAction(opened, { type: 'CLOSE_GUIDE' });

  assert.equal(opened.phase, 'briefing');
  assert.equal(opened.guideOpen, true);
  assert.equal(closed.phase, 'briefing');
  assert.equal(closed.guideOpen, false);
});

test('opening the guide keeps the legacy briefing overlay hidden', () => {
  const state = reduceAction(startLevel(2), { type: 'OPEN_GUIDE' });
  assert.deepEqual(renderModalVisibility(state), { guideOpen: true, briefingOpen: false });
  assert.deepEqual(renderModalVisibility(reduceAction(state, { type: 'CLOSE_GUIDE' })), { guideOpen: false, briefingOpen: false });
});

test('game shell provides a reachable, accessible guide with the core shift steps', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Как играть?', 'Поставить в отгрузку', 'Построить маршрут', 'Завершить смену']) {
    assert.ok(html.includes(label), `guide should explain: ${label}`);
  }
  assert.match(html, /data-action="OPEN_GUIDE"/);
  assert.match(html, /data-action="CLOSE_GUIDE"/);
  assert.ok((html.match(/data-action="OPEN_GUIDE"/g) || []).length >= 2);
  assert.match(html, /id="guideModal"[\s\S]*?<section[^>]*role="dialog"/);
  assert.match(html, /id="guideOrders"/);
});

test('static page requests fresh guide assets so an open game picks up the update', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const asset of ['styles.css?v=guide', 'app-state.js?v=guide', 'app.js?v=guide-2']) {
    assert.ok(html.includes(asset), `browser should reload ${asset}`);
  }
});

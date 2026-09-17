const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const appState = require('../app-state.js');
const sceneView = require('../scene-view.js');
const tsdView = require('../tsd-view.js');
const levels = require('../levels.js');

function loadUiWithClicks() {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', disabled: false, hidden: false,
      dataset: {}, attributes: {}, focused: false,
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      classList: { values: new Set(), toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      focus() { this.focused = true; },
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
  const window = {
    RyabinovayaEngine: engine,
    RyabinovayaLevels: levels,
    RyabinovayaAppState: appState,
    RyabinovayaSceneView: sceneView,
    RyabinovayaTsdView: tsdView,
    setTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });

  return {
    window,
    document,
    elements,
    click(target) {
      clickHandler({ target: { closest: () => target } });
    },
  };
}

test('closed TSD leaves pallet and truck actions reachable', () => {
  const { click, elements } = loadUiWithClicks();

  click({ dataset: { action: 'OPEN_BUILDER' }, disabled: false });
  assert.equal(elements.get('builderModal').attributes['aria-hidden'], 'false');

  click({ dataset: { action: 'CLOSE_BUILDER' }, disabled: false });
  click({ dataset: { action: 'OPEN_VEHICLES' }, disabled: false });
  assert.equal(elements.get('vehicleModal').attributes['aria-hidden'], 'false');
});

test('TSD accept action closes the terminal and leaves the warehouse active', () => {
  const { click, elements } = loadUiWithClicks();

  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });

  assert.equal(elements.get('tsdDevice').dataset.open, 'false');
  assert.equal(elements.get('warehouseScene').attributes['aria-hidden'], 'false');
});

test('TSD owns briefing and report presentation while legacy dialogs stay hidden', () => {
  const { window, document, elements } = loadUiWithClicks();
  assert.equal(elements.get('tsdDevice').dataset.screen, 'briefing');
  assert.equal(elements.get('levelBriefing').hidden, true);
  assert.equal(elements.get('levelBriefing').attributes['aria-hidden'], 'true');

  const shift = appState.reduceAction(appState.startLevel(1), { type: 'CONTINUE_STORY' });
  const report = appState.reduceAction(shift, { type: 'END_SHIFT' });
  window.render(report, document);

  assert.equal(elements.get('tsdDevice').dataset.screen, 'report');
  assert.equal(elements.get('reportModal').hidden, true);
  assert.equal(elements.get('reportModal').attributes['aria-hidden'], 'true');
});

test('closing a reopened TSD restores focus to its warehouse opener', () => {
  const { click } = loadUiWithClicks();
  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });

  const opener = {
    dataset: { action: 'OPEN_TSD' }, disabled: false, focused: false,
    focus() { this.focused = true; },
  };
  click(opener);
  click({ dataset: { action: 'CLOSE_TSD' }, disabled: false });

  assert.equal(opener.focused, true);
});

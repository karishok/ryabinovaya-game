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
  let errorHandler;
  const document = {
    getElementById: elementFor,
    querySelector: () => elementFor('pause'),
    querySelectorAll(selector) { return selector === '[data-scene-zone]' ? zones : []; },
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
      if (type === 'error') errorHandler = handler;
    },
    dispatchEvent(event) {
      if (event.type === 'error') return errorHandler(event);
      clickHandler({ target: { closest: () => event.target } });
    },
  };
  const window = {
    RyabinovayaEngine: engine,
    RyabinovayaLevels: levels,
    RyabinovayaAppState: appState,
    RyabinovayaSceneView: sceneView,
    RyabinovayaTsdView: tsdView,
    setTimeout() {},
  };
  const pageHtml = fs.readFileSync('index.html', 'utf8');
  const tsdScreenHtml = pageHtml.match(/<div class="tsd-screen"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || '';
  const controlFor = (action, source) => {
    const tag = source.match(new RegExp(`<button\\b[^>]*data-action="${action}"[^>]*>`))?.[0];
    if (!tag) return null;
    const target = {
      dataset: { action }, disabled: false, focused: false,
      focus() { this.focused = true; },
      click() { document.dispatchEvent({ target: this }); },
    };
    return target;
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });

  return {
    window,
    document,
    elements,
    shellControlFor: (action) => controlFor(action, tsdScreenHtml),
    pageControlFor: (action) => controlFor(action, pageHtml),
    click(target) {
      document.dispatchEvent({ target });
    },
    dispatchImageError(image) {
      document.dispatchEvent({ type: 'error', target: image });
    },
  };
}

test('closed TSD leaves pallet and truck actions reachable', () => {
  const { click, elements } = loadUiWithClicks();

  click({ dataset: { action: 'OPEN_BUILDER' }, disabled: false });
  assert.equal(elements.get('tsdDevice').dataset.screen, 'task');
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });
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

test('briefing continues through the visible TSD shell control', () => {
  const { elements, shellControlFor } = loadUiWithClicks();
  const continueButton = shellControlFor('CONTINUE_STORY');

  assert.ok(continueButton, 'briefing must expose CONTINUE_STORY in the TSD shell');
  assert.equal(elements.get('tsdContinueStory').hidden, false);
  continueButton.click();

  assert.equal(elements.get('tsdDevice').dataset.screen, 'task');
  assert.equal(elements.get('tsdAccept').hidden, false);
});

test('report continues through the visible TSD shell control', () => {
  const { elements, shellControlFor, pageControlFor } = loadUiWithClicks();
  const endShiftButton = pageControlFor('END_SHIFT');
  assert.ok(endShiftButton, 'test shell must expose the established END_SHIFT control');
  endShiftButton.click();

  const continueButton = shellControlFor('SHOW_STORY_AFTER');
  assert.equal(elements.get('tsdDevice').dataset.screen, 'report');
  assert.ok(elements.get('tsdMessage').textContent.length > 0);
  assert.match(elements.get('tsdReportSummary').textContent, /Доставлено:/);
  assert.ok(continueButton, 'report must expose SHOW_STORY_AFTER in the TSD shell');
  assert.equal(elements.get('tsdContinue').hidden, false);
  continueButton.click();

  assert.equal(elements.get('tsdDevice').dataset.screen, 'briefing');
});

test('successful load feedback can be dismissed before the next warehouse interaction', () => {
  const { click, elements, pageControlFor } = loadUiWithClicks();

  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });
  click({ dataset: { action: 'ADD_ITEM', sku: 'water', zone: 'dry', weight: '12', quantity: '2' }, disabled: false });
  click({ dataset: { action: 'LOAD_PALLET' }, disabled: false });

  assert.equal(elements.get('tsdDevice').dataset.screen, 'feedback');
  assert.equal(elements.get('tsdFeedbackContinue').hidden, false);

  const dismiss = pageControlFor('DISMISS_FEEDBACK');
  assert.ok(dismiss, 'successful load feedback must expose DISMISS_FEEDBACK');
  dismiss.click();

  assert.equal(elements.get('tsdDevice').dataset.open, 'false');
  assert.equal(elements.get('tsdDevice').dataset.screen, 'current');
  click({ dataset: { action: 'OPEN_VEHICLES' }, disabled: false });
  assert.equal(elements.get('vehicleModal').attributes['aria-hidden'], 'false');
});

test('TSD owns briefing and report presentation while legacy dialogs stay hidden', () => {
  const { window, document, elements } = loadUiWithClicks();
  assert.equal(elements.get('tsdDevice').dataset.screen, 'briefing');
  assert.equal(elements.get('levelBriefing').hidden, false);
  assert.equal(elements.get('levelBriefing').attributes['aria-hidden'], 'false');

  const shift = appState.reduceAction(appState.startLevel(1), { type: 'CONTINUE_STORY' });
  const report = appState.reduceAction(shift, { type: 'END_SHIFT' });
  window.render(report, document);

  assert.equal(elements.get('tsdDevice').dataset.screen, 'report');
  assert.equal(elements.get('reportModal').hidden, false);
  assert.equal(elements.get('reportModal').attributes['aria-hidden'], 'false');
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

test('scene object image errors reveal a fallback without changing the button action', () => {
  const { dispatchImageError } = loadUiWithClicks();
  const fallback = { hidden: true };
  const button = {
    dataset: { action: 'OPEN_BUILDER' },
    querySelector(selector) {
      return selector === '.scene-object-fallback' ? fallback : null;
    },
  };
  const image = {
    hidden: false,
    tagName: 'IMG',
    closest(selector) {
      return selector === '.scene-object' ? button : null;
    },
  };

  dispatchImageError(image);

  assert.equal(image.hidden, true);
  assert.equal(fallback.hidden, false);
  assert.equal(button.dataset.action, 'OPEN_BUILDER');
});

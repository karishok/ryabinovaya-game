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

function loadUiWithClicks(options = {}) {
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
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    },
    dispatchEvent(event) {
      clickHandler({ target: { closest: () => event.target } });
    },
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
  if (options.AudioContext) window.AudioContext = options.AudioContext;
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
  };
}

test('tapping the pallet opens the builder instead of detouring through the task card', () => {
  const { click, elements } = loadUiWithClicks();

  // Раньше первое нажатие уводило на экран задания, и «Принять» приходилось
  // жать только чтобы вернуться туда, куда игрок и нажимал.
  click({ dataset: { action: 'OPEN_BUILDER' }, disabled: false });
  assert.equal(elements.get('tsdDevice').dataset.screen, 'builder');
  assert.equal(elements.get('builderModal').attributes['aria-hidden'], 'false');
  // Задание видно там, где собирают, а не на отдельном экране.
  assert.match(elements.get('builderTask').textContent, /Северный/);

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

test('a successful load reports through the toast and never takes over the terminal', () => {
  const { click, elements } = loadUiWithClicks();

  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });
  click({ dataset: { action: 'ADD_ITEM', sku: 'water', zone: 'dry', weight: '12', quantity: '2' }, disabled: false });
  click({ dataset: { action: 'LOAD_PALLET' }, disabled: false });

  /* Успех не забирает экран: раньше каждая собранная паллета открывала
     полноэкранное сообщение с обязательным «Продолжить». */
  assert.equal(elements.get('tsdDevice').dataset.open, 'false');
  assert.notEqual(elements.get('tsdDevice').dataset.screen, 'feedback');
  assert.match(elements.get('toast').textContent, /в кузове/i);
  assert.match(elements.get('toast').className, /show success/);

  click({ dataset: { action: 'OPEN_VEHICLES' }, disabled: false });
  assert.equal(elements.get('vehicleModal').attributes['aria-hidden'], 'false');
});

test('an error still takes over the terminal, because it has to be read and fixed', () => {
  const { click, elements } = loadUiWithClicks();

  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weight: '10', quantity: '1' }, disabled: false });

  assert.equal(elements.get('tsdDevice').dataset.screen, 'feedback');
  assert.equal(elements.get('tsdBackdrop').attributes['aria-hidden'], 'false');
  assert.equal(elements.get('tsdFeedbackContinue').hidden, false);
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

test('scene hotspots need no image fallback because they draw no image', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const palletButton = html.slice(html.indexOf('id="scenePallet"'));
  const truckButton = html.slice(html.indexOf('id="sceneTruckBay"'));
  // Хотспоты — пустые прозрачные области поверх фотографии. Картинок внутри
  // них нет, поэтому и ломаться нечему: подстраховка на onerror не нужна.
  assert.doesNotMatch(palletButton.slice(0, palletButton.indexOf('</button>')), /<img/);
  assert.doesNotMatch(truckButton.slice(0, truckButton.indexOf('</button>')), /<img/);
  assert.doesNotMatch(html, /scene-object-fallback/);
});

test('a rejected AudioContext resume promise is handled silently', () => {
  const tracker = { catches: 0 };
  function AudioContext() {
    this.currentTime = 0;
    this.destination = {};
    this.resume = () => ({
      catch(handler) {
        tracker.catches += 1;
        handler(new Error('autoplay blocked'));
      },
    });
    this.createOscillator = () => ({
      frequency: { value: 0 },
      connect() {},
      start() {},
      stop() {},
    });
    this.createGain = () => ({
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    });
  }
  const { click } = loadUiWithClicks({ AudioContext });
  click({ dataset: { action: 'CONTINUE_STORY' }, disabled: false });
  click({ dataset: { action: 'ACCEPT_TASK' }, disabled: false });
  click({ dataset: { action: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weight: '10', quantity: '1' }, disabled: false });
  assert.equal(tracker.catches, 1);
});

test('the close button only appears on screens the player can actually leave', () => {
  const { elements, window, document } = loadUiWithClicks();
  // Брифинг держит терминал открытым принудительно: крестик там не сработал бы.
  assert.equal(elements.get('tsdClose').hidden, true);

  const task = appState.reduceAction(appState.startLevel(1), { type: 'CONTINUE_STORY' });
  window.render(task, document);
  assert.equal(elements.get('tsdClose').hidden, false);

  const report = appState.reduceAction(task, { type: 'END_SHIFT' });
  window.render(report, document);
  assert.equal(elements.get('tsdClose').hidden, true);
});

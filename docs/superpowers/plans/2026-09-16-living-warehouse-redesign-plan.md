# Living Warehouse Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить главный мобильный экран «Рябиновой» в живую сцену высотного распределительного центра, сохранив без изменений существующие игровые правила и команды.

**Architecture:** Игровые правила остаются в `game-engine.js`, `app-state.js` и `levels.js`. Новый чистый модуль `scene-view.js` преобразует текущее состояние в визуальную модель склада, а `app.js` только переносит эту модель в семантические HTML/CSS-слои поверх оптимизированной фоновой иллюстрации. Такое разделение позволяет отдельно тестировать визуальные состояния без браузера и не смешивать анимации с расчётом игры.

**Tech Stack:** Vanilla HTML, CSS и JavaScript; UMD/CommonJS для тестируемых модулей; встроенный Node.js test runner (`node --test`); WebP-фон; без сборщика и внешних runtime-зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-16-living-warehouse-redesign-design.md`

## Global Constraints

- Редизайн не меняет игровую логику, формулы прибыли и звёзд, восемь уровней, типы товаров, зон, машин или событий.
- Главный экран показывает живой высотный склад, автоматические тележки, паллеты, сотрудников, сигнальные огни и машины у ворот.
- Сцена занимает примерно 70–75% высоты мобильного экрана; поверх неё остаются только название уровня, компактный таймер, одна текущая заявка, индикатор паллеты и одна крупная кнопка следующего действия.
- Зональные акценты: янтарный для «Сухача», приглушённый бирюзовый для «Охлаждёнки», холодный синий для «Заморозки».
- Не использовать фиолетовый неон, универсальные банковские карточки, большие пустые панели, эмодзи как финальные иллюстрации и детскую игрушечную стилизацию.
- Существующие команды сохраняются: `SELECT_ZONE`, `SELECT_STORE`, `ADD_ITEM`, `LOAD_PALLET`, `SET_ROUTE`, `PAUSE` и `END_SHIFT`.
- Анимации только отражают состояние и не создают новые ресурсы, ограничения, время выполнения или условия успеха.
- При `prefers-reduced-motion: reduce` движение заменяется мгновенной сменой состояний.
- Область нажатия каждого интерактивного элемента — не менее 44 пикселей.
- На ширине 390 пикселей не должно быть горизонтальной прокрутки.
- Каждый task заканчивается сфокусированными тестами, полным прогоном, отдельным коммитом и `git push origin main`.

## File Map

- `assets/warehouse-center.webp` — чистая оптимизированная иллюстрация склада без нарисованных поверх неё элементов интерфейса.
- `scene-view.js` — чистое преобразование игрового состояния в визуальное состояние сцены; не обращается к DOM и не изменяет state.
- `index.html` — семантический мобильный shell сцены, рабочие слои и существующие панели/модальные окна.
- `app.js` — связывает `scene-view.js` с DOM и продолжает отправлять существующие команды в `app-state.js`.
- `styles.css` — индустриальная палитра, композиция сцены, адаптивность и анимации.
- `tests/scene-view.test.js` — состояния зоны, паллеты, тележки, маршрута и ошибок.
- `tests/scene-render.test.js` — соответствие DOM-классов и текста чистой визуальной модели.
- `tests/static-ui.test.js` — контракт разметки, ассета, мобильных ограничений и reduced motion.
- `tests/live-kpis.test.js` — существующий DOM-stub, дополненный свойствами новых элементов.
- `tests/ui-command-contract.test.js` — защита набора команд и основных мобильных действий от случайного переименования.
- `docs/screenshots/living-warehouse-mobile.png` — финальный контрольный скриншот шириной 390 пикселей.
- `README.md` — краткое описание визуальной архитектуры и ссылка на контрольный скриншот.

---

### Task 1: Подготовить чистый фон и семантический каркас склада

**Files:**
- Create: `assets/warehouse-center.webp`
- Modify: `index.html:10-48`
- Modify: `tests/static-ui.test.js`

**Interfaces:**
- `index.html` produces stable DOM IDs `warehouseScene`, `sceneStatus`, `sceneOperator`, `sceneOperatorName`, `sceneAgv`, `scenePallet`, `scenePalletFill`, `sceneTruckBay` and zone elements with `data-scene-zone`.
- `app.js` will consume these IDs in Task 3.
- `styles.css` will consume `.warehouse-scene`, `.scene-backdrop`, `.scene-zone`, `.agv`, `.scene-pallet`, `.truck-bay` and `.mission-dock` in Task 4.

- [ ] **Step 1: Extend the static test so the new shell and optimized asset are required**

Replace `tests/static-ui.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('living warehouse shell keeps product vocabulary and scene layers', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Рябиновая', 'Сухач', 'Заморозка', 'Охлаждёнка', 'Собрать паллету', 'reportModal']) {
    assert.match(html, new RegExp(label));
  }
  for (const id of ['warehouseScene', 'sceneStatus', 'sceneOperator', 'sceneOperatorName', 'sceneAgv', 'scenePallet', 'scenePalletFill', 'sceneTruckBay']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const zone of ['dry', 'chilled', 'frozen']) {
    assert.match(html, new RegExp(`data-scene-zone="${zone}"`));
  }
  assert.match(html, /assets\/warehouse-center\.webp/);
});

test('warehouse backdrop is an optimized mobile asset', () => {
  const asset = 'assets/warehouse-center.webp';
  assert.equal(fs.existsSync(asset), true);
  assert.ok(fs.statSync(asset).size < 900_000, 'warehouse backdrop must stay below 900 KB');
});
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run: `node --test tests/static-ui.test.js`

Expected: FAIL because `warehouseScene` and `assets/warehouse-center.webp` do not exist.

- [ ] **Step 3: Create a UI-free environmental background from the approved concept**

Read and follow the `imagegen` skill before editing the reference. Use `docs/superpowers/specs/2026-09-16-living-warehouse-concept.png` as the referenced image and this exact edit brief:

```text
Create a clean 9:16 environmental background for the same mobile warehouse game. Preserve the approved identity: a vast high-bay distribution center named “Рябиновая”, towering dry/chilled/frozen racks with amber, muted teal, and cold blue practical lighting, autonomous pallet carts, workers, floor routes, loading gates, and trucks. Remove every overlaid game UI element from the reference: the order card, timer pill, bottom control panel, progress indicators, icons, and button. Keep the center and lower-middle floor readable enough for HTML overlays and a moving AGV. Keep the scene warm, busy, industrial, and believable rather than toy-like or neon. No new floating text, no dashboard panels, no phone frame.
```

Save a working copy of the generated PNG as `/private/tmp/ryabinovaya-clean-warehouse.png`, inspect it visually, then create the runtime asset:

```bash
mkdir -p assets
cwebp -quiet -q 78 -resize 780 0 /private/tmp/ryabinovaya-clean-warehouse.png -o assets/warehouse-center.webp
file assets/warehouse-center.webp
stat -f '%z bytes' assets/warehouse-center.webp
```

Expected: a portrait WebP, 780 pixels wide, under 900 KB, with no baked-in order card, timer or CTA.

- [ ] **Step 4: Replace the old map card with the scene shell**

In `index.html`, remove the current standalone `.topbar` and `.metrics` blocks, then replace the old warehouse map and mission card with the following hierarchy while keeping the existing `OPEN_BUILDER` and `OPEN_VEHICLES` action names:

```html
<section class="screen active" data-screen="warehouse">
  <section class="warehouse-scene" id="warehouseScene" data-mode="idle" data-active-zone="dry" aria-label="Распределительный центр Рябиновая">
    <img class="scene-backdrop" src="assets/warehouse-center.webp" alt="" aria-hidden="true" />
    <div class="scene-shade" aria-hidden="true"></div>

    <div class="scene-hud">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">●</span><span><strong>Рябиновая</strong><small id="levelTitle">Уровень 1 · Один заказ</small></span></div>
      <div class="shift"><div class="clock" id="clock">03:00</div><button class="pause" data-action="PAUSE" aria-label="Пауза">Ⅱ</button></div>
    </div>

    <button class="scene-zone scene-zone--dry" data-action="SELECT_ZONE" data-zone="dry" data-scene-zone="dry"><span>Сухач</span></button>
    <button class="scene-zone scene-zone--chilled" data-action="SELECT_ZONE" data-zone="chilled" data-scene-zone="chilled"><span>Охлаждёнка</span></button>
    <button class="scene-zone scene-zone--frozen" data-action="SELECT_ZONE" data-zone="frozen" data-scene-zone="frozen"><span>Заморозка</span></button>

    <div class="scene-route" aria-hidden="true"></div>
    <div class="agv" id="sceneAgv" aria-hidden="true"><span class="agv-light"></span></div>
    <div class="scene-pallet" id="scenePallet" aria-label="Текущая паллета"><span class="pallet-load"></span></div>
    <div class="truck-bay" id="sceneTruckBay" aria-hidden="true"><span class="truck-light"></span></div>

    <div class="operator-callout" id="sceneOperator"><strong id="sceneOperatorName">Лера</strong><span id="sceneStatus">Выберите заявку и начните сборку.</span></div>

    <section class="mission-dock" aria-labelledby="missionTitle">
      <div class="mission-copy"><small id="missionHint">Текущая заявка</small><strong id="missionTitle">Северный ждёт заказ</strong><span id="missionOrder">Вода · 2 шт.</span></div>
      <button class="vehicle-chip" data-action="OPEN_VEHICLES" id="vehicleName">Сухой фургон</button>
      <div class="pallet-meter"><span>Паллета</span><b id="capacityCompact">0 / 100 кг</b><i><span id="scenePalletFill"></span></i></div>
      <button class="btn primary-cta" data-action="OPEN_BUILDER">Собрать паллету</button>
    </section>
  </section>
</section>
```

Keep the `orders`, `ontime`, `utilization` and `mapPallets` nodes in compact rows inside the existing `orders` or `transport` screens so `app.js` and KPI tests retain their current targets.

- [ ] **Step 5: Run shell tests and the full regression suite**

Run: `node --test tests/static-ui.test.js tests/smoke.test.js`

Expected: PASS.

Run: `node --test tests/*.test.js`

Expected: all existing tests PASS; no gameplay source file changes are required.

- [ ] **Step 6: Commit and push the scene shell**

```bash
git add assets/warehouse-center.webp index.html tests/static-ui.test.js
git commit -m "feat: add living warehouse scene shell"
git push origin main
```

### Task 2: Добавить чистую модель визуального состояния сцены

**Files:**
- Create: `scene-view.js`
- Create: `tests/scene-view.test.js`
- Modify: `index.html` — load `scene-view.js` before `app.js`.

**Interfaces:**
- Produces `warehouseViewFor(state)` through CommonJS and `window.RyabinovayaSceneView`.
- Returns `{ activeZone, selectedZone, selectedVehicleZone, mode, palletFillPercent, loadedPalletCount, routeReady, eventCode, statusText, operatorName }`.
- `mode` is one of `idle`, `collecting`, `to-dispatch`, `awaiting-route`, `route-ready`, `spoiled`, `blocked`.
- Consumes only existing state properties and never calls the reducer or mutates its input.

- [ ] **Step 1: Write failing tests for all visually meaningful states**

Create `tests/scene-view.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { warehouseViewFor } = require('../scene-view.js');
const { startLevel, reduceAction } = require('../app-state.js');

test('initial shift points the warehouse at the active order zone', () => {
  const view = warehouseViewFor(startLevel(1));
  assert.equal(view.activeZone, 'dry');
  assert.equal(view.selectedZone, 'dry');
  assert.equal(view.mode, 'idle');
});

test('items on the current pallet turn the scene into collecting mode', () => {
  const state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'collecting');
  assert.equal(view.palletFillPercent, 24);
});

test('successful loading sends the AGV toward dispatch', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'to-dispatch');
  assert.equal(view.loadedPalletCount, 1);
});

test('loaded vehicle without a built route waits at the gate', () => {
  let state = reduceAction(startLevel(1), { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = { ...state, feedback: null };
  assert.equal(warehouseViewFor(state).mode, 'awaiting-route');
});

test('wrong-zone loading stops the AGV and names the spoilage', () => {
  let state = startLevel(4);
  state = reduceAction(state, { type: 'SELECT_ZONE', zone: 'chilled' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  const view = warehouseViewFor(state);
  assert.equal(view.mode, 'spoiled');
  assert.match(view.statusText, /испорчена/i);
});

test('over-capacity feedback maps to a blocked visual state', () => {
  const state = { ...startLevel(1), feedback: { kind: 'error', code: 'over-capacity', message: 'В машине не осталось места.' } };
  assert.equal(warehouseViewFor(state).mode, 'blocked');
});

test('demand changes request a short pulse on the active zone', () => {
  const state = { ...startLevel(1), feedback: { kind: 'info', code: 'demand-increase', message: 'Заявка выросла.' } };
  assert.equal(warehouseViewFor(state).eventCode, 'demand-increase');
});
```

- [ ] **Step 2: Run the focused tests and verify import failure**

Run: `node --test tests/scene-view.test.js`

Expected: FAIL with `Cannot find module '../scene-view.js'`.

- [ ] **Step 3: Implement the immutable visual mapper**

Create `scene-view.js` with the browser-safe wrapper already used by the project and the following core logic:

```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaSceneView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => !(state.loadedPallets || []).some((pallet) => pallet.storeId === order.storeId)) || active[0] || null;
  };

  function warehouseViewFor(state) {
    const order = activeOrderFor(state);
    const selectedVehicle = (state.vehicles || []).find((vehicle) => vehicle.id === state.selectedVehicleId) || state.vehicles?.[0] || null;
    const route = state.routesByVehicle?.[selectedVehicle?.id] || null;
    const hasLoadedVehicle = Boolean(selectedVehicle?.pallets?.length);
    const routeReady = Boolean(route?.stops?.length);
    const code = state.feedback?.code;
    let mode = 'idle';

    if (code === 'wrong-zone') mode = 'spoiled';
    else if (code === 'over-capacity') mode = 'blocked';
    else if (code === 'pallet-loaded') mode = 'to-dispatch';
    else if (hasLoadedVehicle && !routeReady) mode = 'awaiting-route';
    else if (routeReady) mode = 'route-ready';
    else if ((state.pallet?.weight || 0) > 0) mode = 'collecting';

    const statusByMode = {
      idle: order ? `Зона ${order.zone}: можно начинать сборку.` : 'Все заявки собраны. Проверьте транспорт.',
      collecting: 'Тележка готовит текущую паллету.',
      'to-dispatch': state.feedback?.message || 'Тележка везёт паллету к воротам.',
      'awaiting-route': 'Машина загружена и ждёт маршрут.',
      'route-ready': 'Маршрут построен, машина готова к отправке.',
      spoiled: state.feedback?.message || 'Паллета испорчена из-за неверной зоны.',
      blocked: state.feedback?.message || 'Не хватает свободного места.',
    };

    return {
      activeZone: order?.zone || state.pallet?.zone || 'dry',
      selectedZone: state.pallet?.zone || 'dry',
      selectedVehicleZone: selectedVehicle?.zone || null,
      mode,
      palletFillPercent: Math.min(100, Math.round(((state.pallet?.weight || 0) / (state.pallet?.capacity || 100)) * 100)),
      loadedPalletCount: (state.loadedPallets || []).length,
      routeReady,
      eventCode: ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(code) ? code : '',
      statusText: statusByMode[mode],
      operatorName: ['spoiled', 'blocked'].includes(mode) ? 'Лера' : 'Миша',
    };
  }

  return { warehouseViewFor };
});
```

Use only `routesByVehicle[selectedVehicle.id]` for `routeReady`; do not alter the route state shape to support the visual layer.

- [ ] **Step 4: Load the module before the DOM adapter**

Add this line between `app-state.js` and `app.js` in `index.html`:

```html
<script src="scene-view.js"></script>
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/scene-view.test.js`

Expected: 7 tests PASS.

Run: `node --test tests/*.test.js`

Expected: all tests PASS, including unchanged game-engine, app-state and level tests.

- [ ] **Step 6: Commit and push the visual model**

```bash
git add scene-view.js index.html tests/scene-view.test.js
git commit -m "feat: derive warehouse scene from game state"
git push origin main
```

### Task 3: Подключить визуальную модель к текущему состоянию игры

**Files:**
- Modify: `app.js:1-129`
- Create: `tests/scene-render.test.js`
- Modify: `tests/live-kpis.test.js:9-22`

**Interfaces:**
- `app.js` consumes `window.RyabinovayaSceneView.warehouseViewFor(state)`.
- Produces `renderScene(view, document)` and exposes it as `window.renderScene` for browser-independent tests.
- Writes only text, classes, `data-mode`, `data-active-zone`, `data-event`, `aria-current`, element `disabled` state and CSS variable `--pallet-fill`.
- Does not dispatch actions and does not calculate compatibility, score, capacity or routes.

- [ ] **Step 1: Write a failing DOM adapter test**

Create `tests/scene-render.test.js` with a minimal document double:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../game-engine.js');
const appState = require('../app-state.js');
const sceneView = require('../scene-view.js');
const { LEVELS } = require('../levels.js');

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
  const window = { RyabinovayaEngine: engine, RyabinovayaLevels: { LEVELS }, RyabinovayaAppState: appState, RyabinovayaSceneView: sceneView, setTimeout() {} };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  return { window, elements, zones };
}

test('renderScene publishes movement, active zone and compact pallet status', () => {
  const { window, elements, zones } = loadUi();
  window.renderScene({ activeZone: 'chilled', selectedZone: 'chilled', selectedVehicleZone: 'chilled', mode: 'to-dispatch', palletFillPercent: 42, loadedPalletCount: 2, routeReady: false, eventCode: '', statusText: 'Тележка едет.', operatorName: 'Миша' }, {
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => zones,
  });
  assert.equal(elements.get('warehouseScene').dataset.mode, 'to-dispatch');
  assert.equal(elements.get('warehouseScene').dataset.activeZone, 'chilled');
  assert.equal(elements.get('sceneStatus').textContent, 'Тележка едет.');
  assert.equal(elements.get('scenePalletFill').style.values['--pallet-fill'], '42%');
  assert.equal(elements.get('sceneTruckBay').dataset.loadedPallets, '2');
  assert.equal(zones.find((zone) => zone.dataset.sceneZone === 'chilled').attributes['aria-current'], 'true');
});
```

- [ ] **Step 2: Run the adapter test and verify the missing export**

Run: `node --test tests/scene-render.test.js`

Expected: FAIL because `window.renderScene` is not defined.

- [ ] **Step 3: Add the focused scene renderer to `app.js`**

At the top of `app.js`, consume the mapper:

```js
const { warehouseViewFor } = window.RyabinovayaSceneView;
```

Add this function before `render`:

```js
function renderScene(view, document) {
  const scene = byId(document, 'warehouseScene');
  scene.dataset.mode = view.mode;
  scene.dataset.activeZone = view.activeZone;
  scene.dataset.selectedZone = view.selectedZone;
  scene.dataset.vehicleZone = view.selectedVehicleZone || '';
  scene.dataset.event = view.eventCode || '';
  byId(document, 'sceneStatus').textContent = view.statusText;
  byId(document, 'sceneOperatorName').textContent = view.operatorName;
  byId(document, 'scenePalletFill').style.setProperty('--pallet-fill', `${view.palletFillPercent}%`);
  byId(document, 'scenePallet').setAttribute('aria-label', `Текущая паллета заполнена на ${view.palletFillPercent}%`);
  byId(document, 'sceneTruckBay').dataset.routeReady = String(view.routeReady);
  byId(document, 'sceneTruckBay').dataset.loadedPallets = String(view.loadedPalletCount);
  document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
    const active = zone.dataset.sceneZone === view.activeZone;
    const selected = zone.dataset.sceneZone === view.selectedZone;
    zone.classList.toggle('is-active', active);
    zone.classList.toggle('is-selected', selected);
    zone.setAttribute('aria-current', String(active));
  });
}
```

At the start of `render(nextState, document)`, call:

```js
const sceneView = warehouseViewFor(nextState);
renderScene(sceneView, document);
```

Also update `capacityCompact` alongside the existing modal `capacity`, and expose the renderer:

```js
byId(document, 'capacityCompact').textContent = `${nextState.pallet.weight} / ${nextState.pallet.capacity} кг`;
window.renderScene = renderScene;
```

- [ ] **Step 4: Make the existing KPI DOM double understand the new scene accesses**

In `tests/live-kpis.test.js`, extend every synthetic element with:

```js
dataset: {},
attributes: {},
hidden: false,
style: { setProperty() {} },
classList: { toggle() {} },
setAttribute() {},
querySelector() { return null; },
```

Add `RyabinovayaSceneView: require('../scene-view.js')` to its fake `window`.

- [ ] **Step 5: Keep all existing commands and lock states connected to the scene**

Replace the old `.warehouse-map [data-zone]` selector in `render` with `[data-scene-zone]`, then preserve the existing lock expression exactly:

```js
document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
  zone.classList.toggle('locked', !nextState.unlockedZones.includes(zone.dataset.sceneZone));
  zone.disabled = !nextState.unlockedZones.includes(zone.dataset.sceneZone);
});
```

Do not add any new reducer action for animation. The existing successful `LOAD_PALLET` feedback drives `to-dispatch`, and existing error codes drive `spoiled` or `blocked`.

- [ ] **Step 6: Run DOM, KPI and full regression tests**

Run: `node --test tests/scene-render.test.js tests/live-kpis.test.js tests/static-ui.test.js`

Expected: PASS.

Run: `node --test tests/*.test.js`

Expected: all tests PASS; `game-engine.js`, `app-state.js` and `levels.js` remain unchanged.

- [ ] **Step 7: Commit and push the scene binding**

```bash
git add app.js index.html tests/scene-render.test.js tests/live-kpis.test.js
git commit -m "feat: bind warehouse scene to live state"
git push origin main
```

### Task 4: Оформить мобильную сцену, движение и промышленные панели

**Files:**
- Modify: `styles.css`
- Modify: `index.html` — add stable industrial class names to existing orders, transport, builder and report content without changing actions or IDs.
- Modify: `tests/static-ui.test.js`

**Interfaces:**
- CSS consumes scene attributes `data-mode`, `data-active-zone`, `data-selected-zone`, `data-vehicle-zone` and `data-route-ready`.
- Motion uses only `transform` and `opacity` for `.agv`, `.scene-pallet`, `.truck-light`, `.signal-light` and `.operator-callout`.
- All screens continue using the same IDs and `data-action` values expected by `app.js`.

- [ ] **Step 1: Add failing static checks for mobile composition and accessible motion**

Append to `tests/static-ui.test.js`:

```js
test('warehouse styles define the mobile scene and reduced-motion fallback', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(css, /--industrial-green:/);
  assert.match(css, /\.warehouse-scene\s*\{/);
  assert.match(css, /height:\s*clamp\([^;]*72svh/);
  assert.match(css, /\[data-mode="to-dispatch"\]/);
  assert.match(css, /\[data-mode="spoiled"\]/);
  assert.match(css, /@media\s*\(max-width:\s*390px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /overflow-x:\s*hidden/);
});
```

- [ ] **Step 2: Run the static test and verify the visual tokens are absent**

Run: `node --test tests/static-ui.test.js`

Expected: FAIL on `--industrial-green` or `.warehouse-scene`.

- [ ] **Step 3: Replace the generic dashboard palette with the approved industrial system**

Define these root tokens at the start of `styles.css` and use them throughout the file:

```css
:root {
  --cream: #f4ead8;
  --ink: #17231f;
  --industrial-green: #183d34;
  --industrial-green-2: #24564a;
  --terracotta: #d96343;
  --amber: #f0aa38;
  --chilled: #51b9ad;
  --frozen: #5c9fe8;
  --danger: #d94a3f;
  --panel: rgba(20, 31, 27, 0.92);
  --line: rgba(244, 234, 216, 0.18);
  --shadow: 0 18px 48px rgba(8, 18, 15, 0.34);
}
```

Set `body { overflow-x: hidden; }`, retain `.app { width: min(430px, 100%); }`, remove the purple radial gradients, and use warm concrete/green surfaces for secondary screens and panels.

- [ ] **Step 4: Build the 70–75% viewport warehouse composition**

Use the following dimensional contract and layer order:

```css
.warehouse-scene {
  position: relative;
  height: clamp(520px, 72svh, 700px);
  min-height: 520px;
  overflow: hidden;
  border-radius: 0 0 28px 28px;
  background: var(--ink);
  box-shadow: var(--shadow);
  isolation: isolate;
}
.scene-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -4; }
.scene-shade { position: absolute; inset: 0; z-index: -3; background: linear-gradient(180deg, rgba(11,20,17,.48) 0%, transparent 28%, transparent 58%, rgba(11,20,17,.78) 100%); pointer-events: none; }
.scene-hud { position: absolute; inset: max(12px, env(safe-area-inset-top)) 12px auto; display: flex; justify-content: space-between; gap: 10px; }
.mission-dock { position: absolute; right: 12px; bottom: 12px; left: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 22px; background: var(--panel); backdrop-filter: blur(16px); }
.primary-cta { width: 100%; min-height: 54px; border-radius: 16px; background: var(--terracotta); color: white; font-weight: 800; }
```

Position the zone beacons over their matching racks, keep them at least 44×44 pixels, and distinguish active versus selected state through border/light treatment rather than new text panels.

- [ ] **Step 5: Add lightweight state animations and scene reactions**

Implement CSS states with transform/opacity only:

```css
.agv { transition: transform 720ms cubic-bezier(.22,.8,.24,1), opacity 180ms ease; }
[data-mode="collecting"] .agv { transform: translate3d(38px, -52px, 0); }
[data-mode="to-dispatch"] .agv { transform: translate3d(205px, 34px, 0); }
[data-mode="awaiting-route"] .truck-light { opacity: 1; animation: signal-wait 1.2s ease-in-out infinite; }
[data-mode="route-ready"] .truck-light { opacity: 1; background: #66e09d; }
[data-mode="route-ready"] .scene-route { opacity: 1; }
[data-event="demand-increase"] .scene-zone.is-active { animation: zone-pulse .7s ease-in-out 2; }
[data-mode="spoiled"] .scene-pallet { filter: saturate(.55); box-shadow: 0 0 0 3px var(--danger), 0 0 24px rgba(217,74,63,.72); }
[data-mode="spoiled"] .agv { transform: translate3d(72px, -24px, 0); }
[data-mode="blocked"] .mission-dock { box-shadow: 0 0 0 2px var(--amber), var(--shadow); }
```

Add restrained idle movement for one background light and one cart only; do not animate the background image itself.

- [ ] **Step 6: Restyle all secondary surfaces without changing behavior**

Apply the same typography, green/cream palette, 44-pixel tap targets and industrial linework to:

```text
orders screen: compact manifest rows
transport screen: loading-gate rows and route sequence
builder modal: bottom sheet with store, zone, item and capacity controls
vehicle modal: bottom sheet with vehicle readiness and route order
report modal: shift board with stars, delivery, timing, utilization, spoilage and profit
story cards: dispatcher briefing sheets
```

Keep every existing ID and `data-action` value. Replace visible emoji decoration with CSS shapes or short text labels; product emoji in generated item rows may remain until product art exists because removing them would reduce item recognition.

- [ ] **Step 7: Add the 390-pixel and reduced-motion rules**

Use explicit fallbacks:

```css
@media (max-width: 390px) {
  .app { width: 100%; }
  .warehouse-scene { height: clamp(500px, 72svh, 650px); border-radius: 0 0 24px 24px; }
  .mission-dock { right: 10px; bottom: 10px; left: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 8: Run static and full tests**

Run: `node --test tests/static-ui.test.js tests/scene-view.test.js tests/scene-render.test.js`

Expected: PASS.

Run: `node --test tests/*.test.js`

Expected: all tests PASS.

- [ ] **Step 9: Commit and push the visual system**

```bash
git add styles.css index.html tests/static-ui.test.js
git commit -m "feat: style the living warehouse experience"
git push origin main
```

### Task 5: Зафиксировать командный контракт и провести мобильную приёмку

**Files:**
- Create: `tests/ui-command-contract.test.js`
- Create: `docs/screenshots/living-warehouse-mobile.png`
- Modify: `README.md`

**Interfaces:**
- The command contract covers `SELECT_ZONE`, `SELECT_STORE`, `ADD_ITEM`, `LOAD_PALLET`, `SET_ROUTE`, `PAUSE`, `END_SHIFT`, `OPEN_BUILDER`, `OPEN_VEHICLES` and `NAVIGATE`.
- The final screenshot is captured at a 390×844 viewport after the level-1 briefing is dismissed.
- No production JavaScript behavior is added in this task.

- [ ] **Step 1: Add a command-contract test before final visual QA**

Create `tests/ui-command-contract.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('redesign keeps every established gameplay command reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  const staticActions = ['SELECT_ZONE', 'SELECT_STORE', 'PAUSE', 'END_SHIFT', 'OPEN_BUILDER', 'OPEN_VEHICLES', 'NAVIGATE'];
  const delegatedActions = ['ADD_ITEM', 'LOAD_PALLET', 'SET_ROUTE'];

  for (const action of staticActions) assert.match(html, new RegExp(`data-action="${action}"`));
  for (const action of delegatedActions) assert.match(app, new RegExp(`action === '${action}'`));
});

test('mobile shell keeps builder, transport, pause and report reachable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['builderModal', 'vehicleModal', 'reportModal', 'routeButton', 'nextShift']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
```

- [ ] **Step 2: Run the command contract and fix only genuine wiring regressions**

Run: `node --test tests/ui-command-contract.test.js`

Expected: PASS. If a command is missing, restore its existing `data-action` or delegated branch; do not add a replacement reducer action.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
node --test tests/*.test.js
git diff --check
```

Expected: every test PASS and `git diff --check` produces no output.

- [ ] **Step 4: Perform the mobile interaction walkthrough at 390×844**

Open the app in a browser at a 390×844 viewport and verify this exact sequence:

```text
1. Dismiss the level-1 briefing.
2. Confirm the timer, one request, warehouse scene, pallet indicator and CTA are visible without horizontal scrolling.
3. Tap Сухач, open the pallet builder, add two waters and load the pallet.
4. Confirm the AGV enters the to-dispatch state and the success text remains readable.
5. Open transport, build the route to Северный and confirm the gate becomes ready.
6. Pause and resume the shift.
7. End the shift and confirm the report shows delivered, on-time, utilization, spoilage and profit.
8. Start level 4, put a chilled pallet into a dry vehicle and confirm the red stopped-cart reaction plus the existing spoilage explanation.
9. Enable reduced motion and repeat steps 3–5; all states must remain understandable without movement.
```

- [ ] **Step 5: Capture and inspect the accepted mobile screen**

After step 2 of the walkthrough, save a 390×844 screenshot to:

```text
docs/screenshots/living-warehouse-mobile.png
```

Inspect it for clipped labels, unreadable overlays, duplicate UI baked into the background, hidden CTA, excessive panel coverage and any horizontal overflow. Correct those issues in `styles.css`, rerun the full test suite, and recapture the screenshot.

- [ ] **Step 6: Document the visual architecture and screenshot**

Append to `README.md`:

```markdown
## Living warehouse UI

The mobile warehouse is rendered as a layered scene: an optimized WebP environment, semantic HTML interaction layers, and a pure `scene-view.js` mapper that turns existing game state into visual modes. Animations represent reducer state only and are disabled through the operating system's reduced-motion preference.

Reference screenshot: `docs/screenshots/living-warehouse-mobile.png`.
```

- [ ] **Step 7: Commit and push the verified redesign**

```bash
git add tests/ui-command-contract.test.js docs/screenshots/living-warehouse-mobile.png README.md styles.css
git commit -m "test: verify living warehouse mobile experience"
git push origin main
```

- [ ] **Step 8: Verify the pushed result**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected: clean `main...origin/main` and identical local/remote commit hashes.

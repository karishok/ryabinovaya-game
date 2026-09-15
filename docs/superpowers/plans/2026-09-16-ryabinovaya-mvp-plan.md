# «Рябиновая» MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить текущий визуальный прототип в тестируемую мобильную игру с базовым игровым циклом распределения товаров, тремя зонами, специализированным транспортом, паллетами, маршрутами и первой сюжетной кампанией.

**Architecture:** Разделить текущий автономный `index.html` на тонкий HTML-shell, CSS мобильного приложения, чистый игровой движок без DOM-зависимостей и слой UI, который переводит действия пользователя в команды движка. Данные восьми уровней будут храниться отдельно от логики, чтобы новые сценарии добавлялись без переписывания интерфейса.

**Tech Stack:** Vanilla HTML, CSS и JavaScript; CommonJS-модули для игрового движка; встроенный Node.js test runner (`node --test`); без внешних зависимостей и сборщика.

**Spec:** `docs/superpowers/specs/2026-09-15-ryabinovaya-game-design.md`

## Global Constraints

- Платформа: мобильное приложение.
- Смена: 3–5 минут.
- В игре три зоны: «Сухач», «Заморозка», «Охлаждёнка».
- Одна машина обслуживает только одну зону.
- Одна паллета предназначена для одного даркстора.
- В одной машине может быть несколько паллет.
- Одна машина может посетить несколько дарксторов.
- Ошибки снижают прибыль и рейтинг, но не заканчивают смену сразу.
- Сюжет показывается между уровнями, а во время смены используются короткие рабочие уведомления.
- Первая версия не включает сложную экономику, улучшения сотрудников, полноценную карту города, онлайн-рейтинг и физику коробок.

---

### Task 1: Разделить прототип и добавить тестовый каркас

**Files:**
- Modify: `index.html` — оставить разметку экранов и подключить внешние файлы.
- Create: `styles.css` — перенести стили из `<style>` без изменения поведения.
- Create: `game-engine.js` — пока экспортировать пустой стабильный объект API.
- Create: `app.js` — перенести обработчики из inline `<script>`.
- Create: `tests/smoke.test.js` — проверить, что основные файлы существуют и движок импортируется.

**Interfaces:**
- `index.html` consumes `styles.css`, `game-engine.js` and `app.js` through script/link tags.
- `app.js` consumes the exported object from `game-engine.js`.
- Later tasks depend on `require('./game-engine.js')` returning an object, even before rules are added.

- [ ] **Step 1: Write the failing smoke test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('mobile app shell has external assets and a loadable engine', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /styles\.css/);
  assert.match(html, /game-engine\.js/);
  assert.match(html, /app\.js/);
  assert.ok(require('../game-engine.js'));
});
```

- [ ] **Step 2: Run the smoke test and verify it fails**

Run: `node --test tests/smoke.test.js`

Expected: FAIL because the external files and engine export do not exist yet.

- [ ] **Step 3: Extract the files without changing the current UI behavior**

Move the existing CSS into `styles.css`. Move the existing inline JavaScript into `app.js`. In the browser, `app.js` must read `window.RyabinovayaEngine`; in Node tests, `game-engine.js` must remain importable through CommonJS. Add this browser-safe export pattern:

```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {};
});
```

Load `game-engine.js` before `app.js` in `index.html`; later load `levels.js` and `app-state.js` before `app.js` as those files are introduced.

- [ ] **Step 4: Run the smoke test and open the app**

Run: `node --test tests/smoke.test.js`

Expected: PASS. Open `index.html` and verify that the header, warehouse map, modal, pause button and report modal still appear.

- [ ] **Step 5: Commit the extraction checkpoint**

```bash
git add index.html styles.css game-engine.js app.js tests/smoke.test.js
git commit -m "refactor: split Ryabinovaya mobile prototype"
```

If the managed workspace still rejects `.git` writes, publish the same file set through the connected GitHub repository after fetching each existing file SHA; do not discard the local files.

### Task 2: Реализовать чистые правила зон, паллет и машин

**Files:**
- Modify: `game-engine.js` — add immutable constants and pure state transitions.
- Create: `tests/game-engine.test.js` — cover all compatibility and capacity rules.

**Interfaces:**
- Produces `ZONES`, `ITEMS`, `createPallet`, `addItemToPallet`, `createVehicle`, `loadPallet`, `buildRoute`, `scoreShift`.
- `app.js` will consume these exact functions in later tasks.

Use these exact shapes:

```js
const ZONES = Object.freeze({ DRY: 'dry', FROZEN: 'frozen', CHILLED: 'chilled' });

createPallet({ storeId, zone })
// => { storeId: string, zone: 'dry'|'frozen'|'chilled', items: [], weight: 0, capacity: 100 }

addItemToPallet(pallet, { sku, zone, weightPerUnit }, quantity)
// => { ok: true, pallet } | { ok: false, reason: 'wrong-zone'|'over-capacity' }

createVehicle({ id, zone, capacity = 100 })
// => { id: string, zone, capacity: number, pallets: [] }

loadPallet(vehicle, pallet)
// => { ok: true, vehicle } | { ok: false, reason: 'wrong-zone'|'over-capacity' }

buildRoute(vehicle, stops)
// => { stops: string[], minutes: number, distanceScore: number }

scoreShift({ deliveredPercent, onTimePercent, utilizationPercent, spoiledPallets, routePenalty })
// => { stars: 1|2|3, profit: number, reasons: string[] }
```

- [ ] **Step 1: Write failing tests for zone compatibility**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES, createPallet, addItemToPallet, createVehicle, loadPallet } = require('../game-engine.js');

test('milk can be added to chilled pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.CHILLED });
  const result = addItemToPallet(pallet, { sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10 }, 2);
  assert.equal(result.ok, true);
  assert.equal(result.pallet.weight, 20);
});

test('milk cannot be added to dry pallet', () => {
  const pallet = createPallet({ storeId: 'north', zone: ZONES.DRY });
  const result = addItemToPallet(pallet, { sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10 }, 1);
  assert.deepEqual(result, { ok: false, reason: 'wrong-zone' });
});

test('a vehicle accepts only pallets from its zone', () => {
  const vehicle = createVehicle({ id: 'dry-1', zone: ZONES.DRY });
  const pallet = createPallet({ storeId: 'north', zone: ZONES.CHILLED });
  assert.deepEqual(loadPallet(vehicle, pallet), { ok: false, reason: 'wrong-zone' });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/game-engine.test.js`

Expected: FAIL because the constants and functions are not implemented.

- [ ] **Step 3: Implement the minimal pure rules**

Keep all transitions immutable: clone `items`, `pallets` and the containing object before adding data. Reject a quantity that would make `weight > capacity`. Reject a zone mismatch before checking capacity. Use exact reason strings from the interface.

- [ ] **Step 4: Add route and score tests**

```js
const { buildRoute, scoreShift } = require('../game-engine.js');

test('route preserves the player-selected stop order', () => {
  const route = buildRoute({ id: 'dry-1', zone: 'dry' }, ['north', 'central', 'west']);
  assert.deepEqual(route.stops, ['north', 'central', 'west']);
  assert.ok(route.minutes > 0);
});

test('three stars require strong delivery and utilization', () => {
  const result = scoreShift({ deliveredPercent: 95, onTimePercent: 95, utilizationPercent: 90, spoiledPallets: 0, routePenalty: 0 });
  assert.equal(result.stars, 3);
  assert.ok(result.profit > 0);
});

test('wrong transport appears in the score reasons', () => {
  const result = scoreShift({ deliveredPercent: 84, onTimePercent: 80, utilizationPercent: 70, spoiledPallets: 1, routePenalty: 10 });
  assert.ok(result.reasons.some(reason => reason.includes('испорчен')));
});
```

- [ ] **Step 5: Run all engine tests**

Run: `node --test tests/game-engine.test.js`

Expected: PASS with tests for three zones, one-pallet-one-store, one-zone-one-vehicle, vehicle capacity, route order and stars.

- [ ] **Step 6: Commit the engine checkpoint**

```bash
git add game-engine.js tests/game-engine.test.js
git commit -m "feat: add warehouse logistics rules"
```

### Task 3: Описать кампанию уровнями и прогрессию

**Files:**
- Create: `levels.js` — data-only definitions for levels 1–8.
- Create: `tests/levels.test.js` — validate rule progression and scenario completeness.
- Modify: `game-engine.js` — add `createShiftState(level)` and `advanceScenario(state, event)`.

**Interfaces:**
- `levels.js` exports `LEVELS`, an array of eight objects with `id`, `title`, `durationSeconds`, `unlockedZones`, `vehicles`, `stores`, `initialOrders`, `events`, `goal`, `storyBefore`, `storyAfter`.
- `createShiftState(level)` returns `{ levelId, secondsRemaining, orders, pallets: [], vehicles: [], events: [], metrics }`.
- `advanceScenario(state, event)` returns a new state without mutating the input.

- [ ] **Step 1: Write tests for the level ladder**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVELS } = require('../levels.js');

test('campaign has eight levels in order', () => {
  assert.deepEqual(LEVELS.map(level => level.id), [1,2,3,4,5,6,7,8]);
});

test('each level adds at most one primary mechanic', () => {
  const newMechanics = LEVELS.map(level => level.newMechanic);
  assert.deepEqual(newMechanics, ['one-order', 'two-stores', 'multi-pallet', 'three-zones', 'multi-vehicle', 'route', 'dynamic-demand', 'exam']);
});

test('level 4 is the first level with all three zones', () => {
  assert.deepEqual(LEVELS[2].unlockedZones, ['dry']);
  assert.deepEqual(LEVELS[3].unlockedZones, ['dry', 'frozen', 'chilled']);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/levels.test.js`

Expected: FAIL because `levels.js` does not exist.

- [ ] **Step 3: Add the eight data-driven levels**

Encode the agreed scenarios exactly: level 1 «Один заказ», level 2 «Два адреса», level 3 «Полный кузов», level 4 «Три зоны», level 5 «Парк машин», level 6 «Маршрут», level 7 «План меняется», level 8 «Контрольная смена». Level 4 must use only zone compatibility, with no spoilage timer. Level 7 must represent the new request as a single event rather than a continuous hidden demand simulation.

- [ ] **Step 4: Add immutable scenario transitions**

Implement `createShiftState` from the selected level and `advanceScenario` for the explicit event types `demand-increase`, `vehicle-ready`, `store-reception-change` and `order-cancelled`.

- [ ] **Step 5: Run all data and engine tests**

Run: `node --test tests/game-engine.test.js tests/levels.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the campaign checkpoint**

```bash
git add levels.js game-engine.js tests/levels.test.js
git commit -m "feat: add eight-level campaign data"
```

### Task 4: Перенести мобильный интерфейс на команды игрового движка

**Files:**
- Modify: `index.html` — add compact level header, mission card, zone selector, pallet builder, vehicle drawer and report screen; remove duplicate desktop-only panels.
- Modify: `styles.css` — enforce a 430px mobile shell, large tap targets, one active mission and bottom navigation.
- Modify: `app.js` — render state and dispatch UI commands to the engine.
- Create: `app-state.js` — browser-safe reducer adapter for UI actions.
- Create: `tests/app-state.test.js` — test command-to-state wiring without browser APIs.

**Interfaces:**
- `app.js` owns `let state` and exposes `dispatch(action)` for testability.
- Actions: `{ type: 'SELECT_ZONE', zone }`, `{ type: 'SELECT_STORE', storeId }`, `{ type: 'ADD_ITEM', sku, quantity }`, `{ type: 'LOAD_PALLET', vehicleId }`, `{ type: 'SET_ROUTE', stops }`, `{ type: 'PAUSE' }`, `{ type: 'END_SHIFT' }`.
- `render(state, document)` updates only the visible mobile screen and does not calculate game rules.

- [ ] **Step 1: Write the failing app-state tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { reduceAction } = require('../app-state.js');

test('adding a compatible item increases pallet weight', () => {
  const initial = { pallet: { zone: 'chilled', storeId: 'north', weight: 0, items: [] } };
  const next = reduceAction(initial, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 2 });
  assert.equal(next.pallet.weight, 20);
});

test('wrong-zone feedback is preserved for the UI', () => {
  const initial = { pallet: { zone: 'dry', storeId: 'north', weight: 0, items: [] } };
  const next = reduceAction(initial, { type: 'ADD_ITEM', sku: 'milk', zone: 'chilled', weightPerUnit: 10, quantity: 1 });
  assert.equal(next.feedback.kind, 'error');
  assert.equal(next.feedback.code, 'wrong-zone');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/app-state.test.js`

Expected: FAIL because `app-state.js` and `reduceAction` do not exist.

- [ ] **Step 3: Extract a browser-independent reducer**

Create `app-state.js` with `reduceAction(state, action)`. It may call functions from `game-engine.js`, but it must return a new state with `feedback: { kind: 'success'|'error'|'info', code, message }` for every rejected action. Keep DOM access in `app.js` only.

- [ ] **Step 4: Build the one-screen mobile layout**

Keep the primary screen limited to: time, three compact metrics, warehouse map, current urgent mission, current vehicle and the single CTA «Собрать паллету». Move detailed content behind the bottom navigation. Use minimum 44px tap targets and keep the current cheerful visual palette without adding new dependency assets.

- [ ] **Step 5: Connect the pallet builder**

The builder must display the selected store, selected zone, four item rows and live capacity. The `+` and `−` controls dispatch `ADD_ITEM`. Confirming a pallet dispatches `LOAD_PALLET`; on success it closes the builder and shows a single-line confirmation, while a wrong-zone or over-capacity result leaves the builder open and explains the error.

- [ ] **Step 6: Run app-state tests and manually smoke-test the UI**

Run: `node --test tests/app-state.test.js tests/game-engine.test.js tests/levels.test.js`

Manual checklist: open `index.html`; tap the CTA; add milk to «Охлаждёнка»; attempt an incompatible zone and verify the error; create a compatible pallet; pause and resume; verify the report can open at the end of the shift.

- [ ] **Step 7: Commit the mobile interaction checkpoint**

```bash
git add index.html styles.css app.js app-state.js tests/app-state.test.js
git commit -m "feat: connect mobile UI to game state"
```

### Task 5: Добавить уровни, рабочие уведомления и отчёт смены

**Files:**
- Modify: `app.js` — load the selected level, schedule its explicit events, advance the timer and show the next mission.
- Modify: `app-state.js` — support `START_LEVEL`, `TICK`, `END_SHIFT` and `DISMISS_FEEDBACK`.
- Modify: `index.html` — add level briefing, between-level story card and results report.
- Modify: `styles.css` — style briefings, event banners, success/error feedback and stars.
- Create: `tests/shift-flow.test.js` — test the full first-level flow.

**Interfaces:**
- `startLevel(levelId)` returns the initial `app-state` for that level.
- `tick(state, seconds = 1)` reduces `secondsRemaining` only when `paused === false`.
- `finishShift(state)` returns `{ report, nextLevelId }`.
- `report` contains `stars`, `profit`, `deliveredPercent`, `onTimePercent`, `utilizationPercent`, `spoiledPallets`, `reasons`.

- [ ] **Step 1: Write the failing shift-flow tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startLevel, tick, finishShift } = require('../app-state.js');

test('level 1 starts with one dry store and one vehicle', () => {
  const state = startLevel(1);
  assert.equal(state.levelId, 1);
  assert.equal(state.stores.length, 1);
  assert.equal(state.vehicles.length, 1);
  assert.deepEqual(state.unlockedZones, ['dry']);
});

test('paused shift does not consume time', () => {
  const state = { ...startLevel(1), paused: true };
  assert.equal(tick(state, 10).secondsRemaining, state.secondsRemaining);
});

test('finished shift returns a report and unlocks the next level', () => {
  const state = { ...startLevel(1), metrics: { deliveredPercent: 100, onTimePercent: 100, utilizationPercent: 90, spoiledPallets: 0, routePenalty: 0 } };
  const result = finishShift(state);
  assert.equal(result.report.stars, 3);
  assert.equal(result.nextLevelId, 2);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/shift-flow.test.js`

Expected: FAIL because the shift-flow functions are not implemented.

- [ ] **Step 3: Implement level loading, timer and explicit events**

Use `LEVELS` as the only source of level configuration. The timer must not create hidden demand or spoilage. Events are scheduled from the level data and displayed as short operational messages.

- [ ] **Step 4: Implement the between-level story flow**

Show `storyBefore` before a level and `storyAfter` after the report. The player taps once to continue. Never show a long dialogue overlay during the active 3–5 minute shift.

- [ ] **Step 5: Implement the report**

Show stars, profit, deliveries on time, utilization, spoiled pallets and up to three concise reasons. Include a «Следующая смена» button that loads the next level or, after level 8, opens the endless-mode placeholder screen without pretending the endless mode is already implemented.

- [ ] **Step 6: Run the complete automated suite and smoke-test levels 1–8**

Run: `node --test tests/*.test.js`

Manual checklist: level 1 starts with one zone; level 4 exposes all three zones and specialized vehicles; level 6 accepts multiple route stops; level 7 shows a demand-change notification; level 8 produces a report without adding another rule.

- [ ] **Step 7: Commit the campaign-flow checkpoint**

```bash
git add index.html styles.css app.js app-state.js tests/shift-flow.test.js
git commit -m "feat: add campaign shift flow and reports"
```

### Task 6: Финальная проверка и публикация в GitHub

**Files:**
- Modify: `README.md` — document how to open the prototype and run tests.
- Create: `tests/static-ui.test.js` — verify required labels and three zones remain in the HTML.

**Interfaces:**
- README commands: `node --test tests/*.test.js` and open `index.html` in a browser.
- Static test checks `index.html` contains `Сухач`, `Заморозка`, `Охлаждёнка`, `Рябиновая`, `Собрать паллету` and `reportModal`.

- [ ] **Step 1: Write the failing static UI test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('final mobile prototype keeps the product vocabulary', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Рябиновая', 'Сухач', 'Заморозка', 'Охлаждёнка', 'Собрать паллету', 'reportModal']) {
    assert.match(html, new RegExp(label));
  }
});
```

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/*.test.js`

Expected: PASS with zero failures.

- [ ] **Step 3: Run the manual mobile QA checklist**

Check a narrow viewport around 390px wide: no horizontal scrolling, no clipped CTA, all buttons are tappable, builder closes after successful loading, incompatible goods show a clear reason, pause works, and the final report is readable.

- [ ] **Step 4: Document the project**

Add `README.md` with the game concept, local open instructions, test command, and the scope boundary that this is a vanilla prototype without a build step.

- [ ] **Step 5: Publish the final state**

```bash
git add README.md tests/static-ui.test.js
git commit -m "docs: document Ryabinovaya prototype"
git push origin main
```

If local Git remains read-only, fetch the current GitHub SHA for every modified file and use the GitHub connector's file update operation with the exact SHA and the commit message above. Verify the final repository contains `index.html`, `styles.css`, `game-engine.js`, `app.js`, `app-state.js`, `levels.js`, `README.md`, `tests/`, and the design/plan documents.

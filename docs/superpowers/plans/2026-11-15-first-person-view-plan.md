# Вид от первого лица — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить на экране смены схему склада шестью кадрами глазами кладовщика: игра сама везёт между кадрами, игрок выбирает зону и ворота отгрузки.

**Architecture:** Правила игры остаются в `app-state.js`; в них одно изменение — `LOAD_PALLET` проверяет зону ворот. Где сейчас кладовщик, решает новый модуль без DOM `fp-view.js` (чистая функция от состояния до и после действия). `app.js` хранит место рядом с состоянием, после каждого действия спрашивает у `fp-view.js` новое место и выставляет его атрибутом сцены; какие области нажатия видны и где они лежат на кадре, решает `styles.css`.

**Tech Stack:** Обычный JavaScript без сборки (UMD-модули, один и тот же файл грузится в браузер и в Node), `node --test`, CSS. Никаких зависимостей.

## Global Constraints

- Спецификация: `docs/superpowers/specs/2026-11-15-first-person-view-design.md`.
- Ветка `claude/game-upgrade-r9lt5c`. Не пушить.
- Запуск тестов: `node --test tests/*.test.js`. До начала работы — 352 зелёных.
- Зону размещения игра не подсказывает никогда: ни подсветкой, ни текстом, ни в какой смене.
- Чужие ворота: паллета цела, в показатели и отчёт ничего не пишется.
- На складе нет конвейеров и роботов; паллету возит человек на электротележке.
- Режим «Поток» (`flow-app.js`, `flow-engine.js`, `flow-view.js`, `data-screen="flow"`) не трогать.
- Идентификаторы и `data-action` существующих элементов сцены (`warehouseScene`, `scenePallet`, `sceneTruckBay`, `sceneDock`, `truckTimer`, `mapPallets`, вывески `data-scene-zone`) сохраняются: на них стоят тесты.
- Комментарии в коде — по-русски и о том, почему так, как в остальном репозитории.
- Каждый коммит заканчивается строкой `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Карта файлов

| Файл | Что с ним |
|---|---|
| `app-state.js` | Изменить: проверка зоны ворот в `LOAD_PALLET` |
| `scene-view.js` | Изменить: вынести и экспортировать `sceneInboundFor`; подписи кнопки шага |
| `fp-view.js` | Создать: кадры и правило перемещения, без DOM |
| `app.js` | Изменить: место кладовщика, действия `GO_*` и `GATE`, отрисовка кадра |
| `index.html` | Изменить: два слоя кадра, ворота, кнопки «К отгрузке» и «На проезд», подключение `fp-view.js`, текст гайда |
| `styles.css` | Изменить: видимость и положение областей по кадрам, переход |
| `assets/fp/*.webp` | Создать: шесть кадров |
| `tests/gate-choice.test.js` | Создать |
| `tests/fp-view.test.js` | Создать |
| `tests/fp-interaction.test.js` | Создать |
| `tests/fp-scene.test.js` | Создать |
| `tests/scene-render.test.js`, `tests/tsd-interaction.test.js`, `tests/guide.test.js`, `tests/live-kpis.test.js`, `tests/static-ui.test.js` | Изменить: подключить `fp-view.js` в окружение, поправить привязанное к старой схеме |
| `docs/HANDOFF.md`, `docs/redesign/README.md`, спецификация | Изменить: записать, что сделано |

---

### Task 1: Ворота отгрузки выбирает игрок

**Files:**
- Modify: `app-state.js` (ветка `LOAD_PALLET`, сразу после проверки пустой паллеты, около строки 771)
- Test: `tests/gate-choice.test.js`

**Interfaces:**
- Produces: действие `{ type: 'LOAD_PALLET', gateZone: 'dry' | 'chilled' | 'frozen', vehicleId? }`. При `gateZone`, не равном зоне паллеты, состояние не меняется, кроме `feedback = { kind: 'error', code: 'wrong-gate', message }`. Без `gateZone` поведение прежнее.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/gate-choice.test.js`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test tests/gate-choice.test.js`
Expected: первый тест FAIL — `after.feedback.code` равен `'pallet-loaded'`, а не `'wrong-gate'`. Два других PASS.

- [ ] **Step 3: Реализация**

В `app-state.js` в ветке `if (action.type === 'LOAD_PALLET') {` сразу после строки с `'empty-pallet'` добавить:

```js
      /* Ворота выбирает игрок: у каждых своя температура. Чужая машина
         паллету просто не берёт — она цела, в показатели ничего не идёт,
         потеряно только время. Без gateZone действие работает по-старому:
         так его вызывают боты в тестах. */
      if (action.gateZone && action.gateZone !== pallet.zone) {
        return withFeedback(state, feedback('error', 'wrong-gate', 'Эта машина паллету не берёт: у неё другая температура.'));
      }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `node --test tests/gate-choice.test.js`
Expected: 3 PASS.

Run: `node --test tests/*.test.js`
Expected: 355 pass, 0 fail.

- [ ] **Step 5: Коммит**

```bash
git add app-state.js tests/gate-choice.test.js
git commit -m "Ворота отгрузки выбирает игрок: чужая машина паллету не берёт"
```

---

### Task 2: Модуль `fp-view.js` — где сейчас кладовщик

**Files:**
- Create: `fp-view.js`
- Modify: `scene-view.js` (функция `warehouseViewFor` и строка экспорта в конце файла)
- Test: `tests/fp-view.test.js`

**Interfaces:**
- Consumes: `LOAD_PALLET` с `gateZone` из Task 1; из `app-state.js` — `guidedFor(state)`, `currentTaskFor(state)`.
- Produces:
  - `sceneView.sceneInboundFor(state)` → входящая паллета, с которой сейчас работают, или `null`.
  - `fpView.FRAMES` — объект «место → путь к файлу»; `fpView.LOCATIONS` — массив шести мест: `'hub'`, `'receiving'`, `'shelf:dry'`, `'shelf:chilled'`, `'shelf:frozen'`, `'shipping'`.
  - `fpView.frameFor(location)` → `{ key, src }`.
  - `fpView.canPick(state)` → `true`, если сейчас можно ехать к полке собирать.
  - `fpView.locationAfter(location, before, after, action)` → `{ location, via }`; `via` — `'receiving'` либо `null`.
  - Действия вида, которых нет в редьюсере: `{ type: 'GO_HUB' }`, `{ type: 'GO_SHELF', zone }`, `{ type: 'GO_SHIPPING' }`.
  - В браузере модуль лежит в `window.RyabinovayaFpView`.

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/fp-view.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const appState = require('../app-state.js');
const engine = require('../game-engine.js');
const sceneView = require('../scene-view.js');
const fpView = require('../fp-view.js');

const { reduceAction, startLevel } = appState;
const { locationAfter, frameFor, canPick, FRAMES, LOCATIONS } = fpView;

/* Проигрывает действия и записывает, где кладовщик оказался после каждого.
   Действие с полем view — действие экрана: редьюсер его не знает, меняется
   только то, что перечислено в view. */
function walk(state, location, actions) {
  const trail = [];
  for (const action of actions) {
    const before = state;
    state = action.view ? { ...state, ...action.view } : reduceAction(state, action);
    const moved = locationAfter(location, before, state, action);
    location = moved.location;
    trail.push(moved.via ? `${moved.via}>${location}` : location);
  }
  return { state, location, trail };
}
const add = (sku, quantity) => {
  const item = engine.itemBySku(sku);
  return { type: 'ADD_ITEM', sku, zone: item.zone, weightPerUnit: item.weightPerUnit, quantity };
};
const shiftOf = (levelId) => reduceAction(startLevel(levelId), { type: 'CONTINUE_STORY' });
const goShelf = (zone) => ({ type: 'GO_SHELF', zone, view: {} });
const goHub = { type: 'GO_HUB', view: { builderOpen: false } };
const goShipping = { type: 'GO_SHIPPING', view: { builderOpen: false } };
const openBuilder = { type: 'OPEN_BUILDER', view: { builderOpen: true } };

test('there are exactly six places and each has a frame', () => {
  assert.deepEqual(LOCATIONS, ['hub', 'receiving', 'shelf:dry', 'shelf:chilled', 'shelf:frozen', 'shipping']);
  for (const location of LOCATIONS) {
    assert.match(FRAMES[location], /^assets\/fp\/[a-z-]+\.webp$/);
    assert.deepEqual(frameFor(location), { key: location, src: FRAMES[location] });
  }
  assert.deepEqual(frameFor('nowhere'), { key: 'hub', src: FRAMES.hub });
});

test('outside a shift the worker is always in the aisle', () => {
  const briefing = startLevel(1);
  assert.deepEqual(locationAfter('shipping', briefing, briefing, { type: 'OPEN_GUIDE' }), { location: 'hub', via: null });
});

test('guided receiving: the truck, then the aisle to choose a zone, then the shelf the player chose', () => {
  const { state, trail } = walk(startLevel(2), 'hub', [
    { type: 'CONTINUE_STORY' },
    { type: 'RECEIVE_PALLET' },
    { type: 'TICK' },
  ]);
  assert.deepEqual(trail, ['receiving', 'hub', 'hub']);

  const pallet = state.inbound.find((entry) => entry.status === 'received');
  const right = walk(state, 'hub', [{ type: 'PLACE_PALLET', zone: pallet.zone }, { type: 'TICK' }, { type: 'OPEN_TSD' }]);
  // Полка держится, пока игрок не сделал следующий шаг; дальше — следующая фура.
  assert.deepEqual(right.trail, [`shelf:${pallet.zone}`, `shelf:${pallet.zone}`, 'receiving']);

  const wrongZone = pallet.zone === 'dry' ? 'frozen' : 'dry';
  const wrong = walk(state, 'hub', [{ type: 'PLACE_PALLET', zone: wrongZone }]);
  assert.equal(wrong.state.feedback.code, 'wrong-placement');
  // Испорченная паллета стоит там, куда её привезли, а не там, где ей место.
  assert.deepEqual(wrong.trail, [`shelf:${wrongZone}`]);
});

test('placement never marks the right zone', () => {
  const placing = reduceAction(shiftOf(2), { type: 'RECEIVE_PALLET' });
  const view = sceneView.warehouseViewFor(placing);
  assert.equal(view.awaitingPlacement, true);
  assert.equal(view.activeZone, null);
});

test('a pallet received away from the dock passes the truck on the way to the aisle', () => {
  const shift = shiftOf(4);
  const { trail, state } = walk(shift, 'shipping', [{ type: 'ACCEPT_TASK' }]);
  assert.equal(sceneView.sceneInboundFor(state).status, 'received');
  assert.deepEqual(trail, ['receiving>hub']);
});

test('guided picking: the card drives to the shelf and to shipping, the gate is the player\'s', () => {
  const { trail } = walk(shiftOf(1), 'hub', [
    openBuilder,
    add('water', 2),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'frozen' },
    { type: 'LOAD_PALLET', gateZone: 'dry' },
  ]);
  assert.deepEqual(trail, ['shelf:dry', 'shelf:dry', 'shipping', 'shipping', 'shipping']);
});

test('queue picking: the aisle, a wrong shelf, back, the right shelf, shipping', () => {
  const { trail, state } = walk(shiftOf(3), 'shipping', [
    { type: 'ACCEPT_TASK' },
    goShelf('frozen'),
    goHub,
    goShelf('chilled'),
    add('milk', 2),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'chilled' },
  ]);
  assert.deepEqual(trail, ['hub', 'shelf:frozen', 'hub', 'shelf:chilled', 'shelf:chilled', 'shipping', 'shipping']);
  assert.equal(appState.currentTaskFor(state), null);
});

test('an order heavier than a pallet brings the worker back to the shelf after loading', () => {
  let state = shiftOf(3);
  state = walk(state, 'hub', [{ type: 'ACCEPT_TASK' }, add('milk', 2), { type: 'LOAD_PALLET', gateZone: 'chilled' }]).state;
  const { trail, state: after } = walk(state, 'shipping', [
    { type: 'ACCEPT_TASK' },
    goShelf('dry'),
    add('water', 8),
    goShipping,
    { type: 'LOAD_PALLET', gateZone: 'dry' },
  ]);
  // 120 кг воды при паллете на 100: задание ещё в работе, игра везёт обратно.
  assert.equal(appState.currentTaskFor(after).id, 'pick:order-north');
  assert.deepEqual(trail, ['hub', 'shelf:dry', 'shelf:dry', 'shipping', 'shelf:dry']);
});

test('taking a pallet off a truck starts at shipping', () => {
  let state = walk(shiftOf(3), 'hub', [{ type: 'ACCEPT_TASK' }, add('milk', 2), { type: 'LOAD_PALLET', gateZone: 'chilled' }]).state;
  state = { ...state, orders: state.orders.map((order) => order.id === 'order-east' ? { ...order, cancelled: true } : order) };
  const { trail, state: after } = walk(state, 'hub', [{ type: 'ACCEPT_TASK' }]);
  assert.equal(appState.currentTaskFor(after).kind, 'unload');
  assert.deepEqual(trail, ['shipping']);
});

test('an open builder means the worker stands at the shelf of the pallet zone', () => {
  const shift = shiftOf(2);
  const placed = { ...shift, inbound: shift.inbound.map((entry) => ({ ...entry, status: 'placed' })) };
  const open = { ...placed, builderOpen: true, pallet: { ...placed.pallet, zone: 'chilled' } };
  assert.deepEqual(locationAfter('shelf:dry', { ...placed, builderOpen: true }, open, { type: 'SELECT_ZONE', zone: 'chilled' }), { location: 'shelf:chilled', via: null });
});

test('canPick: only when there is something to collect right now', () => {
  assert.equal(canPick(startLevel(1)), false);
  assert.equal(canPick(shiftOf(1)), true);
  // Вводная смена с фурами у ворот: сначала приёмка.
  assert.equal(canPick(shiftOf(2)), false);
  // Смена с очередью: пока задание не принято, собирать нечего.
  assert.equal(canPick(shiftOf(3)), false);
  assert.equal(canPick(reduceAction(shiftOf(3), { type: 'ACCEPT_TASK' })), true);
});

test('sceneInboundFor: guided shifts see the dock, queue shifts only the accepted task', () => {
  assert.equal(sceneView.sceneInboundFor(shiftOf(2)).status, 'arrived');
  assert.equal(sceneView.sceneInboundFor(shiftOf(4)), null);
  assert.equal(sceneView.sceneInboundFor(reduceAction(shiftOf(4), { type: 'ACCEPT_TASK' })).id, 'in-butter');
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/fp-view.test.js`
Expected: FAIL — `Cannot find module '../fp-view.js'`.

- [ ] **Step 3: Вынести `sceneInboundFor` в `scene-view.js`**

В `scene-view.js` перед `function warehouseViewFor(state) {` добавить:

```js
  /* Входящая паллета, с которой сейчас работают. Во вводных сменах это та,
     что стоит у ворот; на смене с очередью ТСД — только паллета принятого
     задания: пока его не взяли, фура у ворот ещё не работа. */
  function sceneInboundFor(state) {
    if (guidedFor(state)) return pendingInboundFor(state);
    const activeTask = taskQueueFor(state).find((task) => task.active) || null;
    return activeTask?.kind === 'receive'
      ? (state.inbound || []).find((pallet) => pallet.id === activeTask.inboundId) || null
      : null;
  }
```

Внутри `warehouseViewFor` заменить блок

```js
    const inbound = guidedShift
      ? pendingInboundFor(state)
      : activeTask?.kind === 'receive' ? (state.inbound || []).find((pallet) => pallet.id === activeTask.inboundId) || null : null;
```

на

```js
    const inbound = sceneInboundFor(state);
```

Строку `const activeTask = guidedShift ? null : ...` выше оставить: `activeTask` нужен дальше для `palletGoalText`.

Последнюю строку возврата модуля заменить на:

```js
  return { warehouseViewFor, nextStepFor, orderBoardFor, departuresFor, sceneInboundFor };
```

- [ ] **Step 4: Создать `fp-view.js`**

```js
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const appState = isNode ? require('./app-state.js') : root.RyabinovayaAppState;
  const sceneView = isNode ? require('./scene-view.js') : root.RyabinovayaSceneView;
  const api = factory(appState, sceneView);
  if (isNode) module.exports = api;
  else root.RyabinovayaFpView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (appState, sceneView) {
  const { guidedFor, currentTaskFor } = appState;
  const { sceneInboundFor } = sceneView;

  /* Игрок смотрит глазами кладовщика на электротележке и видит одно место
     склада за раз. Мест шесть, у каждого свой кадр. */
  const FRAMES = {
    hub: 'assets/fp/hub-zones.webp',
    receiving: 'assets/fp/receiving.webp',
    'shelf:dry': 'assets/fp/shelf-dry.webp',
    'shelf:chilled': 'assets/fp/shelf-chilled.webp',
    'shelf:frozen': 'assets/fp/shelf-frozen.webp',
    shipping: 'assets/fp/shipping.webp',
  };
  const LOCATIONS = Object.keys(FRAMES);
  const shelf = (zone) => `shelf:${zone}`;
  const at = (location, via = null) => ({ location, via });
  const frameFor = (location) => (FRAMES[location]
    ? { key: location, src: FRAMES[location] }
    : { key: 'hub', src: FRAMES.hub });

  /* Ехать к полке есть смысл, только когда есть что собирать: во вводной
     смене — когда у ворот ничего не ждёт, на смене с очередью — когда
     принято задание на сборку. */
  const canPick = (state) => state.phase === 'shift'
    && (guidedFor(state) ? !sceneInboundFor(state) : currentTaskFor(state)?.kind === 'pick');

  /* Где кладовщик окажется после действия. Правило одно: игра везёт сама
     туда, где выбирать нечего, а зону и ворота выбирает игрок. Место живёт
     в экране, а не в состоянии игры: правила про кадры не знают. */
  function locationAfter(location, before, after, action = {}) {
    if (after.phase !== 'shift') return at('hub');
    /* Часы и погасший тост никого не возят: иначе полка, у которой игрок
       только что поставил паллету, исчезала бы в случайную долю секунды. */
    if (action.type === 'TICK' || action.type === 'DISMISS_FEEDBACK') return at(location);
    /* Размещение показывает полку той зоны, которую нажал игрок, — и при
       удаче, и при порче. Стоит раньше приёмки: следующая фура подождёт,
       пока он увидит, что получилось. */
    if (action.type === 'PLACE_PALLET' && ['pallet-placed', 'wrong-placement'].includes(after.feedback?.code)) {
      return at(shelf(action.zone));
    }
    const inbound = sceneInboundFor(after);
    if (inbound?.status === 'arrived') return at('receiving');
    if (inbound?.status === 'received') {
      const was = sceneInboundFor(before);
      const justReceived = !(was && was.id === inbound.id && was.status === 'received');
      // Паллету сняли с фуры: если кладовщик был не у ворот, он проезжает мимо них.
      return at('hub', justReceived && location !== 'receiving' ? 'receiving' : null);
    }
    if (action.type === 'GO_HUB') return at('hub');
    if (action.type === 'GO_SHELF') return at(shelf(action.zone));
    if (action.type === 'GO_SHIPPING') return at('shipping');
    // Открытая сборка — это и есть «стою у полки зоны паллеты».
    if (after.builderOpen) return at(shelf(after.pallet.zone));
    if (after.vehicleDrawerOpen && !before.vehicleDrawerOpen) return at('shipping');
    if (action.type === 'LOAD_PALLET' && after.feedback?.code === 'pallet-loaded') {
      // Заявка тяжелее паллеты: задание ещё в работе, игра везёт за остатком.
      const stillPicking = !guidedFor(after) && currentTaskFor(after)?.kind === 'pick';
      return at(stillPicking ? shelf(after.pallet.zone) : 'shipping');
    }
    if ((action.type === 'ACCEPT_TASK' || action.type === 'TAKE_URGENT') && !guidedFor(after)) {
      const task = currentTaskFor(after);
      if (task?.kind === 'pick') return at('hub');
      if (task?.kind === 'unload') return at('shipping');
    }
    if (action.type === 'START_LEVEL' || action.type === 'CONTINUE_STORY') return at('hub');
    // У ворот приёмки делать больше нечего.
    if (location === 'receiving') return at('hub');
    return at(location);
  }

  return { FRAMES, LOCATIONS, frameFor, canPick, locationAfter };
});
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `node --test tests/fp-view.test.js`
Expected: 12 PASS.

Run: `node --test tests/*.test.js`
Expected: 367 pass, 0 fail.

- [ ] **Step 6: Коммит**

```bash
git add fp-view.js scene-view.js tests/fp-view.test.js
git commit -m "fp-view: шесть мест склада и правило, куда игра везёт кладовщика"
```

---

### Task 3: Перемещение в игре

После этой задачи в игру уже можно играть по-новому, но картинка ещё старая, а новые кнопки не расставлены: это делает Task 4.

**Files:**
- Modify: `app.js` (импорты в начале файла; `renderScene`; `render`; `dispatch`; обработчик кликов)
- Modify: `index.html` (сцена `#warehouseScene`, строки 13–49; подключение скриптов, строка 283)
- Modify: `tests/scene-render.test.js`, `tests/tsd-interaction.test.js`, `tests/guide.test.js`, `tests/live-kpis.test.js` (окружение)
- Test: `tests/fp-interaction.test.js`

**Interfaces:**
- Consumes: `fpView.locationAfter`, `fpView.canPick`, `fpView.frameFor` из Task 2; `LOAD_PALLET` с `gateZone` из Task 1.
- Produces:
  - у `#warehouseScene` атрибуты `data-location` (`hub` | `receiving` | `shelf` | `shipping`) и `data-shelf-zone` (`dry` | `chilled` | `frozen` | пусто);
  - кнопки в разметке: `data-action="GATE"` с `data-gate-zone`, `data-action="GO_HUB"` (`#fpToHub`), `data-action="GO_SHIPPING"` (`#fpToShipping`);
  - `window.fpLocation()` → текущее место строкой, для тестов.

- [ ] **Step 1: Подключить `fp-view.js` в окружение существующих тестов**

Во всех четырёх файлах в объекте `window` тестового окружения после строки с `RyabinovayaTsdView` добавить строку:

```js
    RyabinovayaFpView: require('../fp-view.js'),
```

Файлы и места: `tests/scene-render.test.js` (функция `loadUi`), `tests/tsd-interaction.test.js` (функция `loadUiWithClicks`), `tests/guide.test.js` (строка 44), `tests/live-kpis.test.js` (строка 35).

- [ ] **Step 2: Написать падающие тесты**

Создать `tests/fp-interaction.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGame(levelId = 1) {
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', disabled: false, hidden: false, className: '',
      dataset: {}, attributes: {},
      style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      classList: { values: new Set(), toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      focus() {},
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
  const timers = [];
  const window = {
    RyabinovayaEngine: require('../game-engine.js'),
    RyabinovayaLevels: require('../levels.js'),
    RyabinovayaAppState: require('../app-state.js'),
    RyabinovayaSceneView: require('../scene-view.js'),
    RyabinovayaTsdView: require('../tsd-view.js'),
    RyabinovayaTsdSignal: require('../tsd-signal.js'),
    RyabinovayaFpView: require('../fp-view.js'),
    localStorage: { getItem: () => String(levelId), setItem() {} },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), { window, document, setInterval() {} });
  const click = (dataset) => clickHandler({ target: { closest: () => ({ dataset, disabled: false, focus() {} }) } });
  const scene = () => elementFor('warehouseScene');
  return {
    window, elements, click, timers,
    where: () => window.fpLocation(),
    scene,
    toast: () => elementFor('toast').textContent,
    start() { click({ action: 'CONTINUE_STORY' }); },
    zone: (zone) => click({ action: 'SELECT_ZONE', zone, sceneZone: zone }),
    gate: (zone) => click({ action: 'GATE', gateZone: zone }),
    add: (sku, zone, weight, quantity) => click({ action: 'ADD_ITEM', sku, zone, weight: String(weight), quantity: String(quantity) }),
  };
}

test('guided shift: the card drives to the shelf, the load button drives to shipping, the gate loads', () => {
  const game = loadGame(1);
  game.start();
  assert.equal(game.where(), 'hub');
  assert.equal(game.scene().dataset.location, 'hub');

  game.click({ action: 'OPEN_BUILDER' });
  assert.equal(game.where(), 'shelf:dry');
  assert.equal(game.scene().dataset.location, 'shelf');
  assert.equal(game.scene().dataset.shelfZone, 'dry');

  game.add('water', 'dry', 12, 2);
  // Кнопка сборки больше не грузит сама: она везёт к воротам.
  game.click({ action: 'LOAD_PALLET' });
  assert.equal(game.where(), 'shipping');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.window.dispatch({ type: 'TICK' }).loadedPallets.length, 0);

  game.gate('dry');
  assert.match(game.toast(), /в кузов/i);
  assert.equal(game.window.dispatch({ type: 'TICK' }).loadedPallets.length, 1);
  assert.equal(game.where(), 'shipping');
});

test('a gate of another zone refuses the pallet and the worker stays at shipping', () => {
  // Третья смена: машины есть у двух температур, так что ошибиться воротами можно.
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  assert.equal(game.elements.get('tsdDevice').dataset.screen, 'feedback');
  assert.match(game.elements.get('tsdMessage').textContent, /не берёт/);
  assert.equal(game.where(), 'shipping');
  assert.equal(game.window.dispatch({ type: 'DISMISS_FEEDBACK' }).loadedPallets.length, 0);
});

test('the load button with an empty pallet stays at the shelf and says why', () => {
  const game = loadGame(1);
  game.start();
  game.click({ action: 'OPEN_BUILDER' });
  game.click({ action: 'LOAD_PALLET' });
  assert.equal(game.where(), 'shelf:dry');
  assert.match(game.elements.get('builderFeedback').textContent + game.toast(), /Сначала добавьте товар/);
});

test('guided receiving: the truck, the aisle, then the shelf of the tapped zone', () => {
  const game = loadGame(2);
  game.start();
  assert.equal(game.where(), 'receiving');
  game.click({ action: 'RECEIVE_PALLET' });
  assert.equal(game.where(), 'hub');
  game.zone('frozen');
  // Вода в заморозке: паллета испорчена, и видно, куда её привезли.
  assert.equal(game.where(), 'shelf:frozen');
  assert.equal(game.elements.get('tsdDevice').dataset.screen, 'feedback');
});

test('queue shift: accepting a pick task no longer opens the builder, it puts the worker in the aisle', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  assert.equal(game.where(), 'hub');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.equal(game.elements.get('tsdDevice').dataset.open, 'false');
});

test('queue shift: the right shelf opens the builder, a wrong shelf only says so', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });

  game.zone('frozen');
  assert.equal(game.where(), 'shelf:frozen');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');
  assert.match(game.toast(), /другая зона/);
  // Нажатие на паллету у чужой полки сборку тоже не открывает.
  game.click({ action: 'OPEN_BUILDER' });
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'true');

  game.click({ action: 'GO_HUB' });
  assert.equal(game.where(), 'hub');
  game.zone('chilled');
  assert.equal(game.where(), 'shelf:chilled');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'false');
});

test('queue shift: zone signs do nothing until a pick task is accepted', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'CLOSE_TSD' });
  game.zone('chilled');
  assert.equal(game.where(), 'hub');
  assert.match(game.toast(), /Сначала примите задание/);
});

test('queue shift: an order heavier than a pallet returns to the shelf with the builder open', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  game.zone('chilled');
  game.add('milk', 'chilled', 10, 2);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('chilled');
  assert.equal(game.where(), 'shipping');

  game.click({ action: 'ACCEPT_TASK' });
  game.zone('dry');
  game.add('water', 'dry', 12, 8);
  game.click({ action: 'LOAD_PALLET' });
  game.gate('dry');
  assert.equal(game.where(), 'shelf:dry');
  assert.equal(game.elements.get('builderModal').attributes['aria-hidden'], 'false');
});

test('a gate tapped with an empty pallet opens the vehicles panel of that zone', () => {
  const game = loadGame(3);
  game.start();
  game.click({ action: 'CLOSE_TSD' });
  game.gate('chilled');
  assert.equal(game.elements.get('vehicleModal').attributes['aria-hidden'], 'false');
  assert.match(game.elements.get('vehicleTask').textContent, /Охлажд/i);
  assert.equal(game.where(), 'shipping');
});

test('receiving in a queue shift shows the truck for a moment on the way to the aisle', () => {
  const game = loadGame(4);
  game.start();
  game.click({ action: 'ACCEPT_TASK' });
  assert.equal(game.where(), 'hub');
  // Место уже проезд, а кадр ещё показывает фуру: его сменит таймер.
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'receiving');
  const pass = game.timers.find((timer) => timer.delay === 900);
  assert.ok(pass, 'the pass-through frame must be timed');
  pass.callback();
  assert.equal(game.elements.get('sceneBackdrop').dataset.frame, 'hub');
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `node --test tests/fp-interaction.test.js`
Expected: FAIL — `window.fpLocation is not a function`.

- [ ] **Step 4: Разметка — кнопки ворот и переездов, плашка срока**

В `index.html` заменить строку 14 (один `<img class="scene-backdrop" …>`) на два слоя:

```html
        <!-- Кадр глазами кладовщика. Слоёв два: под новым кадром остаётся
             прежний, пока новый проявляется. -->
        <img class="scene-backdrop scene-backdrop--prev" id="sceneBackdropPrev" src="assets/fp/hub-zones.webp" alt="" aria-hidden="true" />
        <img class="scene-backdrop" id="sceneBackdrop" src="assets/fp/hub-zones.webp" data-frame="hub" alt="" aria-hidden="true" />
```

В открывающем теге `<section class="warehouse-scene" id="warehouseScene" …>` добавить атрибуты `data-location="hub" data-shelf-zone=""`.

Строку с `id="sceneTruckBay"` (строка 42) заменить на — таймер выезжает из кнопки наружу, подпись меняется на «Машины»:

```html
        <button class="truck-bay scene-object" id="sceneTruckBay" data-action="OPEN_VEHICLES" type="button" aria-label="Открыть машины и маршрут"><span class="truck-light" aria-hidden="true"></span><span class="truck-badge" id="mapPallets">0 паллет</span><span class="scene-object-hint" aria-hidden="true">Машины</span></button>
        <!-- Срок ближайшей уходящей машины виден в любом кадре: ворота теперь
             показывает только кадр отгрузки. -->
        <span class="truck-timer" id="truckTimer" hidden></span>

        <!-- Ворота отгрузки. Их выбирает игрок: у каждых своя температура. -->
        <button class="scene-gate scene-gate--dry" data-action="GATE" data-gate-zone="dry" type="button" aria-label="Ворота сухой машины, +18 градусов"><b>+18°</b><small>Сухач</small></button>
        <button class="scene-gate scene-gate--chilled" data-action="GATE" data-gate-zone="chilled" type="button" aria-label="Ворота охлаждённой машины, +4 градуса"><b>+4°</b><small>Охлаждёнка</small></button>
        <button class="scene-gate scene-gate--frozen" data-action="GATE" data-gate-zone="frozen" type="button" aria-label="Ворота морозильной машины, −18 градусов"><b>−18°</b><small>Заморозка</small></button>

        <!-- Переезды от полки. К отгрузке игра везёт по кнопке, ворота игрок
             выбирает сам; «На проезд» — если приехал не в ту зону. -->
        <div class="fp-nav">
          <button class="fp-nav-button" id="fpToHub" data-action="GO_HUB" type="button">← На проезд</button>
          <button class="fp-nav-button fp-nav-button--go" id="fpToShipping" data-action="GO_SHIPPING" type="button" hidden>К отгрузке →</button>
        </div>
```

После строки `<script src="tsd-signal.js"></script>` добавить:

```html
  <script src="fp-view.js"></script>
```

- [ ] **Step 5: `app.js` — импорт и место кладовщика**

После строки `const { signalTsd } = …;` добавить:

```js
const { locationAfter, canPick, frameFor } = window.RyabinovayaFpView;
```

После строки `let audioUnlocked = false;` добавить:

```js
/* Где сейчас кладовщик. Это состояние экрана, а не игры: правила про кадры
   не знают. passingFrame — кадр, мимо которого он проезжает (фура перед
   проездом); его снимает таймер. */
let location = 'hub';
let passingFrame = null;
const PASS_MS = 900;
const info = (current, code, message) => ({ ...current, feedback: { kind: 'info', code, message } });
```

- [ ] **Step 6: `app.js` — `renderScene` выставляет место и кадр**

В начале `renderScene`, сразу после `const scene = byId(document, 'warehouseScene');`, добавить:

```js
  // Тесты зовут renderScene с неполным видом: без места это проезд.
  const place = view.location || 'hub';
  const [placeKind, shelfZone = ''] = place.split(':');
  scene.dataset.location = placeKind;
  scene.dataset.shelfZone = shelfZone;
  const frame = frameFor(view.passingFrame || place);
  const backdrop = byId(document, 'sceneBackdrop');
  if (backdrop && backdrop.dataset.frame !== frame.key) {
    const previous = byId(document, 'sceneBackdropPrev');
    if (previous) previous.src = backdrop.src || frame.src;
    backdrop.src = frame.src;
    backdrop.dataset.frame = frame.key;
    // Чётность перезапускает анимацию наезда без принудительного reflow.
    scene.dataset.frameParity = scene.dataset.frameParity === '1' ? '0' : '1';
  }
```

- [ ] **Step 7: `app.js` — `render` передаёт место и рисует ворота и кнопки переезда**

В `render` заменить строку `renderScene(sceneView, document);` на:

```js
  sceneView.location = location;
  sceneView.passingFrame = passingFrame;
  renderScene(sceneView, document);
```

После блока `document.querySelectorAll('[data-scene-zone]').forEach(…)` (тот, что прячет закрытые зоны) добавить:

```js
  /* Ворот столько, сколько в смене температур у машин: ворота без машины
     не показываем, как и вывеску закрытой зоны. Во вводных сменах верные
     ворота подсвечены; зону размещения не подсвечивает ничто. */
  const palletReady = (nextState.pallet?.weight || 0) > 0;
  document.querySelectorAll('[data-gate-zone]').forEach((gate) => {
    const served = nextState.vehicles.some((vehicle) => vehicle.zone === gate.dataset.gateZone);
    gate.hidden = !served;
    gate.disabled = !served;
    gate.classList.toggle('is-focus', sceneView.guided && palletReady && gate.dataset.gateZone === nextState.pallet.zone);
  });
  const toShipping = byId(document, 'fpToShipping');
  if (toShipping) toShipping.hidden = !palletReady;
```

- [ ] **Step 8: `app.js` — `dispatch` понимает переезды и ворота**

В функции `dispatch` заменить начало — от строки `function dispatch(action) {` до закрывающей `}` ветки `OPEN_BUILDER` включительно (то есть до места, где сейчас стоит `} else if (action.type === 'CLOSE_BUILDER')`) — на текст ниже. Тело ветки `OPEN_BUILDER` переносится без изменений; всё, что идёт после `else if (action.type === 'CLOSE_BUILDER')`, пока не трогать.

```js
function dispatch(action) {
  const before = state;
  const queueShift = !guidedFor(state) && state.phase === 'shift';
  /* Ворота — два действия в одном: с товаром на паллете это погрузка в
     машину этой температуры, с пустой — взгляд в кузов и маршрут. */
  if (action.type === 'GATE') {
    const vehicle = state.vehicles.find((entry) => entry.zone === action.zone);
    if (!vehicle) return state;
    action = (state.pallet?.weight || 0) > 0
      ? { type: 'LOAD_PALLET', gateZone: action.zone, vehicleId: state.selectedVehicleId }
      : { type: 'OPEN_VEHICLES', vehicleId: vehicle.id };
  }
  // Действие, по которому считается новое место; отказ превращает его в «никуда».
  let move = action;
  /* На смене с очередью зону паллеты задаёт задание. Приехал к чужой полке —
     собирать там нечего. Во вводной смене такого не бывает: там кнопка
     карточки сама везёт к полке зоны паллеты. */
  const wrongShelf = 'Товара этой заявки здесь нет — это другая зона. Вернитесь на проезд.';
  const atWrongShelf = queueShift && location.startsWith('shelf:') && location !== `shelf:${state.pallet.zone}`;
  if (action.type === 'OPEN_BUILDER' && atWrongShelf) {
    state = info(state, 'wrong-shelf', wrongShelf);
  } else if (action.type === 'OPEN_BUILDER') {
    if (queueShift) {
      /* На смене с очередью паллета собирается только под принятое задание.
         Нет принятого — нажатие на паллету показывает, что предлагает ТСД. */
      state = currentTaskFor(state)?.kind === 'pick'
        ? { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } }
        : { ...state, feedback: null, tsd: { ...state.tsd, open: true, dismissedTaskId: null } };
    } else {
      /* Нажатие на паллету открывает сборку сразу. Раньше оно уводило на
         экран задания, и «Принять» приходилось жать только чтобы вернуться. */
      if (!state.tsd?.acceptedOrderId) state = reduceAction(state, { type: 'ACCEPT_TASK' });
      state = { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } };
    }
  } else if (action.type === 'GO_HUB') {
    state = { ...state, builderOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
  } else if (action.type === 'GO_SHIPPING') {
    if ((state.pallet?.weight || 0) === 0) {
      // Пустую паллету к воротам не везут; редьюсер сам скажет почему.
      state = reduceAction(state, { type: 'LOAD_PALLET' });
      move = { type: 'STAY' };
    } else {
      state = { ...state, builderOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
    }
  } else if (action.type === 'GO_SHELF') {
    if (!canPick(state)) {
      state = info(state, 'no-pick-task', 'Сначала примите задание на ТСД.');
      move = { type: 'STAY' };
    } else {
      /* Во вводной смене зону паллеты выбирает игрок, как раньше вывеской;
         на смене с очередью её задаёт задание, и чужая полка — просто
         потерянные секунды. */
      if (!queueShift && state.pallet.zone !== action.zone) {
        state = reduceAction(state, { type: 'SELECT_ZONE', zone: action.zone });
        const compatible = state.vehicles.find((vehicle) => vehicle.zone === state.pallet.zone && vehicle.ready);
        if (compatible) state = { ...state, selectedVehicleId: compatible.id };
      }
      if (state.pallet.zone === action.zone) {
        // У верной полки сборка открывается сама: лишнее нажатие под таймером ни к чему.
        if (!queueShift && !state.tsd?.acceptedOrderId) state = reduceAction(state, { type: 'ACCEPT_TASK' });
        state = { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } };
      } else {
        state = info(state, 'wrong-shelf', wrongShelf);
      }
    }
  } else if (action.type === 'CLOSE_BUILDER') state = { ...state, builderOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
```

Последняя строка — прежняя ветка `CLOSE_BUILDER`; дальше идут прежние ветки `OPEN_VEHICLES`, `CLOSE_VEHICLES`, `OPEN_GUIDE`, `CLOSE_GUIDE` и общая `else { … }`. Прежнее объявление `const queueShift = …;` в начале функции теперь стоит второй строкой — второй раз его не объявлять.

В общей ветке `else { state = reduceAction(state, action); … }`:

Заменить строку

```js
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success' && stillPicking) state = { ...state, tsd: { ...state.tsd, open: true, screen: 'builder' } };
```

на

```js
    // Сборку закрыл переезд к воротам; за остатком заявки она открывается снова.
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success' && stillPicking) state = { ...state, builderOpen: true, tsd: { ...state.tsd, open: true, screen: 'builder' } };
```

Удалить блок, который после принятия задания сам открывал сборку и машины:

```js
    if (queueShift && (action.type === 'ACCEPT_TASK' || action.type === 'TAKE_URGENT')) {
      const task = currentTaskFor(state);
      if (task?.kind === 'pick') state = { ...state, builderOpen: true, vehicleDrawerOpen: false, tsd: { ...state.tsd, open: true, screen: 'builder' } };
      if (task?.kind === 'unload') state = { ...state, vehicleDrawerOpen: true, builderOpen: false, tsd: { ...state.tsd, open: true, screen: 'vehicles' } };
    }
```

и комментарий над ним («Принятое задание сразу открывает свой экран…») заменить на:

```js
    /* Принятое задание экрана не открывает: игра везёт кладовщика на проезд
       или к воротам, а что нажать дальше, видно в кадре. */
```

В конце `dispatch` заменить

```js
  state = offerNextTask(state);
  render(state, document);
  return state;
```

на

```js
  state = offerNextTask(state);
  const moved = locationAfter(location, before, state, move);
  location = moved.location;
  passingFrame = moved.via;
  if (moved.via && typeof window.setTimeout === 'function') {
    const passed = moved.via;
    window.setTimeout(() => {
      if (passingFrame !== passed) return;
      passingFrame = null;
      render(state, document);
    }, PASS_MS);
  }
  render(state, document);
  return state;
```

- [ ] **Step 9: `app.js` — обработчик кликов**

В обработчике `document.addEventListener('click', …)` заменить блок `if (action === 'SELECT_ZONE') { … }` целиком на:

```js
  if (action === 'SELECT_ZONE') {
    /* Вывеска зоны в кадре проезда — это решение «куда ехать». Пока принятая
       паллета стоит на тележке, нажатие ставит её в эту зону; иначе
       кладовщик едет к полке. Кнопки зоны внутри сборки остаются фильтром. */
    const onScene = Boolean(button.dataset.sceneZone);
    if (onScene && terminalViewFor(state).awaitingPlacement) return dispatch({ type: 'PLACE_PALLET', zone: button.dataset.zone });
    if (onScene) return dispatch({ type: 'GO_SHELF', zone: button.dataset.zone });
    return dispatch({ type: action, zone: button.dataset.zone });
  }
  if (action === 'GATE') return dispatch({ type: action, zone: button.dataset.gateZone });
```

Заменить строку

```js
  if (action === 'LOAD_PALLET') return dispatch({ type: action, vehicleId: state.selectedVehicleId });
```

на

```js
  // Кнопка в сборке и в карточке «Сейчас» везёт к воротам; грузят сами ворота.
  if (action === 'LOAD_PALLET') return dispatch({ type: 'GO_SHIPPING' });
```

После строки `window.renderTsd = renderTsd;` добавить:

```js
window.fpLocation = () => location;
```

- [ ] **Step 10: Убедиться, что новые тесты проходят**

Run: `node --test tests/fp-interaction.test.js`
Expected: 10 PASS.

- [ ] **Step 11: Поправить существующий тест, который грузил паллету кнопкой**

Run: `node --test tests/*.test.js`
Expected: падает один тест — `a successful load reports through the toast and never takes over the terminal` в `tests/tsd-interaction.test.js`: кнопка `LOAD_PALLET` теперь только везёт к воротам.

В этом тесте после строки `click({ dataset: { action: 'LOAD_PALLET' }, disabled: false });` добавить:

```js
  // Кнопка привезла к воротам; грузят сами ворота зоны паллеты.
  click({ dataset: { action: 'GATE', gateZone: 'dry' }, disabled: false });
```

Run: `node --test tests/*.test.js`
Expected: 377 pass, 0 fail. Если падает ещё что-то — это тест, привязанный к прежнему поведению «принял задание — открылась сборка»; поправить его под новое правило (после `ACCEPT_TASK` добавить нажатие вывески нужной зоны) и записать название теста в сообщение коммита.

- [ ] **Step 12: Коммит**

```bash
git add app.js index.html tests/fp-interaction.test.js tests/scene-render.test.js tests/tsd-interaction.test.js tests/guide.test.js tests/live-kpis.test.js
git commit -m "Кладовщик переезжает между местами склада: зона и ворота — решения игрока"
```

---

### Task 4: Кадры и вид сцены

**Files:**
- Create: `assets/fp/hub-zones.webp`, `assets/fp/receiving.webp`, `assets/fp/shelf-dry.webp`, `assets/fp/shelf-chilled.webp`, `assets/fp/shelf-frozen.webp`, `assets/fp/shipping.webp`
- Modify: `index.html` (`<head>`: предзагрузка кадров)
- Modify: `styles.css` (правило `.scene-backdrop`; координаты `.scene-pallet`, `.scene-dock`, `.truck-bay`, `.scene-zone--*`; `.truck-timer`; новый блок в конце файла перед медиазапросами)
- Modify: `tests/static-ui.test.js` (три теста про старую фотографию)
- Test: `tests/fp-scene.test.js`

**Interfaces:**
- Consumes: атрибуты `data-location`, `data-shelf-zone`, `data-frame-parity` у `#warehouseScene` и классы `.scene-gate`, `.fp-nav`, `.fp-nav-button` из Task 3; `fpView.FRAMES` из Task 2.
- Produces: ничего для следующих задач.

Геометрия. Кадр 1024×1536 (2:3) вписан в сцену 780×998 через `object-fit: cover`: по ширине совпадает, по высоте видно 85,3 %. `object-position: 50% 62%` прячет 9,1 % кадра сверху (лампы уходят под шапку) и 5,6 % снизу (рукоять остаётся). Точка кадра на высоте `f` (доля от высоты кадра) попадает в сцену на высоту `(f × 1170 − 107) / 998`.

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/fp-scene.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { FRAMES, LOCATIONS } = require('../fp-view.js');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

test('every place has its frame on disk, light enough for a phone', () => {
  for (const location of LOCATIONS) {
    const path = FRAMES[location];
    assert.equal(fs.existsSync(path), true, `${path} must exist`);
    assert.ok(fs.statSync(path).size < 400_000, `${path} must stay below 400 KB`);
  }
});

test('the page preloads all six frames so a move never shows an empty scene', () => {
  for (const location of LOCATIONS) {
    assert.match(html, new RegExp(`<link rel="preload" as="image" href="${FRAMES[location]}"`));
  }
});

test('the scene shows the frame in two layers and starts in the aisle', () => {
  assert.match(html, /id="sceneBackdropPrev"/);
  assert.match(html, /id="sceneBackdrop"[^>]*data-frame="hub"/);
  assert.match(html, /id="warehouseScene"[^>]*data-location="hub"/);
  assert.doesNotMatch(html, /warehouse-center\.webp/);
});

test('each tap target is visible only in the frame it belongs to', () => {
  const hidden = (place, selector) => new RegExp(`\\.warehouse-scene:not\\(\\[data-location="${place}"\\]\\) ${selector.replace('.', '\\.')}[,\\s{]`);
  assert.match(css, hidden('hub', '.scene-zone-sign'));
  assert.match(css, hidden('receiving', '.scene-dock'));
  assert.match(css, hidden('shelf', '.scene-pallet'));
  assert.match(css, hidden('shelf', '.fp-nav'));
  assert.match(css, hidden('shipping', '.scene-gate'));
  assert.match(css, hidden('shipping', '.truck-bay'));
});

test('three gates stand in the order of the zones and carry the zone temperatures', () => {
  const order = ['dry', 'chilled', 'frozen'].map((zone) => html.indexOf(`data-gate-zone="${zone}"`));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const left = (zone) => Number(css.match(new RegExp(`\\.scene-gate--${zone}\\s*\\{[^}]*left:\\s*([\\d.]+)%`))[1]);
  assert.ok(left('dry') < left('chilled') && left('chilled') < left('frozen'));
  // Те же места по горизонтали, что и у вывесок зон: жёлтое слева, синее справа.
  const signLeft = (zone) => Number(css.match(new RegExp(`\\.scene-zone--${zone}\\s*\\{[^}]*left:\\s*([\\d.]+)%`))[1]);
  assert.ok(signLeft('dry') < signLeft('chilled') && signLeft('chilled') < signLeft('frozen'));
});

test('the departure timer is no longer inside the trucks button', () => {
  const truck = html.slice(html.indexOf('id="sceneTruckBay"'));
  assert.doesNotMatch(truck.slice(0, truck.indexOf('</button>')), /id="truckTimer"/);
  assert.match(html, /id="truckTimer"/);
});

test('frame change is animated and reduced motion switches it off', () => {
  assert.match(css, /\[data-frame-parity="0"\] \.scene-backdrop:not\(\.scene-backdrop--prev\)\s*\{[^}]*animation:\s*fp-enter-a 400ms/);
  assert.match(css, /\[data-frame-parity="1"\] \.scene-backdrop:not\(\.scene-backdrop--prev\)\s*\{[^}]*animation:\s*fp-enter-b 400ms/);
  const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotion, /\.scene-backdrop\s*\{[^}]*animation:\s*none\s*!important/);
});

test('nothing in the frame scene hints at the placement zone', () => {
  // Подсветка «верных» ворот есть, «верной» зоны — нет.
  assert.match(css, /\.scene-gate\.is-focus/);
  assert.doesNotMatch(css, /\.scene-zone-sign\.is-right/);
  assert.doesNotMatch(fs.readFileSync('app.js', 'utf8'), /pending\.zone|inbound\.zone/);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/fp-scene.test.js`
Expected: FAIL — файлов `assets/fp/*.webp` нет, правил в CSS нет.

- [ ] **Step 3: Положить кадры**

```bash
mkdir -p assets/fp
cp docs/redesign/first-person/hub-zones.webp assets/fp/hub-zones.webp
cp docs/redesign/first-person/receiving.webp assets/fp/receiving.webp
cp docs/redesign/first-person/shelf-dry.webp assets/fp/shelf-dry.webp
cp docs/redesign/first-person/shelf-chilled.webp assets/fp/shelf-chilled.webp
cp docs/redesign/first-person/shelf-frozen-v2.webp assets/fp/shelf-frozen.webp
cp docs/redesign/first-person/shipping.webp assets/fp/shipping.webp
ls -la assets/fp
```

Expected: шесть файлов, каждый меньше 400 000 байт (самый тяжёлый — `shelf-frozen.webp`, около 365 КБ).

- [ ] **Step 4: Предзагрузка в `index.html`**

В `<head>` после строки `<link rel="stylesheet" href="styles.css?v=guide" />` добавить:

```html
  <link rel="preload" as="image" href="assets/fp/hub-zones.webp" />
  <link rel="preload" as="image" href="assets/fp/receiving.webp" />
  <link rel="preload" as="image" href="assets/fp/shelf-dry.webp" />
  <link rel="preload" as="image" href="assets/fp/shelf-chilled.webp" />
  <link rel="preload" as="image" href="assets/fp/shelf-frozen.webp" />
  <link rel="preload" as="image" href="assets/fp/shipping.webp" />
```

- [ ] **Step 5: `styles.css` — кадр и координаты**

В правиле `.warehouse-scene { … }` заменить комментарий о кадрировании на:

```css
  /* Цель — экран iPhone: при ширине 390pt сцена занимает 499px, оставляя
     место ряду кнопок и ТСД. Кадр 2:3 выше сцены, поэтому он обрезается по
     высоте; какая его полоса видна, задаёт object-position ниже, и проценты
     в координатах областей нажатия пересчитаны под эту полосу. Менять одно
     без другого нельзя. */
```

В правиле `.scene-backdrop { … }` заменить две последние строки (комментарий про 21.4% и `object-position: 50% 21.4%;`) на:

```css
  /* 62% по вертикали прячет 9% кадра сверху — лампы уходят под шапку — и
     6% снизу: рукоять тележки остаётся в кадре. */
  object-position: 50% 62%;
```

Заменить координаты вывесок зон (строки `.scene-zone--dry { top: 33%; left: 13%; }` и две следующие) на:

```css
/* Вывески стоят над проёмами зон в кадре проезда. */
.scene-zone--dry { top: 34%; left: 15%; }
.scene-zone--chilled { top: 34%; left: 50%; }
.scene-zone--frozen { top: 34%; left: 85%; }
```

Заменить `.scene-pallet { top: 76.4%; left: 28%; width: 21%; height: 20.8%; }` и комментарий над ней на:

```css
/* Пустая паллета на вилах тележки внизу кадра полки. */
.scene-pallet { top: 77%; left: 15%; width: 68%; height: 21%; }
```

Заменить `.scene-dock { top: 74%; left: 2%; width: 22%; height: 22%; }` и комментарий над ней на:

```css
/* Открытый кузов фуры в кадре приёмки. */
.scene-dock { top: 22%; left: 15%; width: 70%; height: 33%; }
```

Заменить `.truck-bay { top: 56.9%; left: 73%; width: 27%; height: 15.3%; }` и комментарий над ней на:

```css
/* «Машины и маршрут» — на полу перед воротами в кадре отгрузки. */
.truck-bay { top: 58%; left: 36%; width: 28%; height: 9%; }
```

В правиле `.truck-timer { … }` заменить `position: absolute; top: calc(100% + 30px); right: 0;` на `position: absolute; z-index: 4; top: 110px; right: 12px;`.

- [ ] **Step 6: `styles.css` — блок вида от первого лица**

Перед первым `@media (max-width: 390px)` добавить:

```css
/* Вид от первого лица. В кадре видны только области того места, где сейчас
   кладовщик: вывески зон — на проезде, кузов — на приёмке, паллета и
   переезды — у полки, ворота и машины — на отгрузке. */
.warehouse-scene:not([data-location="hub"]) .scene-zone-sign,
.warehouse-scene:not([data-location="receiving"]) .scene-dock,
.warehouse-scene:not([data-location="shelf"]) .scene-pallet,
.warehouse-scene:not([data-location="shelf"]) .fp-nav,
.warehouse-scene:not([data-location="shipping"]) .scene-gate,
.warehouse-scene:not([data-location="shipping"]) .truck-bay { display: none; }

/* Прежний кадр лежит под новым, пока тот проявляется. */
.scene-backdrop--prev { z-index: -5; }
/* Наезд: новый кадр чуть увеличен и проявляется. Два одинаковых ключевых
   кадра под разными именами — смена имени перезапускает анимацию. */
[data-frame-parity="0"] .scene-backdrop:not(.scene-backdrop--prev) { animation: fp-enter-a 400ms ease-out; }
[data-frame-parity="1"] .scene-backdrop:not(.scene-backdrop--prev) { animation: fp-enter-b 400ms ease-out; }
@keyframes fp-enter-a { from { opacity: 0; transform: scale(1.08); } }
@keyframes fp-enter-b { from { opacity: 0; transform: scale(1.08); } }

/* Нажать можно на весь проём зоны, а не только на вывеску над ним. */
[data-location="hub"] .scene-zone-sign::before { position: absolute; top: -70px; right: -30px; bottom: -110px; left: -30px; content: ""; }

/* Ворота отгрузки выглядят как вывески зон: та же температура, тот же цвет. */
.scene-gate {
  position: absolute;
  z-index: 3;
  top: 34%;
  display: grid;
  gap: 1px;
  min-width: 64px;
  min-height: 44px;
  padding: 5px 9px;
  border: 1px solid rgba(244, 234, 216, 0.3);
  border-radius: 12px;
  background: rgba(13, 24, 19, 0.88);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  color: var(--cream);
  text-align: center;
  cursor: pointer;
  transform: translate(-50%, -50%);
}
.scene-gate b { font-size: 15px; font-variant-numeric: tabular-nums; }
.scene-gate small { font-size: 9px; font-weight: 750; letter-spacing: 0.04em; text-transform: uppercase; }
.scene-gate::before { position: absolute; top: -60px; right: -24px; bottom: -40px; left: -24px; content: ""; }
.scene-gate--dry { left: 17%; }
.scene-gate--dry b { color: var(--amber); }
.scene-gate--chilled { left: 50.5%; }
.scene-gate--chilled b { color: var(--chilled); }
.scene-gate--frozen { left: 83%; }
.scene-gate--frozen b { color: var(--frozen); }
/* Во вводных сменах верные ворота подсвечены. У зон размещения такой
   подсветки нет и быть не должно. */
.scene-gate.is-focus { border-color: var(--amber); box-shadow: 0 0 0 3px rgba(240, 170, 56, 0.45), 0 0 26px rgba(240, 170, 56, 0.45); animation: focus-pulse 1.4s ease-in-out infinite; }
.scene-gate:focus-visible { outline: 3px solid var(--amber); outline-offset: 3px; }

/* Переезды от полки: на полу между стеллажом и паллетой. */
.fp-nav { position: absolute; z-index: 3; top: 66%; right: 12px; left: 12px; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
.fp-nav-button { min-height: 44px; padding: 0 14px; border: 1px solid rgba(244, 234, 216, 0.3); border-radius: 999px; background: rgba(13, 24, 19, 0.88); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); color: var(--cream); font-size: 13px; font-weight: 800; cursor: pointer; pointer-events: auto; }
.fp-nav-button--go { margin-left: auto; border-color: var(--amber); background: var(--amber); color: #1a1407; }
```

В блоке `@media (prefers-reduced-motion: reduce) { … }` добавить внутрь:

```css
  .scene-backdrop { animation: none !important; }
  .scene-gate.is-focus { animation: none !important; outline: 3px solid var(--amber); outline-offset: 3px; }
```

- [ ] **Step 7: Убедиться, что новые тесты проходят**

Run: `node --test tests/fp-scene.test.js`
Expected: 8 PASS.

- [ ] **Step 8: Обновить три теста про старую фотографию в `tests/static-ui.test.js`**

Run: `node --test tests/static-ui.test.js`
Expected: падают три теста.

В тесте `living warehouse shell keeps product vocabulary and scene layers` заменить строку

```js
  assert.match(html, /assets\/warehouse-center\.webp/);
```

на

```js
  // Подложка сцены — кадр от первого лица; смена начинается на проезде.
  assert.match(html, /assets\/fp\/hub-zones\.webp/);
```

Тест `warehouse backdrop is an optimized mobile asset` удалить целиком: размер кадров проверяет `tests/fp-scene.test.js`.

В тесте `the scene keeps the backdrop aspect ratio so percentages stay on the photo` заменить комментарий про 780x1386 и последнюю проверку на:

```js
  // Кадры 1024x1536 выше сцены и обрезаются по высоте. Как только пропорции
  // контейнера или видимая полоса кадра меняются, области нажатия уезжают
  // с предметов на картинке.
  assert.match(scene, /aspect-ratio:\s*780\s*\/\s*998/);
  assert.doesNotMatch(scene.slice(0, scene.indexOf('}')), /height:\s*clamp/);
  assert.match(css, /\.scene-backdrop\s*\{[^}]*object-position:\s*50%\s*62%/s);
```

(Две первые проверки уже есть в тесте — оставить по одной.)

Run: `node --test tests/*.test.js`
Expected: 384 pass, 0 fail.

- [ ] **Step 9: Посмотреть в браузере**

Открыть `index.html` в браузере в мобильной ширине (390×844). Пройти первую смену:

1. «Начать смену» — виден проезд с тремя зонами, из вывесок видна только «+18° Сухач».
2. Кнопка карточки «Собрать паллету» — наезд, полка сухой зоны, открыта сборка.
3. Набрать две воды, «Погрузить в фургон» — кадр отгрузки, над левыми воротами вывеска «+18° Сухач» с подсветкой.
4. Нажать вывеску — тост «…в кузов…», счётчик «Отгружено» вырос.

Проверить, что вывески стоят над своими проёмами и воротами, паллета-кнопка лежит на паллете, плашка срока не налезает на показатели. Если область съехала — править только проценты в `styles.css` из Step 5–6.

- [ ] **Step 10: Коммит**

```bash
git add assets/fp index.html styles.css tests/fp-scene.test.js tests/static-ui.test.js
git commit -m "Шесть кадров от первого лица вместо схемы склада"
```

---

### Task 5: Слова на экране и документы

**Files:**
- Modify: `scene-view.js` (три строки `actionLabel: 'Погрузить в фургон'`; текст шага размещения)
- Modify: `index.html` (кнопка сборки, строка 226; текст гайда, строки 248–256)
- Modify: `app-state.js` (текст тоста после приёмки)
- Modify: `tests/guide.test.js` (список обязательных слов гайда)
- Modify: `docs/HANDOFF.md`, `docs/redesign/README.md`, `docs/superpowers/specs/2026-11-15-first-person-view-design.md`

**Interfaces:**
- Consumes: всё из Task 1–4.
- Produces: ничего.

- [ ] **Step 1: Обновить тест гайда**

В `tests/guide.test.js` в тесте `game shell provides a reachable, accessible guide with the core shift steps` заменить список слов на:

```js
  for (const label of ['Как играть?', 'Принять паллету', 'вывеску нужной зоны', 'К отгрузке', 'ворота', 'остановок', 'Заверши смену']) {
```

Run: `node --test tests/guide.test.js`
Expected: FAIL — в гайде нет «К отгрузке» и «ворота».

- [ ] **Step 2: Подписи кнопок**

В `scene-view.js` все три вхождения `actionLabel: 'Погрузить в фургон',` заменить на `actionLabel: 'К отгрузке',`.

Там же в шаге `key: 'place'` заменить `detail: 'Выберите зону на схеме сами. Чужая температура испортит товар',` на `detail: 'Выберите зону сами: нажмите её вывеску. Чужая температура испортит товар',`.

В `index.html` в строке 226 заменить `<button class="btn" data-action="LOAD_PALLET">Погрузить в фургон</button>` на `<button class="btn" data-action="LOAD_PALLET">К отгрузке</button>`.

В `app-state.js` заменить текст `'Паллета принята. Выберите зону на схеме — нажмите вывеску.'` на `'Паллета принята. Выберите зону — нажмите её вывеску.'`.

- [ ] **Step 3: Текст гайда**

В `index.html` заменить абзац `<p class="guide-intro">…</p>` и список `<ol class="guide-steps">…</ol>` на:

```html
                <p class="guide-intro">Ты — кладовщик на электротележке и видишь то место склада, где сейчас работаешь. На первых двух сменах следующий шаг написан в карточке «Сейчас» под кадром, и её кнопка сама везёт куда нужно. Дальше работу выдаёт ТСД — по одному заданию; первым он даёт то, чья машина уходит раньше. Срочное задание можно взять поверх начатого, но собранное вернётся на полку. Доска под кадром показывает заявки и сколько осталось до ухода машины.</p>
                <ol class="guide-steps">
                  <li><strong>Разбери приёмку.</strong> Если у ворот стоит фура, ТСД покажет накладную. Нажми «Принять паллету», а потом на проезде — вывеску нужной зоны. Зону никто не подскажет: реши сам, какая температура нужна товару. Ошибка портит паллету.</li>
                  <li><strong>Собери паллету по заявке.</strong> На проезде нажми зону, в которой лежит товар заявки, — тележка подъедет к полке. Кнопкой «+» набери количество. Приехал не туда — вернись кнопкой «На проезд».</li>
                  <li><strong>Отвези её к машине.</strong> Нажми «К отгрузке», а там — ворота с температурой паллеты. Чужая машина паллету не возьмёт. Адрес сразу попадает в маршрут.</li>
                  <li><strong>Если заявка не влезает</strong> в одну паллету или машину, отвези что набралось: тележка сама вернётся к полке за остатком.</li>
                  <li><strong>Проверь порядок остановок.</strong> У отгрузки нажми «Машины»: стрелками можно переставить адреса. Чем короче рейс, тем выше «Вовремя».</li>
                  <li><strong>Если заявку отменили</strong>, а её паллета уже в кузове, нажми ворота этой машины и сними паллету: лишний груз режет «Точность» и удлиняет рейс.</li>
                  <li><strong>Заверши смену</strong> кнопкой под кадром. Ждать таймер не нужно.</li>
                </ol>
```

- [ ] **Step 4: Убедиться, что всё зелёное**

Run: `node --test tests/*.test.js`
Expected: 384 pass, 0 fail. Если тест из `tests/next-step.test.js` или `tests/guide.test.js` сверяет прежний текст («Погрузить в фургон», «на схеме») — заменить ожидаемую строку на новую из Step 2–3.

- [ ] **Step 5: Документы**

В `docs/HANDOFF.md`:

- в разделе «Открытые вопросы» заменить пункты «Вид игры» и «Подложка склада» на один:

```markdown
- **Вид игры решён: от первого лица.** Шесть кадров глазами кладовщика на
  электротележке, см. `docs/superpowers/specs/2026-11-15-first-person-view-design.md`.
  Варианты А–Г из `docs/redesign/` отвергнуты. Не доделано: кадр заморозки
  фотографичнее остальных, лампа над воротами приёмки жёлтая (цвет сухой
  зоны) — оба перегенерировать.
```

- в раздел «Решения, которые принял владелец продукта» добавить пункты:

```markdown
9. **Игрок смотрит глазами кладовщика.** Не схема сверху и не один кадр всего
   склада.
10. **На складе нет конвейеров и роботов.** Паллету возит человек на
    электротележке без мачты; фуры на приёмке и отгрузке одного размера.
11. **Игра везёт сама туда, где выбирать нечего.** Игрок выбирает зону и
    ворота отгрузки. Чужие ворота паллету не берут, штрафа нет.
```

- в таблицу «Как устроен код» добавить строку `| \`fp-view.js\` | где сейчас кладовщик и какой кадр показать | нет |`.
- в строке с числом тестов заменить `352` на `384`.

В начало `docs/redesign/README.md` после заголовка добавить:

```markdown
> Направление выбрано, и это не один из вариантов ниже: вид от первого лица,
> см. `docs/superpowers/specs/2026-11-15-first-person-view-design.md` и кадры
> в `first-person/`. Варианты А–Г оставлены как история.
```

В спецификации `docs/superpowers/specs/2026-11-15-first-person-view-design.md` поправить три места, где реализация разошлась с текстом:

- в таблице «Куда нажимать» строку «Полка | Паллета внизу или стеллаж | `OPEN_BUILDER`…» заменить на `| Полка | Паллета внизу | \`OPEN_BUILDER\` — нынешняя панель сборки. У верной полки сборка открывается сама по приезде |`;
- в разделе «Перемещение», шаг 2 сборки: заменить «товар заявки на паллету не кладётся (сообщение «Этот товар нужно собирать в другой зоне» уже есть)» на «сборка не открывается, игра говорит, что товара заявки здесь нет»;
- в разделе «Код» заменить пункт про `FRAMES` на «`FRAMES` — таблица кадров: место и файл. Области нажатия заданы в `styles.css` по атрибуту `data-location` сцены», а в разделе «Проверка» — «у каждого кадра есть файл и области нажатия в пределах 0–100 %» на «у каждого кадра есть файл на диске; каждая область нажатия видна только в своём кадре».

- [ ] **Step 6: Коммит**

```bash
git add scene-view.js index.html app-state.js tests/guide.test.js docs/HANDOFF.md docs/redesign/README.md docs/superpowers/specs/2026-11-15-first-person-view-design.md
git commit -m "Гайд, подписи и записка — под вид от первого лица"
```

- [ ] **Step 7: Ручная проверка владельцем продукта**

Открыть `index.html` в браузере. Пройти смену 1 (вводная), смену 2 (три фуры на приёмке — проверить, что ни одна зона не подсвечена при размещении) и смену 3 (очередь ТСД, машина охлаждёнки уходит через 15 секунд). Записать, успевается ли заявка охлаждёнки в срок: к каждой сборке добавились нажатие зоны, «К отгрузке» и ворота. Если не успевается — сроки в `levels.js` править отдельной задачей, не в этой.

# TSD Warehouse Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace warehouse-blocking panels with a realistic handheld TSD flow while preserving the existing campaign, pallet, vehicle, routing, scoring, and spoilage rules.

**Architecture:** Keep `app-state.js` as the source of game and UI state, add a pure `tsd-view.js` mapper for terminal presentation, and render one semantic TSD shell around the existing briefing, builder, vehicle, feedback, and task content. Keep the warehouse scene and its interactive hit targets separate from decorative layers so hidden UI can never intercept taps.

**Tech Stack:** Vanilla HTML, CSS, JavaScript UMD modules, Node.js built-in test runner, WebP raster assets, built-in ImageGen for realistic asset creation.

**Spec:** `docs/superpowers/specs/2026-09-17-tsd-warehouse-interface-design.md`

## Global Constraints

- Do not change the three zones, level balance, scoring, route calculation, pallet/vehicle capacity, spoilage rules, or campaign order.
- One pallet still belongs to exactly one darkstore; one vehicle still belongs to exactly one zone.
- Use the exact Russian labels `Сухач`, `Охлаждёнка`, and `Заморозка` from `levels.js`.
- Closed TSD, decorative workers, background AGVs, lighting, and the backdrop must not intercept warehouse taps.
- Every interactive target must have a minimum 44 × 44 CSS-pixel hit area and an accurate accessible name.
- All repeated motion must stop under `prefers-reduced-motion: reduce`.
- Every task follows red-green-refactor and ends with its own commit.
- Run the complete test suite with `node --test tests/*.test.js` before finishing the branch.

---

## File Structure

- Create `tsd-view.js`: pure mapper from application state to TSD presentation data; no DOM access.
- Create `tsd-signal.js`: pure notification adapter for haptic and audio capabilities.
- Create `tests/tsd-view.test.js`: terminal task selection, screen modes, Russian labels, progress, and feedback tests.
- Create `tests/tsd-interaction.test.js`: real click-dispatch contract using the existing VM DOM harness.
- Create `assets/tsd-handheld.webp`: realistic transparent handheld TSD foreground asset.
- Create `assets/pallet-active.webp`: realistic transparent active pallet asset.
- Create `assets/agv-active.webp`: realistic transparent AGV asset.
- Create `assets/truck-active.webp`: realistic transparent vehicle/loading-bay asset.
- Modify `app-state.js`: add TSD UI state and task-acceptance actions without changing logistics reducers.
- Modify `app.js`: render the TSD view, route object taps, and trigger bounded sound/vibration effects.
- Modify `index.html`: replace mission ribbon and independent modal surfaces with one semantic TSD shell; retain existing IDs used by game rendering.
- Modify `styles.css`: TSD geometry, realistic object sprites, rack signs, layer ownership, hit areas, responsive states, and reduced-motion behavior.
- Modify `scene-view.js`: expose object-highlight/error state needed by the scene without duplicating TSD copy.
- Modify `tests/app-state.test.js`, `tests/scene-render.test.js`, `tests/static-ui.test.js`, `tests/ui-command-contract.test.js`, `tests/guide.test.js`: protect the new state and interaction boundaries.
- Modify `README.md`: document the TSD interaction model and refreshed mobile QA screenshot.
- Replace `docs/screenshots/living-warehouse-mobile.png`: capture the implemented mobile state with the compact TSD visible.

---

### Task 1: Add TSD Task-Acceptance State

**Files:**
- Modify: `app-state.js`
- Modify: `tests/app-state.test.js`
- Modify: `tests/shift-flow.test.js`

**Interfaces:**
- Produces state field: `tsd: { open: boolean, screen: 'briefing' | 'task' | 'current' | 'feedback' | 'report', acceptedOrderId: string | null, signal: 'new' | 'idle' | 'success' | 'error' }`
- Produces reducer actions: `OPEN_TSD`, `CLOSE_TSD`, `SHOW_TSD_TASK`, `ACCEPT_TASK`.
- Preserves direct logistics actions (`ADD_ITEM`, `LOAD_PALLET`, `SET_ROUTE`) so balance tests and game rules remain unchanged.

- [ ] **Step 1: Write failing tests for initial TSD state and accepting a task**

Append to `tests/app-state.test.js`:

```js
const { startLevel } = require('../app-state.js');

test('a level starts with its briefing on the TSD instead of an independent overlay', () => {
  const state = startLevel(1);
  assert.deepEqual(state.tsd, {
    open: true,
    screen: 'briefing',
    acceptedOrderId: null,
    signal: 'new',
  });
});

test('accepting the pending task closes the TSD and records exactly one order', () => {
  const briefing = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  const task = reduceAction(briefing, { type: 'SHOW_TSD_TASK' });
  const accepted = reduceAction(task, { type: 'ACCEPT_TASK' });
  const duplicate = reduceAction(accepted, { type: 'ACCEPT_TASK' });

  assert.equal(accepted.phase, 'shift');
  assert.equal(accepted.tsd.open, false);
  assert.equal(accepted.tsd.screen, 'current');
  assert.equal(accepted.tsd.acceptedOrderId, accepted.orders[0].id);
  assert.deepEqual(duplicate.tsd, accepted.tsd);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/app-state.test.js
```

Expected: FAIL because `state.tsd` and `ACCEPT_TASK` do not exist.

- [ ] **Step 3: Add terminal-state helpers and reducer branches**

Add near the existing helpers in `app-state.js`:

```js
const activeOrderFor = (state) => {
  const active = (state.orders || []).filter((order) => !order.cancelled);
  return active.find((order) => !(state.loadedPallets || []).some((pallet) => pallet.storeId === order.storeId)) || active[0] || null;
};

const initialTsdState = () => ({
  open: true,
  screen: 'briefing',
  acceptedOrderId: null,
  signal: 'new',
});
```

Set `tsd: initialTsdState()` in `startLevel`. Add these branches before logistics actions:

```js
if (action.type === 'OPEN_TSD') return { ...state, tsd: { ...state.tsd, open: true } };
if (action.type === 'CLOSE_TSD') return { ...state, tsd: { ...state.tsd, open: false } };
if (action.type === 'SHOW_TSD_TASK') {
  return { ...state, tsd: { ...state.tsd, open: true, screen: 'task', signal: 'new' } };
}
if (action.type === 'ACCEPT_TASK') {
  if (state.tsd?.acceptedOrderId) return state;
  const order = activeOrderFor(state);
  if (!order) return { ...state, tsd: { ...state.tsd, open: false, screen: 'current', signal: 'idle' } };
  return {
    ...state,
    tsd: { open: false, screen: 'current', acceptedOrderId: order.id, signal: 'idle' },
  };
}
```

Change the `CONTINUE_STORY` briefing branch to keep the warehouse visible and move the next step to TSD task mode:

```js
if (state.phase === 'briefing') {
  return {
    ...state,
    phase: 'shift',
    story: null,
    tsd: { ...state.tsd, open: true, screen: 'task', signal: 'new' },
  };
}
```

- [ ] **Step 4: Mark the next active task after a successful pallet load**

In the successful `LOAD_PALLET` state result, preserve all existing fields and set:

```js
tsd: {
  open: false,
  screen: 'current',
  acceptedOrderId: null,
  signal: 'success',
},
```

Do not add acceptance checks to `ADD_ITEM`, `LOAD_PALLET`, or scoring functions; acceptance gates the UI entry point, not the logistics engine.

- [ ] **Step 5: Run state and campaign tests**

Run:

```bash
node --test tests/app-state.test.js tests/shift-flow.test.js tests/balance.test.js
```

Expected: PASS, including every existing winnability test.

- [ ] **Step 6: Commit the state boundary**

```bash
git add app-state.js tests/app-state.test.js tests/shift-flow.test.js
git commit -m "feat: add TSD task acceptance state"
```

---

### Task 2: Create the Pure TSD View Mapper

**Files:**
- Create: `tsd-view.js`
- Create: `tests/tsd-view.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: application state containing `tsd`, `orders`, `pallet`, `feedback`, `story`, `report`, and `levelId`.
- Produces: `window.RyabinovayaTsdView.terminalViewFor(state)` and CommonJS export `{ terminalViewFor }`.
- `terminalViewFor` returns `{ open, screen, signal, title, storeName, orderText, zoneName, progressText, message, canAccept }`.

- [ ] **Step 1: Write the failing mapper tests**

Create `tests/tsd-view.test.js`:

```js
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
});

test('task view names the store, goods and Russian zone', () => {
  const state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  const view = terminalViewFor(state);
  assert.equal(view.title, 'Новое задание');
  assert.equal(view.storeName, 'Северный');
  assert.equal(view.orderText, 'Вода 1,5 л · 2 шт.');
  assert.equal(view.zoneName, 'Сухач');
  assert.equal(view.canAccept, true);
});

test('current view reports pallet progress without changing task data', () => {
  let state = reduceAction(startLevel(1), { type: 'CONTINUE_STORY' });
  state = reduceAction(state, { type: 'ACCEPT_TASK' });
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 1 });
  assert.equal(terminalViewFor(state).progressText, '12 / 100 кг');
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
```

- [ ] **Step 2: Run the mapper tests and verify RED**

```bash
node --test tests/tsd-view.test.js
```

Expected: FAIL with `Cannot find module '../tsd-view.js'`.

- [ ] **Step 3: Implement `terminalViewFor` as a UMD module**

Create `tsd-view.js` with the same wrapper pattern as `scene-view.js`. Use `STORE_NAMES`, `ZONE_NAMES`, and `engine.itemBySku` instead of duplicating labels. The function must prioritize screens in this order: report/story, explicit error feedback, briefing, task, current.

Core return logic:

```js
const progressText = `${state.pallet?.weight || 0} / ${state.pallet?.capacity || 100} кг`;
const order = acceptedOrderFor(state) || activeOrderFor(state);
const item = order ? engine.itemBySku(order.sku) : null;
const signal = state.feedback?.kind === 'error' ? 'error' : (state.tsd?.signal || 'idle');

return {
  open: Boolean(state.tsd?.open),
  screen,
  signal,
  title,
  storeName: order ? STORE_NAMES[order.storeId] || order.storeId : '',
  orderText: order ? `${item?.name || order.sku} · ${order.quantity} шт.` : '',
  zoneName: order ? ZONE_NAMES[order.zone] || order.zone : '',
  progressText,
  message,
  canAccept: screen === 'task' && Boolean(order),
};
```

- [ ] **Step 4: Load the module before `app.js`**

In `index.html`, add:

```html
<script src="tsd-view.js"></script>
```

immediately after `scene-view.js` and before `app.js`.

- [ ] **Step 5: Run mapper and full regression tests**

```bash
node --test tests/tsd-view.test.js tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the mapper**

```bash
git add tsd-view.js index.html tests/tsd-view.test.js
git commit -m "feat: derive TSD screens from game state"
```

---

### Task 3: Build One Semantic TSD Shell and Restore Reliable Taps

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Create: `tests/tsd-interaction.test.js`
- Modify: `tests/ui-command-contract.test.js`
- Modify: `tests/scene-render.test.js`

**Interfaces:**
- Consumes: `terminalViewFor(state)` from Task 2.
- Produces DOM IDs: `tsdDevice`, `tsdBackdrop`, `tsdScreen`, `tsdTitle`, `tsdStore`, `tsdOrder`, `tsdZone`, `tsdProgress`, `tsdMessage`, `tsdAccept`.
- Produces `renderTsd(view, document)` exported as `window.renderTsd` for tests.
- Retains existing action names and adds `OPEN_TSD`, `CLOSE_TSD`, `ACCEPT_TASK`.

- [ ] **Step 1: Write a failing real-dispatch interaction test**

Create `tests/tsd-interaction.test.js` by reusing the fake document shape from `tests/scene-render.test.js`, but store the click listener passed to `document.addEventListener`. Add this behavior test:

```js
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
```

The fake click helper must pass `{ target: { closest: () => target } }` to the registered real app click handler; do not invoke `dispatch` directly.

- [ ] **Step 2: Run the interaction test and verify RED**

```bash
node --test tests/tsd-interaction.test.js
```

Expected: FAIL because the TSD DOM and render function do not exist.

- [ ] **Step 3: Replace the mission ribbon with the TSD shell**

Remove `.mission-ribbon` markup from `index.html`. Add after `.scene-hud`:

```html
<div class="tsd-backdrop" id="tsdBackdrop" aria-hidden="true"></div>
<section class="tsd-device" id="tsdDevice" data-open="true" data-screen="briefing" data-signal="new" aria-label="Терминал сбора данных">
  <button class="tsd-hardware" data-action="OPEN_TSD" aria-label="Открыть ТСД">
    <span class="tsd-indicator" aria-hidden="true"></span>
    <span class="tsd-compact-copy" id="tsdCompactCopy">Новое задание</span>
  </button>
  <div class="tsd-screen" id="tsdScreen" role="dialog" aria-modal="true" aria-labelledby="tsdTitle">
    <button class="tsd-close" data-action="CLOSE_TSD" aria-label="Убрать ТСД">×</button>
    <small class="tsd-kicker">Рябиновая · ТСД</small>
    <h2 id="tsdTitle">Новая смена</h2>
    <strong id="tsdStore"></strong>
    <p id="tsdOrder"></p>
    <p id="tsdZone"></p>
    <p id="tsdProgress"></p>
    <p id="tsdMessage" role="status"></p>
    <button class="tsd-primary" id="tsdAccept" data-action="ACCEPT_TASK">Принять</button>
    <div class="tsd-content-slot" id="tsdContentSlot"></div>
  </div>
</section>
```

- [ ] **Step 4: Render TSD attributes and accessible visibility**

In `app.js`, import `terminalViewFor` and add:

```js
function renderTsd(view, document) {
  const device = byId(document, 'tsdDevice');
  device.dataset.open = String(view.open);
  device.dataset.screen = view.screen;
  device.dataset.signal = view.signal;
  byId(document, 'tsdBackdrop').setAttribute('aria-hidden', String(!view.open));
  byId(document, 'tsdScreen').setAttribute('aria-hidden', String(!view.open));
  byId(document, 'tsdTitle').textContent = view.title;
  byId(document, 'tsdStore').textContent = view.storeName;
  byId(document, 'tsdOrder').textContent = view.orderText;
  byId(document, 'tsdZone').textContent = view.zoneName ? `Зона: ${view.zoneName}` : '';
  byId(document, 'tsdProgress').textContent = view.progressText;
  byId(document, 'tsdMessage').textContent = view.message;
  byId(document, 'tsdAccept').hidden = !view.canAccept;
  byId(document, 'warehouseScene').setAttribute('aria-hidden', 'false');
}
```

Call `renderTsd(terminalViewFor(nextState), document)` from `render`, expose `window.renderTsd`, and route `OPEN_TSD`, `CLOSE_TSD`, and `ACCEPT_TASK` through the existing dispatcher.

Keep `let tsdReturnFocus = null` beside the app UI state. Before dispatching `OPEN_TSD`, store the activating element. After `CLOSE_TSD` or `ACCEPT_TASK`, call `tsdReturnFocus?.focus()` and clear the reference. This restores keyboard and assistive-technology focus to the warehouse object that opened the device.

- [ ] **Step 5: Establish non-overlapping pointer ownership in CSS**

Implement these exact rules before visual polish:

```css
.scene-backdrop,
.scene-shade,
.ambient-traffic,
.scene-route { pointer-events: none; }

.tsd-backdrop { display: none; }
.tsd-device { pointer-events: none; }
.tsd-hardware { pointer-events: auto; }
.tsd-screen { display: none; pointer-events: none; }

.tsd-device[data-open="true"] { pointer-events: auto; }
.tsd-device[data-open="true"] + .tsd-backdrop,
.tsd-device[data-open="true"] .tsd-screen { display: block; pointer-events: auto; }
```

Because the backdrop appears before the device in HTML, use explicit z-index values (`tsdBackdrop: 18`, `tsdDevice: 19`) instead of relying on the adjacent-sibling selector if DOM order differs.

- [ ] **Step 6: Update command-contract assertions**

In `tests/ui-command-contract.test.js`, assert the new actions appear in the shell:

```js
for (const action of ['OPEN_TSD', 'CLOSE_TSD', 'ACCEPT_TASK', 'OPEN_BUILDER', 'OPEN_VEHICLES']) {
  assert.match(html, new RegExp(`data-action="${action}"`));
}
```

- [ ] **Step 7: Run interaction and regression tests**

```bash
node --test tests/tsd-interaction.test.js tests/scene-render.test.js tests/ui-command-contract.test.js tests/*.test.js
```

Expected: all tests PASS and no fake test calls `window.dispatch` directly for click reachability.

- [ ] **Step 8: Commit the semantic interaction shell**

```bash
git add index.html app.js styles.css tests/tsd-interaction.test.js tests/ui-command-contract.test.js tests/scene-render.test.js
git commit -m "feat: make the warehouse controllable through TSD"
```

---

### Task 4: Move Briefing, Builder, Vehicle, Feedback, and Report Into the TSD

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tests/guide.test.js`
- Modify: `tests/shift-flow.test.js`
- Modify: `tests/static-ui.test.js`

**Interfaces:**
- Consumes: one `tsdContentSlot` and existing content IDs (`itemRows`, `vehicleRows`, `routeStops`, report IDs).
- Produces screen names: `briefing`, `task`, `current`, `builder`, `vehicles`, `feedback`, `report`, `guide`.
- Preserves all existing `data-action` command names for logistics and navigation.

- [ ] **Step 1: Write failing visibility tests for the single-modal rule**

Add to `tests/guide.test.js`:

```js
test('briefing and guide are TSD screens rather than competing modal backdrops', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.doesNotMatch(html, /id="levelBriefing"[^>]*class="modal-backdrop"/);
  assert.doesNotMatch(html, /id="guideModal"[^>]*class="modal-backdrop"/);
  assert.match(html, /id="tsdBriefing"/);
  assert.match(html, /id="tsdGuide"/);
});
```

Add to `tests/static-ui.test.js`:

```js
test('builder, vehicle and report content share the physical TSD shell', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['tsdBuilder', 'tsdVehicles', 'tsdReport']) assert.match(html, new RegExp(`id="${id}"`));
  assert.equal((html.match(/class="tsd-device"/g) || []).length, 1);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test tests/guide.test.js tests/static-ui.test.js
```

Expected: FAIL because the old independent modal backdrops still exist.

- [ ] **Step 3: Nest existing content sections in the TSD screen**

Inside `tsdContentSlot`, create sections with `hidden` as the default. Preserve the existing modal IDs on the panel wrappers so tests and rendering code keep stable targets; add TSD-specific inner IDs for styling and static contracts:

```html
<section id="tsdBriefing" data-tsd-panel="briefing"></section>
<section id="tsdTask" data-tsd-panel="task"></section>
<section id="builderModal" data-tsd-panel="builder" aria-hidden="true"><div id="tsdBuilder"></div></section>
<section id="vehicleModal" data-tsd-panel="vehicles" aria-hidden="true"><div id="tsdVehicles"></div></section>
<section id="tsdGuide" data-tsd-panel="guide"></section>
<section id="reportModal" data-tsd-panel="report" aria-hidden="true"><div id="tsdReport"></div></section>
```

Move, rather than duplicate, the existing controls and IDs into their matching sections. Keep `itemRows`, `capacity`, `vehicleRows`, `routeStops`, `routeButton`, `guideOrders`, and all report IDs unchanged so existing rendering code continues to target the same nodes.

- [ ] **Step 4: Route open/close actions through `state.tsd.screen`**

Replace `builderOpen` and `vehicleDrawerOpen` rendering with TSD screen selection while preserving the fields for reducer compatibility during this task:

```js
if (action.type === 'OPEN_BUILDER') {
  if (!state.tsd?.acceptedOrderId) return dispatch({ type: 'SHOW_TSD_TASK' });
  state = { ...state, builderOpen: true, tsd: { ...state.tsd, open: true, screen: 'builder' } };
} else if (action.type === 'OPEN_VEHICLES') {
  state = { ...state, vehicleDrawerOpen: true, tsd: { ...state.tsd, open: true, screen: 'vehicles' } };
}
```

On `CLOSE_BUILDER`, `CLOSE_VEHICLES`, and `CLOSE_GUIDE`, close the current TSD screen and restore `screen: 'current'`. On `END_SHIFT`, render the existing report in `tsdReport` with `screen: 'report'`.

- [ ] **Step 5: Show exactly one TSD content panel**

Add to `renderTsd`:

```js
document.querySelectorAll('[data-tsd-panel]').forEach((panel) => {
  panel.hidden = panel.dataset.tsdPanel !== view.screen;
});
```

Map `state.builderOpen`, `state.vehicleDrawerOpen`, `state.guideOpen`, and `state.phase === 'report'` into the corresponding `terminalViewFor` screen before generic feedback.

- [ ] **Step 6: Remove obsolete overlay CSS and keep sticky TSD controls**

Delete `.modal-backdrop` layout rules after no element uses the class. Rename reusable panel layout rules to `.tsd-panel`. Keep the builder confirmation and route buttons sticky within `.tsd-screen`, not the viewport.

- [ ] **Step 7: Run UI, guide, shift, and balance tests**

```bash
node --test tests/guide.test.js tests/shift-flow.test.js tests/static-ui.test.js tests/balance.test.js tests/*.test.js
```

Expected: all tests PASS; all eight levels remain winnable.

- [ ] **Step 8: Commit the one-device interaction model**

```bash
git add index.html app.js styles.css tests/guide.test.js tests/shift-flow.test.js tests/static-ui.test.js
git commit -m "feat: move warehouse workflows onto the TSD"
```

---

### Task 5: Replace CSS Props With Realistic Warehouse Assets and Rack Signs

**Files:**
- Create: `assets/tsd-handheld.webp`
- Create: `assets/pallet-active.webp`
- Create: `assets/agv-active.webp`
- Create: `assets/truck-active.webp`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/static-ui.test.js`

**Interfaces:**
- Consumes the semantic buttons and state attributes from Tasks 3–4.
- Produces transparent visual layers; button elements remain the hit targets and accessibility owners.
- Zone buttons keep `data-action="SELECT_ZONE"`, `data-zone`, and `data-scene-zone`.

- [ ] **Step 1: Write failing asset and physical-sign tests**

Add to `tests/static-ui.test.js`:

```js
test('interactive warehouse objects use optimized realistic assets', () => {
  for (const asset of ['tsd-handheld.webp', 'pallet-active.webp', 'agv-active.webp', 'truck-active.webp']) {
    const path = `assets/${asset}`;
    assert.equal(fs.existsSync(path), true, `${path} must exist`);
    assert.ok(fs.statSync(path).size < 900_000, `${path} must stay below 900 KB`);
  }
});

test('zone names are rack-mounted scene controls and not a floating mission banner', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Сухач', 'Охлаждёнка', 'Заморозка']) assert.match(html, new RegExp(label));
  assert.match(html, /class="scene-zone-sign/);
  assert.doesNotMatch(html, /mission-ribbon/);
});
```

- [ ] **Step 2: Run the static tests and verify RED**

```bash
node --test tests/static-ui.test.js
```

Expected: FAIL because the four assets do not exist and signs still use the old visual treatment.

- [ ] **Step 3: Generate the four transparent assets with ImageGen**

Use the built-in `imagegen` skill, with `assets/warehouse-center.webp` as the lighting/style reference and `/Users/karina/Downloads/92621700x700.jpg` as the TSD anatomy reference.

Generate each asset separately with transparent background:

- `tsd-handheld.webp`: full black-and-orange rugged TSD, upright screen, physical keypad below the screen, pistol grip below and behind, three-quarter front view, warm warehouse rim light, no baked UI text.
- `pallet-active.webp`: EUR wooden pallet loaded with believable shrink-wrapped grocery cartons, three-quarter top view, warm/teal warehouse reflections, no labels or text.
- `agv-active.webp`: low autonomous pallet mover sized to carry the pallet, industrial gray shell, green safety LEDs, matching floor perspective.
- `truck-active.webp`: compact loading-bay truck side/front three-quarter view, neutral white cargo box, dark cab, amber/green gate lights, no logo or text.

Copy each selected generated PNG into the workspace and convert it to its exact destination using `cwebp -quiet -q 82`. Preserve transparency and inspect every output with `view_image` before continuing.

- [ ] **Step 4: Replace CSS-drawn props with image elements**

Keep semantic button wrappers but render assets inside them:

```html
<button class="scene-object scene-pallet" id="scenePallet" data-action="OPEN_BUILDER" type="button" aria-label="Открыть сборку текущей паллеты">
  <img src="assets/pallet-active.webp" alt="" aria-hidden="true">
  <span class="scene-object-fallback" hidden>Паллета</span>
</button>
<div class="scene-object agv" id="sceneAgv" aria-hidden="true"><img src="assets/agv-active.webp" alt=""></div>
<button class="scene-object truck-bay" id="sceneTruckBay" data-action="OPEN_VEHICLES" type="button" aria-label="Открыть машины и маршрут">
  <img src="assets/truck-active.webp" alt="" aria-hidden="true">
  <span class="scene-object-fallback" hidden>Машина</span>
</button>
```

Render `assets/tsd-handheld.webp` as a non-interactive image inside `.tsd-hardware`; the button remains responsible for the hit area.

Attach one delegated `error` listener for `.scene-object img`: hide the failed image and unhide its sibling `.scene-object-fallback`. Style the fallback as a high-contrast industrial label inside the same 44 × 44 hit target. Add a focused test to `tests/tsd-interaction.test.js` that dispatches an image error and asserts the fallback becomes visible while the button action remains unchanged.

- [ ] **Step 5: Turn zone controls into rack-mounted signs**

Rename the visual class to `scene-zone-sign` and position each sign above its corresponding colored rack. Use opaque industrial sign plates, high-contrast text, and no backdrop blur. Preserve the data attributes and locked/active classes.

- [ ] **Step 6: Run static, scene, and full tests**

```bash
node --test tests/static-ui.test.js tests/scene-render.test.js tests/*.test.js
```

Expected: all tests PASS and each asset is below 900 KB.

- [ ] **Step 7: Commit the realistic scene assets**

```bash
git add assets/tsd-handheld.webp assets/pallet-active.webp assets/agv-active.webp assets/truck-active.webp index.html styles.css tests/static-ui.test.js
git commit -m "feat: add realistic TSD and warehouse objects"
```

---

### Task 6: Add State-Driven Motion, Signal, Haptics, and Error Highlighting

**Files:**
- Create: `tsd-signal.js`
- Modify: `scene-view.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/scene-view.test.js`
- Modify: `tests/scene-render.test.js`
- Create: `tests/tsd-signal.test.js`

**Interfaces:**
- Extends `warehouseViewFor(state)` with `highlightObject: '' | 'zone' | 'pallet' | 'truck'`.
- Produces `signalTsd(signal, capabilities)` where `capabilities` contains optional `vibrate(pattern)` and `beep(kind)` callbacks.
- Does not directly construct `AudioContext` inside testable logic.

- [ ] **Step 1: Write failing scene-highlight and signal tests**

Append to `tests/scene-view.test.js`:

```js
test('wrong-zone feedback highlights the pallet while over-capacity highlights the truck', () => {
  const wrongZone = { ...startLevel(1), feedback: { kind: 'error', code: 'wrong-zone', message: 'Ошибка зоны' } };
  const capacity = { ...startLevel(1), feedback: { kind: 'error', code: 'over-capacity', message: 'Нет места' } };
  assert.equal(warehouseViewFor(wrongZone).highlightObject, 'pallet');
  assert.equal(warehouseViewFor(capacity).highlightObject, 'truck');
});
```

Create `tests/tsd-signal.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { signalTsd } = require('../tsd-signal.js');

test('new task emits one short haptic and one notification beep', () => {
  const calls = [];
  signalTsd('new', {
    vibrate: (pattern) => calls.push(['vibrate', pattern]),
    beep: (kind) => calls.push(['beep', kind]),
  });
  assert.deepEqual(calls, [['vibrate', 80], ['beep', 'new']]);
});

test('idle signal produces no side effects', () => {
  const calls = [];
  signalTsd('idle', { vibrate: () => calls.push('vibrate'), beep: () => calls.push('beep') });
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test tests/scene-view.test.js tests/tsd-signal.test.js
```

Expected: FAIL because `highlightObject` and `tsd-signal.js` do not exist.

- [ ] **Step 3: Implement the pure signal adapter**

Create `tsd-signal.js` as a UMD module:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyabinovayaTsdSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function signalTsd(signal, capabilities = {}) {
    if (signal === 'idle') return;
    const pattern = signal === 'error' ? [80, 40, 80] : 80;
    capabilities.vibrate?.(pattern);
    capabilities.beep?.(signal);
  }
  return { signalTsd };
});
```

- [ ] **Step 4: Add object highlighting to the scene mapper and renderer**

In `warehouseViewFor`, map `wrong-zone` to `pallet`, `over-capacity` to `truck`, and demand changes to `zone`. Return `highlightObject`. In `renderScene`, set `scene.dataset.highlight = view.highlightObject`.

- [ ] **Step 5: Trigger signals only when the signal value changes**

Load `tsd-signal.js` before `app.js`. In `app.js`, keep `let lastTsdSignal = 'idle'`. After rendering:

```js
if (view.signal !== lastTsdSignal) {
  signalTsd(view.signal, {
    vibrate: (pattern) => navigator.vibrate?.(pattern),
    beep: (kind) => playWarehouseBeep(kind),
  });
  lastTsdSignal = view.signal;
}
```

Implement `playWarehouseBeep` with a short Web Audio oscillator created only after a user interaction; silently skip audio when unavailable.

- [ ] **Step 6: Add motion without transform conflicts**

Use wrapper elements for moving AGV/pallet groups so state transitions transform the wrapper while subtle idle motion transforms the inner image. Add:

- new-task TSD indicator pulse;
- TSD slide from edge to center;
- AGV plus pallet travel as one group after `pallet-loaded`;
- truck beacon for `awaiting-route` and `route-ready`;
- one-shot red outline for `data-highlight="pallet"` or `truck`.

Inside `@media (prefers-reduced-motion: reduce)`, disable every named animation and replace slide/travel transitions with opacity changes under 100 ms.

- [ ] **Step 7: Run signal, scene, and full tests**

```bash
node --test tests/tsd-signal.test.js tests/scene-view.test.js tests/scene-render.test.js tests/*.test.js
```

Expected: all tests PASS; signal tests prove no repeated idle side effects.

- [ ] **Step 8: Commit the operational feedback layer**

```bash
git add tsd-signal.js scene-view.js app.js index.html styles.css tests/tsd-signal.test.js tests/scene-view.test.js tests/scene-render.test.js
git commit -m "feat: animate TSD warehouse feedback"
```

---

### Task 7: Complete Mobile QA, Documentation, and Branch Verification

**Files:**
- Modify: `README.md`
- Replace: `docs/screenshots/living-warehouse-mobile.png`
- Modify: `tests/static-ui.test.js`
- Modify: `tests/ui-command-contract.test.js`

**Interfaces:**
- No new runtime API.
- Verifies the complete task flow and the unchanged gameplay command contract.

- [ ] **Step 1: Add final contract assertions before the walkthrough**

Update `tests/ui-command-contract.test.js` so the expected set includes:

```js
const actions = [
  'OPEN_TSD', 'CLOSE_TSD', 'ACCEPT_TASK',
  'SELECT_ZONE', 'SELECT_STORE', 'ADD_ITEM', 'LOAD_PALLET',
  'OPEN_BUILDER', 'OPEN_VEHICLES', 'SELECT_VEHICLE',
  'MOVE_STOP', 'SET_ROUTE', 'PAUSE', 'END_SHIFT', 'NAVIGATE',
];
```

Retain the test that every action is reachable from rendered markup or generated row markup.

- [ ] **Step 2: Run the full automated suite**

```bash
node --test tests/*.test.js
```

Expected: all tests PASS with zero failures, skips, or cancellations.

- [ ] **Step 3: Perform the mobile interaction walkthrough**

At 390 × 844 and 320 × 568 viewports, complete this exact sequence:

1. Open level 1; warehouse is visible behind the briefing TSD.
2. Continue; new task appears on the TSD.
3. Accept; TSD moves to the edge and all three visible scene controls remain tappable.
4. Tap `Сухач`; selected sign reacts without covering the racks.
5. Tap the realistic pallet; builder opens within the TSD.
6. Add two waters and load the pallet.
7. Confirm AGV and pallet travel together.
8. Tap the realistic truck; vehicle/route screen opens within the TSD.
9. Build the route to `Северный` and finish the shift.
10. Confirm the report appears in the TSD and no invisible overlay blocks the next action.
11. Repeat with reduced motion enabled; no repeated pulses or travel animation remain.

Record every issue found as a failing automated test before fixing it.

- [ ] **Step 4: Capture and validate the reference screenshot**

Capture the 390 × 844 warehouse state after accepting a task, with the compact physical TSD visible and no open panel. Replace `docs/screenshots/living-warehouse-mobile.png`. Confirm the screenshot shows:

- all three physical zone signs;
- realistic pallet, AGV, truck, and TSD;
- no mission ribbon;
- unobstructed warehouse aisle.

- [ ] **Step 5: Update README interaction documentation**

Replace the old living-warehouse UI paragraph with:

```markdown
## TSD warehouse UI

Tasks arrive on a physical handheld TSD. Accepting a task returns the device
to the edge of the scene, leaving the rack signs, pallet, AGV, and truck as
direct warehouse controls. Briefing, pallet building, vehicle routing,
feedback, and reports reuse the same TSD shell; decorative layers never own
pointer events. Reduced-motion preferences disable repeated movement.

Reference screenshot: `docs/screenshots/living-warehouse-mobile.png`
```

- [ ] **Step 6: Run final verification**

```bash
node --test tests/*.test.js
git diff --check
git status --short --branch
```

Expected: full suite PASS, `git diff --check` prints nothing, and only Task 7 files are modified.

- [ ] **Step 7: Commit final QA artifacts**

```bash
git add README.md docs/screenshots/living-warehouse-mobile.png tests/static-ui.test.js tests/ui-command-contract.test.js
git commit -m "docs: verify the TSD warehouse experience"
```

- [ ] **Step 8: Verify branch history and push**

```bash
node --test tests/*.test.js
git log --oneline --decorate -8
git push -u origin tsd-interface-redesign
```

Expected: seven implementation commits after the design commit and a clean branch tracking `origin/tsd-interface-redesign`.

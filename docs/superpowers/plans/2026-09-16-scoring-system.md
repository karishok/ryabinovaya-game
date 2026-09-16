# Система оценки смены — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переписать судейство смены так, чтобы метрики измерялись относительно достижимого на уровне, три звезды брались на каждом из восьми уровней, а прибыль реагировала на решения игрока.

**Architecture:** Судейство выносится в новый модуль `scoring.js`, который не знает про форму игрового состояния и принимает плоское описание результата смены. `game-engine.js` остаётся механикой и получает перебор оптимального маршрута. `app-state.js` теряет вычисление метрик и получает единственную функцию-переводчик `shiftOutcome(state)`.

**Tech Stack:** Vanilla JavaScript, UMD-фабрики без сборки, встроенный тест-раннер `node --test`. Никаких зависимостей и никакого `package.json`.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-09-16-scoring-system-design.md`. При расхождении плана и спеки прав документ спеки.
- **Предусловие:** в рабочем дереве лежат незакоммиченные правки гайда (`app-state.js`, `app.js`, `index.html`, `styles.css`, `tests/shift-flow.test.js`, `tests/guide.test.js`). Закоммитить их до начала Task 1, иначе диффы перемешаются.
- `levels.js` не меняется в части состава уровней. Система оценки обязана работать на текущих данных. Единственное допустимое добавление — экспорт `STORE_NAMES` в Task 1.
- Новые модули следуют существующему UMD-шаблону: `(function (root, factory) { ... })(typeof globalThis !== 'undefined' ? globalThis : this, function () { ... })`.
- Цены за единицу: вода 1500, хлеб 900, молоко 1400, бананы 1200, мороженое 2200 ₽.
- Ставки расходов: 100 ₽ за минуту маршрута, 10 ₽ за килограмм загруженного груза, 3000 ₽ за испорченную паллету.
- Все проценты округляются через `Math.round`.
- Тексты в интерфейсе и в причинах отчёта — на русском.
- Полный прогон: `node --test tests/*.test.js`. На старте работы 60 тестов проходят; ни один не должен остаться падающим.

---

### Task 1: Данные и оптимальный маршрут в движке

Судейству нужны три вещи, которых в движке нет: цены товаров, отображаемые названия и способ узнать, каким был бы лучший порядок остановок.

**Files:**
- Modify: `game-engine.js` — `ITEMS` (строки 7-13), новые `permutations`, `bestRoute`, `itemBySku`, экспорт
- Modify: `levels.js` — новый экспорт `STORE_NAMES`
- Test: `tests/game-engine.test.js`

**Отклонение от спеки, названное явно:** спека в §7 называет функцию `bestRouteMinutes(stops)`. План реализует `bestRoute(stops)`, возвращающую и порядок, и минуты, потому что причина отчёта из §6 («короче было Центральный → Северный → Западный») требует знать сам порядок, а не только его длительность. Одна функция вместо двух.

**Interfaces:**
- Consumes: существующий `buildRoute(vehicle, stops)`. Его первый аргумент не используется в теле — в `bestRoute` передаётся `null`.
- Produces:
  - `bestRoute(stops: string[]) → { stops: string[], minutes: number }` — лучший порядок и его длительность
  - `itemBySku(sku: string) → { sku, zone, weightPerUnit, price, name } | null`
  - `ITEMS.*.price: number`, `ITEMS.*.name: string`
  - `STORE_NAMES: { [storeId]: string }` из `levels.js`

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `tests/game-engine.test.js`:

```js
test('bestRoute finds the shortest stop order', () => {
  const best = bestRoute(['north', 'west', 'central']);
  assert.deepEqual(best.stops, ['central', 'north', 'west']);
  assert.equal(best.minutes, 49);
});

test('bestRoute is trivial for a single stop', () => {
  assert.deepEqual(bestRoute(['north']), { stops: ['north'], minutes: 15 });
});

test('bestRoute handles an empty route', () => {
  assert.deepEqual(bestRoute([]), { stops: [], minutes: 0 });
});

test('bestRoute refuses to brute-force more than eight stops', () => {
  const tooMany = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  assert.throws(() => bestRoute(tooMany), RangeError);
});

test('every item carries a price and a display name', () => {
  for (const item of Object.values(ITEMS)) {
    assert.ok(item.price > 0, `${item.sku} без цены`);
    assert.ok(item.name.length > 0, `${item.sku} без названия`);
  }
  assert.equal(ITEMS.WATER.price, 1500);
  assert.equal(ITEMS.ICE_CREAM.price, 2200);
});

test('itemBySku resolves items and returns null for unknown goods', () => {
  assert.equal(itemBySku('water').weightPerUnit, 12);
  assert.equal(itemBySku('unicorn'), null);
});

test('store names cover every store used by the campaign', () => {
  const { LEVELS, STORE_NAMES } = require('../levels.js');
  for (const level of LEVELS) {
    for (const store of level.stores) {
      assert.ok(STORE_NAMES[store.id], `нет названия для ${store.id}`);
    }
  }
});
```

Расширить деструктуризацию импорта вверху файла, добавив `bestRoute`, `itemBySku`, `ITEMS`.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/game-engine.test.js`

Expected: FAIL — `bestRoute is not a function`.

- [ ] **Step 3: Добавить цены и названия в `ITEMS`**

Заменить блок `ITEMS` в `game-engine.js`:

```js
  const ITEMS = Object.freeze({
    WATER: Object.freeze({ sku: 'water', zone: ZONES.DRY, weightPerUnit: 12, price: 1500, name: 'Вода 1,5 л' }),
    MILK: Object.freeze({ sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10, price: 1400, name: 'Молоко' }),
    BANANA: Object.freeze({ sku: 'banana', zone: ZONES.CHILLED, weightPerUnit: 8, price: 1200, name: 'Бананы' }),
    BREAD: Object.freeze({ sku: 'bread', zone: ZONES.DRY, weightPerUnit: 6, price: 900, name: 'Хлеб' }),
    ICE_CREAM: Object.freeze({ sku: 'ice-cream', zone: ZONES.FROZEN, weightPerUnit: 9, price: 2200, name: 'Мороженое' }),
  });

  const ITEM_BY_SKU = Object.freeze(Object.fromEntries(Object.values(ITEMS).map((item) => [item.sku, item])));

  function itemBySku(sku) {
    return ITEM_BY_SKU[sku] || null;
  }
```

- [ ] **Step 4: Добавить перебор оптимального маршрута**

Вставить в `game-engine.js` сразу после `buildRoute`:

```js
  function permutations(values) {
    if (values.length <= 1) return [values];
    const result = [];
    values.forEach((value, index) => {
      const rest = [...values.slice(0, index), ...values.slice(index + 1)];
      for (const tail of permutations(rest)) result.push([value, ...tail]);
    });
    return result;
  }

  function bestRoute(stops) {
    const list = [...(stops || [])];
    if (list.length === 0) return { stops: [], minutes: 0 };
    if (list.length > 8) throw new RangeError(`Too many stops to optimize: ${list.length}`);
    let best = null;
    for (const candidate of permutations(list)) {
      const { minutes } = buildRoute(null, candidate);
      if (!best || minutes < best.minutes) best = { stops: candidate, minutes };
    }
    return best;
  }
```

Добавить `bestRoute`, `itemBySku` в объект `return` модуля.

- [ ] **Step 5: Добавить названия дарксторов в `levels.js`**

Перед `const LEVELS = [` добавить:

```js
  const STORE_NAMES = Object.freeze({
    north: 'Северный',
    central: 'Центральный',
    west: 'Западный',
    east: 'Восточный',
  });
```

Изменить последнюю строку фабрики на `return { LEVELS, STORE_NAMES };`.

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `node --test tests/game-engine.test.js`

Expected: PASS. Три теста `scoreShift` (строки ~139-163) пока проходят по-старому — их переносим в Task 3.

- [ ] **Step 7: Коммит**

```bash
git add game-engine.js levels.js tests/game-engine.test.js
git commit -m "feat: add item prices, display names and optimal route search"
```

---

### Task 2: Метрики в новом модуле `scoring.js`

Три метрики, каждая ловит один способ ошибиться. Модуль не знает про игровое состояние — только плоские данные.

**Files:**
- Create: `scoring.js`
- Test: `tests/scoring.test.js` (создать)

**Interfaces:**
- Consumes: ничего. Модуль чистый, без зависимостей.
- Produces: `metricsFor(outcome) → { deliveredPercent, onTimePercent, precisionPercent }`

Форма `outcome`, которую производит Task 5 и потребляют Tasks 2-4:

```js
{
  demand:              [{ storeId, zone, sku, quantity, storeName, itemName }],
  delivered:           [{ storeId, zone, sku, quantity, price }],
  loadedWeight:        140,   // кг всех загруженных паллет
  usefulWeight:        92,    // кг груза, зачтённого в заявки
  routes:              [{ vehicleId, stops, minutes, bestStops, bestMinutes }],
  vehiclesWithoutRoute: ['dry-2'],
  spoiledPallets:      1,
  spoilageReasons:     [{ message: '...' }],
  storeNames:          { north: 'Северный', ... },
}
```

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/scoring.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { metricsFor } = require('../scoring.js');

const emptyOutcome = {
  demand: [], delivered: [], loadedWeight: 0, usefulWeight: 0,
  routes: [], vehiclesWithoutRoute: [], spoiledPallets: 0, spoilageReasons: [], storeNames: {},
};

test('perfect shift scores 100 on every metric', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    demand: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2 }],
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }],
    loadedWeight: 24, usefulWeight: 24,
    routes: [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }],
  });
  assert.deepEqual(metrics, { deliveredPercent: 100, onTimePercent: 100, precisionPercent: 100 });
});

test('delivered percent reports the shortfall', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    demand: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 4 }],
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 1, price: 1500 }],
    loadedWeight: 12, usefulWeight: 12,
    routes: [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }],
  });
  assert.equal(metrics.deliveredPercent, 25);
});

test('on-time compares the chosen stop order against the best one', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    routes: [{ vehicleId: 'dry-1', stops: ['north', 'west', 'central'], minutes: 61, bestStops: ['central', 'north', 'west'], bestMinutes: 49 }],
  });
  assert.equal(metrics.onTimePercent, 80);
});

test('on-time averages across loaded vehicles', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    routes: [
      { vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 },
      { vehicleId: 'chilled-1', stops: ['east', 'central'], minutes: 40, bestStops: ['central', 'east'], bestMinutes: 20 },
    ],
  });
  assert.equal(metrics.onTimePercent, 75);
});

test('a loaded vehicle without a route scores zero on time', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    routes: [{ vehicleId: 'dry-1', stops: [], minutes: 0, bestStops: [], bestMinutes: 0 }],
  });
  assert.equal(metrics.onTimePercent, 0);
});

test('on-time is zero when nothing is loaded at all', () => {
  assert.equal(metricsFor(emptyOutcome).onTimePercent, 0);
});

test('precision falls when cargo exceeds the order', () => {
  const metrics = metricsFor({ ...emptyOutcome, loadedWeight: 96, usefulWeight: 24 });
  assert.equal(metrics.precisionPercent, 25);
});

test('precision is full on an empty shipment because nothing was wasted', () => {
  assert.equal(metricsFor(emptyOutcome).precisionPercent, 100);
});

test('under-delivery does not hurt precision', () => {
  const metrics = metricsFor({
    ...emptyOutcome,
    demand: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 4 }],
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }],
    loadedWeight: 24, usefulWeight: 24,
  });
  assert.equal(metrics.precisionPercent, 100);
  assert.equal(metrics.deliveredPercent, 50);
});

test('an empty demand counts as fully delivered', () => {
  assert.equal(metricsFor(emptyOutcome).deliveredPercent, 100);
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/scoring.test.js`

Expected: FAIL — `Cannot find module '../scoring.js'`.

- [ ] **Step 3: Создать `scoring.js` с метриками**

```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaScoring = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const percent = (part, whole) => Math.round((part / whole) * 100);

  function routeScore(route) {
    if (!route.stops || route.stops.length === 0) return 0;
    if (!route.minutes) return 100;
    return Math.min(100, Math.round((route.bestMinutes / route.minutes) * 100));
  }

  function metricsFor(outcome) {
    const demandQuantity = (outcome.demand || []).reduce((total, line) => total + line.quantity, 0);
    const deliveredQuantity = (outcome.delivered || []).reduce((total, line) => total + line.quantity, 0);
    const deliveredPercent = demandQuantity ? percent(deliveredQuantity, demandQuantity) : 100;

    const routes = outcome.routes || [];
    const onTimePercent = routes.length
      ? Math.round(routes.reduce((total, route) => total + routeScore(route), 0) / routes.length)
      : 0;

    const loadedWeight = outcome.loadedWeight || 0;
    const precisionPercent = loadedWeight ? percent(outcome.usefulWeight || 0, loadedWeight) : 100;

    return { deliveredPercent, onTimePercent, precisionPercent };
  }

  return { metricsFor };
});
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `node --test tests/scoring.test.js`

Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add scoring.js tests/scoring.test.js
git commit -m "feat: add shift metrics measured against what was achievable"
```

---

### Task 3: Звёзды и прибыль

**Files:**
- Modify: `scoring.js`
- Modify: `tests/scoring.test.js`
- Modify: `tests/game-engine.test.js` — удалить три теста `scoreShift`

**Interfaces:**
- Consumes: `metricsFor` из Task 2.
- Produces:
  - `RATES = { perRouteMinute: 100, perLoadedKg: 10, spoiledPallet: 3000 }`
  - `starsFor(metrics, outcome) → 1 | 2 | 3`
  - `profitFor(outcome) → number`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `tests/scoring.test.js` (расширив импорт до `{ metricsFor, starsFor, profitFor }`):

```js
const perfect = { deliveredPercent: 100, onTimePercent: 100, precisionPercent: 100 };

test('three stars require perfect play with no spoilage', () => {
  assert.equal(starsFor(perfect, { ...emptyOutcome }), 3);
});

test('spoilage alone blocks three stars', () => {
  assert.equal(starsFor(perfect, { ...emptyOutcome, spoiledPallets: 1 }), 2);
});

test('a single imperfect metric blocks three stars', () => {
  assert.equal(starsFor({ ...perfect, onTimePercent: 99 }, emptyOutcome), 2);
  assert.equal(starsFor({ ...perfect, precisionPercent: 99 }, emptyOutcome), 2);
});

test('two stars need seventy percent delivered', () => {
  assert.equal(starsFor({ ...perfect, deliveredPercent: 70 }, emptyOutcome), 2);
  assert.equal(starsFor({ ...perfect, deliveredPercent: 69 }, emptyOutcome), 1);
});

test('profit is revenue minus route, weight and spoilage costs', () => {
  const profit = profitFor({
    ...emptyOutcome,
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }],
    loadedWeight: 24,
    routes: [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }],
  });
  assert.equal(profit, 3000 - 1500 - 240);
});

test('stuffing the truck earns less than shipping exactly the order', () => {
  const base = {
    ...emptyOutcome,
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }],
    routes: [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }],
  };
  assert.ok(profitFor({ ...base, loadedWeight: 96 }) < profitFor({ ...base, loadedWeight: 24 }));
});

test('spoilage is charged against profit', () => {
  const base = { ...emptyOutcome, delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }] };
  assert.equal(profitFor({ ...base, spoiledPallets: 1 }) - profitFor(base), -3000);
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/scoring.test.js`

Expected: FAIL — `starsFor is not a function`.

- [ ] **Step 3: Реализовать звёзды и прибыль**

Добавить в `scoring.js` перед `return`:

```js
  const RATES = Object.freeze({ perRouteMinute: 100, perLoadedKg: 10, spoiledPallet: 3000 });

  const isPerfect = (metrics, outcome) => metrics.deliveredPercent === 100
    && metrics.onTimePercent === 100
    && metrics.precisionPercent === 100
    && (outcome.spoiledPallets || 0) === 0;

  function starsFor(metrics, outcome) {
    if (isPerfect(metrics, outcome)) return 3;
    return metrics.deliveredPercent >= 70 ? 2 : 1;
  }

  function profitFor(outcome) {
    const revenue = (outcome.delivered || []).reduce((total, line) => total + line.quantity * line.price, 0);
    const routeCost = (outcome.routes || []).reduce((total, route) => total + route.minutes * RATES.perRouteMinute, 0);
    const weightCost = (outcome.loadedWeight || 0) * RATES.perLoadedKg;
    const spoilCost = (outcome.spoiledPallets || 0) * RATES.spoiledPallet;
    return Math.round(revenue - routeCost - weightCost - spoilCost);
  }
```

Расширить `return` до `{ RATES, metricsFor, starsFor, profitFor }`.

- [ ] **Step 4: Удалить устаревшие тесты `scoreShift` из движка**

В `tests/game-engine.test.js` удалить три теста, опирающихся на старую формулу:
`three stars require strong delivery and utilization`, `wrong transport appears in the score reasons`, `score is never below one star and penalizes operational losses` (примерно строки 139-163). Убрать `scoreShift` из деструктуризации импорта.

Функцию `scoreShift` в `game-engine.js` пока не удалять — её снимет Task 5, когда `app-state.js` перестанет её звать.

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `node --test tests/scoring.test.js tests/game-engine.test.js`

Expected: PASS оба файла.

- [ ] **Step 6: Коммит**

```bash
git add scoring.js tests/scoring.test.js tests/game-engine.test.js
git commit -m "feat: score stars against optimal play and compute profit from revenue"
```

---

### Task 4: Честные причины в отчёте

Причина появляется только тогда, когда игрок мог сыграть лучше.

**Files:**
- Modify: `scoring.js`
- Modify: `tests/scoring.test.js`

**Interfaces:**
- Consumes: `metricsFor`, `starsFor`, `profitFor` из Tasks 2-3.
- Produces:
  - `reasonsFor(metrics, outcome) → string[]`
  - `scoreShift(outcome) → { stars, profit, metrics, reasons }`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `tests/scoring.test.js` (расширив импорт до `{ metricsFor, starsFor, profitFor, reasonsFor, scoreShift }`):

```js
const names = { north: 'Северный', central: 'Центральный', west: 'Западный' };

test('a perfect shift reports praise instead of a fault list', () => {
  assert.deepEqual(reasonsFor(perfect, emptyOutcome), ['Смена отработана идеально']);
});

test('a routeless vehicle is reported and suppresses the route-length complaint', () => {
  const outcome = {
    ...emptyOutcome, storeNames: names, vehiclesWithoutRoute: ['dry-2'],
    routes: [{ vehicleId: 'dry-2', stops: [], minutes: 0, bestStops: [], bestMinutes: 0 }],
  };
  const reasons = reasonsFor(metricsFor(outcome), outcome);
  assert.match(reasons[0], /Маршрут не построен: dry-2/);
  assert.ok(!reasons.some((reason) => /длиннее оптимального/.test(reason)));
});

test('a longer-than-optimal route names the shorter order', () => {
  const outcome = {
    ...emptyOutcome, storeNames: names,
    routes: [{ vehicleId: 'dry-1', stops: ['north', 'west', 'central'], minutes: 61, bestStops: ['central', 'north', 'west'], bestMinutes: 49 }],
  };
  const reasons = reasonsFor(metricsFor(outcome), outcome);
  assert.ok(reasons.some((reason) => reason === 'Маршрут на 12 минут длиннее оптимального: короче было Центральный → Северный → Западный'));
});

test('excess cargo is reported in kilograms', () => {
  const outcome = { ...emptyOutcome, loadedWeight: 96, usefulWeight: 24 };
  const reasons = reasonsFor(metricsFor(outcome), outcome);
  assert.ok(reasons.includes('Отправили 72 кг сверх заявки'));
});

test('undelivered goods name the store and the item', () => {
  const outcome = {
    ...emptyOutcome, storeNames: names,
    demand: [{ storeId: 'west', zone: 'dry', sku: 'bread', quantity: 3, storeName: 'Западный', itemName: 'Хлеб' }],
    delivered: [{ storeId: 'west', zone: 'dry', sku: 'bread', quantity: 1, price: 900 }],
    loadedWeight: 6, usefulWeight: 6,
  };
  const reasons = reasonsFor(metricsFor(outcome), outcome);
  assert.ok(reasons.some((reason) => /Не доставлено: 2 из 3 позиций.*Западный.*Хлеб/.test(reason)));
});

test('spoilage messages are passed through', () => {
  const outcome = { ...emptyOutcome, spoiledPallets: 1, spoilageReasons: [{ message: 'паллета испорчена из-за несовместимого транспорта' }] };
  assert.ok(reasonsFor(metricsFor(outcome), outcome).includes('паллета испорчена из-за несовместимого транспорта'));
});

test('scoreShift bundles metrics, stars, profit and reasons', () => {
  const outcome = {
    ...emptyOutcome,
    demand: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, storeName: 'Северный', itemName: 'Вода 1,5 л' }],
    delivered: [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }],
    loadedWeight: 24, usefulWeight: 24,
    routes: [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }],
  };
  const score = scoreShift(outcome);
  assert.equal(score.stars, 3);
  assert.equal(score.profit, 1260);
  assert.deepEqual(score.metrics, { deliveredPercent: 100, onTimePercent: 100, precisionPercent: 100 });
  assert.deepEqual(score.reasons, ['Смена отработана идеально']);
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/scoring.test.js`

Expected: FAIL — `reasonsFor is not a function`.

- [ ] **Step 3: Реализовать причины**

Добавить в `scoring.js` перед `return`:

```js
  const routeLabel = (stops, storeNames) => stops.map((id) => storeNames[id] || id).join(' → ');

  function shortfallLines(outcome) {
    const deliveredByKey = new Map();
    for (const line of outcome.delivered || []) {
      const key = `${line.storeId}:${line.zone}:${line.sku}`;
      deliveredByKey.set(key, (deliveredByKey.get(key) || 0) + line.quantity);
    }
    return (outcome.demand || [])
      .map((line) => {
        const key = `${line.storeId}:${line.zone}:${line.sku}`;
        const missing = line.quantity - (deliveredByKey.get(key) || 0);
        return missing > 0 ? { ...line, quantity: missing } : null;
      })
      .filter(Boolean);
  }

  function reasonsFor(metrics, outcome) {
    if (isPerfect(metrics, outcome)) return ['Смена отработана идеально'];

    const reasons = [];
    const storeNames = outcome.storeNames || {};
    const routeless = outcome.vehiclesWithoutRoute || [];
    if (routeless.length > 0) {
      reasons.push(`Маршрут не построен: ${routeless.join(', ')} — их паллеты не засчитаны.`);
    }
    if ((outcome.spoiledPallets || 0) > 0) {
      reasons.push(...(outcome.spoilageReasons || []).map((entry) => entry.message));
    }
    if (metrics.deliveredPercent < 100) {
      const shortfalls = shortfallLines(outcome);
      const missing = shortfalls.reduce((total, line) => total + line.quantity, 0);
      const demanded = (outcome.demand || []).reduce((total, line) => total + line.quantity, 0);
      const first = shortfalls[0];
      const detail = first ? ` — ${first.storeName} не получил: ${first.itemName}` : '';
      reasons.push(`Не доставлено: ${missing} из ${demanded} позиций${detail}`);
    }
    const routed = (outcome.routes || []).filter((route) => route.stops && route.stops.length > 0);
    if (metrics.onTimePercent < 100 && routeless.length === 0 && routed.length > 0) {
      const worst = routed.reduce((a, b) => (b.minutes - b.bestMinutes > a.minutes - a.bestMinutes ? b : a));
      const gap = worst.minutes - worst.bestMinutes;
      if (gap > 0) {
        reasons.push(`Маршрут на ${gap} минут длиннее оптимального: короче было ${routeLabel(worst.bestStops, storeNames)}`);
      }
    }
    if (metrics.precisionPercent < 100) {
      reasons.push(`Отправили ${(outcome.loadedWeight || 0) - (outcome.usefulWeight || 0)} кг сверх заявки`);
    }
    return reasons;
  }

  function scoreShift(outcome) {
    const metrics = metricsFor(outcome);
    return {
      metrics,
      stars: starsFor(metrics, outcome),
      profit: profitFor(outcome),
      reasons: reasonsFor(metrics, outcome),
    };
  }
```

Расширить `return` до `{ RATES, metricsFor, starsFor, profitFor, reasonsFor, scoreShift }`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `node --test tests/scoring.test.js`

Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add scoring.js tests/scoring.test.js
git commit -m "feat: report only faults the player could have avoided"
```

---

### Task 5: Перевести `app-state.js` на новое судейство

**Files:**
- Modify: `app-state.js` — заменить `fulfillmentFor`/`onTimePercentFor`/`utilizationFor`/`scoreInputs`/`finishShift`
- Modify: `game-engine.js` — удалить `scoreShift` и его экспорт
- Modify: `tests/app-state.test.js` (строки ~71-89), `tests/live-kpis.test.js` (строки ~35, 56-73), `tests/shift-flow.test.js`

**Interfaces:**
- Consumes: `bestRoute`, `itemBySku` (Task 1), `scoreShift` (Task 4), `STORE_NAMES` (Task 1).
- Produces:
  - `shiftOutcome(state) → outcome` (форма из Task 2)
  - `liveMetrics(state) → { deliveredPercent, onTimePercent, precisionPercent }`
  - `fulfillmentFor(state) → { fulfilledQuantity, demandQuantity, deliveredPercent }` — сохраняется для счётчика «Заказы N / M»
  - `finishShift(state) → { report, nextLevelId }`, где `report` содержит `stars`, `profit`, `reasons`, `deliveredPercent`, `onTimePercent`, `precisionPercent`, `spoiledPallets`

**Поведенческое изменение, названное явно:** старый `onTimePercentFor` возвращал 0 при `secondsRemaining <= 0`, из-за чего смена, доигранная до конца таймера, никогда не получала три звезды. Новые метрики времени не учитывают. Это намеренно: спека не связывает оценку с остатком времени.

- [ ] **Step 1: Написать падающий тест на `shiftOutcome`**

Добавить в `tests/shift-flow.test.js`:

```js
test('shiftOutcome describes the shift in plain data for the scorer', () => {
  const { shiftOutcome, reduceAction, startLevel } = require('../app-state.js');
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });

  const outcome = shiftOutcome(state);
  assert.equal(outcome.loadedWeight, 24);
  assert.equal(outcome.usefulWeight, 24);
  assert.deepEqual(outcome.delivered, [{ storeId: 'north', zone: 'dry', sku: 'water', quantity: 2, price: 1500 }]);
  assert.deepEqual(outcome.routes, [{ vehicleId: 'dry-1', stops: ['north'], minutes: 15, bestStops: ['north'], bestMinutes: 15 }]);
  assert.deepEqual(outcome.vehiclesWithoutRoute, []);
  assert.equal(outcome.demand[0].storeName, 'Северный');
  assert.equal(outcome.demand[0].itemName, 'Вода 1,5 л');
});

test('a perfectly played first level now earns three stars', () => {
  const { reduceAction, startLevel, finishShift } = require('../app-state.js');
  let state = startLevel(1);
  state = reduceAction(state, { type: 'ADD_ITEM', sku: 'water', zone: 'dry', weightPerUnit: 12, quantity: 2 });
  state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId: 'dry-1' });
  state = reduceAction(state, { type: 'SET_ROUTE', vehicleId: 'dry-1', stops: ['north'] });

  const { report } = finishShift(state);
  assert.equal(report.stars, 3);
  assert.equal(report.deliveredPercent, 100);
  assert.equal(report.onTimePercent, 100);
  assert.equal(report.precisionPercent, 100);
  assert.equal(report.profit, 1260);
  assert.deepEqual(report.reasons, ['Смена отработана идеально']);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test tests/shift-flow.test.js`

Expected: FAIL — `shiftOutcome is not a function`.

- [ ] **Step 3: Заменить вычисление метрик в `app-state.js`**

Подключить зависимости вверху фабрики: `scoring` добавляется в шапку UMD по образцу `engine`/`levelData`, `STORE_NAMES` берётся из `levelData`.

Шапку заменить на:

```js
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const scoring = isNode ? require('./scoring.js') : root.RyabinovayaScoring;
  const api = factory(engine, levelData, scoring);
  if (isNode) module.exports = api;
  else root.RyabinovayaAppState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData, scoring) {
  const LEVELS = levelData.LEVELS;
  const STORE_NAMES = levelData.STORE_NAMES;
```

Удалить `onTimePercentFor`, `utilizationFor` и `scoreInputs`. Заменить `fulfillmentFor` и `finishShift` на:

```js
  function shiftOutcome(state) {
    const activeOrders = (state.orders || []).filter((order) => !order.cancelled);
    const fulfilledByLine = new Map();
    let loadedWeight = 0;

    for (const pallet of state.loadedPallets || []) {
      loadedWeight += pallet.weight;
      const vehicle = (state.vehicles || []).find((entry) => entry.id === pallet.vehicleId);
      const route = routeFor(state, pallet.vehicleId);
      if (!vehicle || vehicle.zone !== pallet.zone || !route?.stops.includes(pallet.storeId)) continue;
      for (const item of pallet.items || []) {
        if (item.zone !== pallet.zone) continue;
        const key = `${pallet.storeId}:${pallet.zone}:${item.sku}`;
        fulfilledByLine.set(key, (fulfilledByLine.get(key) || 0) + item.quantity);
      }
    }

    const remaining = new Map(fulfilledByLine);
    const delivered = [];
    let usefulWeight = 0;
    for (const order of activeOrders) {
      const key = `${order.storeId}:${order.zone}:${order.sku}`;
      const counted = Math.min(order.quantity, remaining.get(key) || 0);
      remaining.set(key, (remaining.get(key) || 0) - counted);
      if (counted > 0) {
        const item = engine.itemBySku(order.sku);
        usefulWeight += counted * (item?.weightPerUnit || 0);
        delivered.push({ storeId: order.storeId, zone: order.zone, sku: order.sku, quantity: counted, price: item?.price || 0 });
      }
    }

    const loadedVehicleIds = new Set((state.loadedPallets || []).map((pallet) => pallet.vehicleId));
    const routes = (state.vehicles || [])
      .filter((vehicle) => loadedVehicleIds.has(vehicle.id))
      .map((vehicle) => {
        const route = routeFor(state, vehicle.id);
        const stops = route?.stops || [];
        const best = engine.bestRoute(stops);
        return { vehicleId: vehicle.id, stops, minutes: route?.minutes || 0, bestStops: best.stops, bestMinutes: best.minutes };
      });

    return {
      demand: activeOrders.map((order) => ({
        storeId: order.storeId, zone: order.zone, sku: order.sku, quantity: order.quantity,
        storeName: STORE_NAMES[order.storeId] || order.storeId,
        itemName: engine.itemBySku(order.sku)?.name || order.sku,
      })),
      delivered,
      loadedWeight,
      usefulWeight,
      routes,
      vehiclesWithoutRoute: missingRouteVehicles(state),
      spoiledPallets: state.metrics?.spoiledPallets || 0,
      spoilageReasons: state.spoilageReasons || [],
      storeNames: STORE_NAMES,
    };
  }

  const liveMetrics = (state) => scoring.metricsFor(shiftOutcome(state));

  function fulfillmentFor(state) {
    const outcome = shiftOutcome(state);
    return {
      fulfilledQuantity: outcome.delivered.reduce((total, line) => total + line.quantity, 0),
      demandQuantity: outcome.demand.reduce((total, line) => total + line.quantity, 0),
      deliveredPercent: scoring.metricsFor(outcome).deliveredPercent,
    };
  }

  function finishShift(state) {
    const outcome = shiftOutcome(state);
    const score = scoring.scoreShift(outcome);
    const report = {
      stars: score.stars,
      profit: score.profit,
      reasons: score.reasons,
      deliveredPercent: score.metrics.deliveredPercent,
      onTimePercent: score.metrics.onTimePercent,
      precisionPercent: score.metrics.precisionPercent,
      spoiledPallets: outcome.spoiledPallets,
    };
    const currentIndex = LEVELS.findIndex((level) => level.id === state.levelId);
    return { report, nextLevelId: currentIndex >= 0 ? LEVELS[currentIndex + 1]?.id || null : null };
  }
```

Обновить `return` модуля на:

```js
  return { reduceAction, startLevel, tick, finishShift, shiftOutcome, liveMetrics, fulfillmentFor, missingRouteVehicles };
```

- [ ] **Step 4: Удалить `scoreShift` из движка**

В `game-engine.js` удалить функцию `scoreShift` целиком и убрать её из объекта `return`. `app-state.js` её больше не вызывает, тесты движка её больше не импортируют (Task 3).

- [ ] **Step 5: Переписать устаревшие утверждения в существующих тестах**

`tests/app-state.test.js`, тест `end-shift score includes accumulated spoilage and penalty data` (~строки 71-89): заменить `next.report.inputs.utilizationPercent` на `next.report.precisionPercent` и убрать обращения к `report.inputs`, которого больше нет.

`tests/live-kpis.test.js`: в хелпере (~строка 35) заменить `elementFor('utilization')` на `elementFor('precision')`, а тест `live and final utilization use the same fleet-wide capacity regardless of selected vehicle` переписать под точность:

```js
test('live and final precision agree regardless of the selected vehicle', () => {
  assert.equal(renderKpis({ ...state, selectedVehicleId: 'dry-1' }).precision, renderKpis({ ...state, selectedVehicleId: 'chilled-1' }).precision);
  assert.equal(appState.finishShift(state).report.precisionPercent, Number(renderKpis(state).precision.replace('%', '')));
});
```

`tests/shift-flow.test.js`: в тесте `end-shift action keeps all report metrics available at the top level` заменить ожидаемый объект — `utilizationPercent` на `precisionPercent`, убрать поле `inputs`, обновить `stars`, `profit` и `reasons` под новые значения (первый уровень при честной игре теперь даёт `stars: 3`, `profit: 1260`, `reasons: ['Смена отработана идеально']`).

Прочие утверждения про `onTimePercent` в этом файле пересчитать: маршрут из одной остановки теперь даёт 100, а не 85.

- [ ] **Step 6: Запустить полный набор тестов**

Run: `node --test tests/*.test.js`

Expected: PASS, ноль падений. Если какой-то тест продолжает опираться на `utilizationPercent` или `report.inputs` — переписать его так же.

- [ ] **Step 7: Коммит**

```bash
git add app-state.js game-engine.js tests/app-state.test.js tests/live-kpis.test.js tests/shift-flow.test.js
git commit -m "feat: judge shifts through the scoring module"
```

---

### Task 6: Подписи в интерфейсе

**Files:**
- Modify: `index.html` — строки 19-20 (метрики), строка 104 (отчёт), блок `<script>` в конце
- Modify: `app.js` — строки 3, 34-35, 107

**Interfaces:**
- Consumes: `liveMetrics(state)` из Task 5.
- Produces: ничего для других задач.

- [ ] **Step 1: Написать падающий тест**

Добавить в `tests/static-ui.test.js`:

```js
test('metric labels describe precision and never promise an unreachable target', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="precision"/);
  assert.match(html, /Точность/);
  assert.match(html, /id="reportPrecision"/);
  assert.doesNotMatch(html, /цель 90%/);
  assert.doesNotMatch(html, /id="utilization"/);
  assert.doesNotMatch(html, /id="reportUtilization"/);
});

test('the page loads the scoring module before the app state', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<script src="scoring\.js"[^>]*><\/script>\s*<script src="app-state\.js/);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test tests/static-ui.test.js`

Expected: FAIL — в разметке всё ещё `id="utilization"` и подпись «цель 90%».

- [ ] **Step 3: Обновить разметку**

В `index.html` заменить строки 19-20 на:

```html
      <div class="metric"><div class="label">Вовремя</div><div class="value" id="ontime">0%</div><div class="hint">порядок остановок</div></div>
      <div class="metric"><div class="label">Точность</div><div class="value" id="precision">100%</div><div class="hint">без лишнего груза</div></div>
```

В блоке отчёта заменить `<small>Загрузка машин</small><strong id="reportUtilization">0%</strong>` на `<small>Точность</small><strong id="reportPrecision">0%</strong>`.

Добавить `scoring.js` в подключение скриптов, перед `app-state.js`:

```html
  <script src="game-engine.js"></script>
  <script src="levels.js"></script>
  <script src="scoring.js"></script>
  <script src="app-state.js?v=guide"></script>
  <script src="app.js?v=guide-2"></script>
```

- [ ] **Step 4: Обновить `app.js`**

Строка 3 — заменить деструктуризацию:

```js
const { reduceAction, startLevel, liveMetrics, fulfillmentFor, missingRouteVehicles } = window.RyabinovayaAppState;
```

Строки 34-35 заменить на:

```js
  const metrics = liveMetrics(nextState);
  byId(document, 'ontime').textContent = `${metrics.onTimePercent}%`;
  byId(document, 'precision').textContent = `${metrics.precisionPercent}%`;
```

Строка 107 — заменить на:

```js
    byId(document, 'reportPrecision').textContent = `${nextState.report.precisionPercent}%`;
```

- [ ] **Step 5: Запустить полный набор тестов**

Run: `node --test tests/*.test.js`

Expected: PASS.

- [ ] **Step 6: Проверить игру в браузере**

Открыть `index.html`, пройти первый уровень: собрать ровно 2 воды, поставить в отгрузку, построить маршрут в «Северный», завершить смену.

Ожидается: «Точность 100%», «Вовремя 100%», отчёт с тремя звёздами, прибылью 1 260 ₽ и строкой «Смена отработана идеально».

- [ ] **Step 7: Коммит**

```bash
git add index.html app.js tests/static-ui.test.js
git commit -m "feat: show precision instead of truck fill and drop the unreachable target"
```

---

### Task 7: Приёмочный тест баланса

Главный тест работы: он доказывает, что три звезды берутся на каждом уровне, и навсегда закрывает эксплойт с набивкой кузова.

**Files:**
- Create: `tests/balance.test.js`

**Interfaces:**
- Consumes: `startLevel`, `tick`, `reduceAction`, `finishShift` (`app-state.js`), `bestRoute`, `itemBySku` (`game-engine.js`), `LEVELS` (`levels.js`).
- Produces: ничего.

- [ ] **Step 1: Написать тест**

Создать `tests/balance.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game-engine.js');
const { LEVELS } = require('../levels.js');
const { startLevel, tick, reduceAction, finishShift } = require('../app-state.js');

// Доводит смену до состояния, где все сценарные события уже случились:
// спрос окончательный, отложенные машины готовы.
function settled(levelId) {
  const level = LEVELS.find((entry) => entry.id === levelId);
  return tick({ ...startLevel(levelId), phase: 'shift' }, level.durationSeconds - 1);
}

// Раскладывает магазины по машинам их зоны по кругу.
function assignStores(state) {
  const byZone = new Map();
  for (const order of state.orders.filter((entry) => !entry.cancelled)) {
    if (!byZone.has(order.zone)) byZone.set(order.zone, new Set());
    byZone.get(order.zone).add(order.storeId);
  }
  const assignment = [];
  for (const [zone, storeSet] of byZone) {
    const vehicles = state.vehicles.filter((vehicle) => vehicle.zone === zone);
    const buckets = vehicles.map(() => []);
    [...storeSet].forEach((storeId, index) => buckets[index % vehicles.length].push(storeId));
    vehicles.forEach((vehicle, index) => {
      if (buckets[index].length > 0) assignment.push({ vehicleId: vehicle.id, stops: buckets[index] });
    });
  }
  return assignment;
}

function play(levelId, extraWaterPerPallet = 0) {
  let state = settled(levelId);
  const orders = state.orders.filter((entry) => !entry.cancelled);

  for (const { vehicleId, stops } of assignStores(state)) {
    for (const storeId of stops) {
      const lines = orders.filter((order) => order.storeId === storeId);
      state = reduceAction(state, { type: 'SELECT_STORE', storeId });
      state = reduceAction(state, { type: 'SELECT_ZONE', zone: lines[0].zone });
      for (const line of lines) {
        const item = engine.itemBySku(line.sku);
        state = reduceAction(state, {
          type: 'ADD_ITEM', sku: line.sku, zone: line.zone,
          weightPerUnit: item.weightPerUnit, quantity: line.quantity + extraWaterPerPallet,
        });
      }
      state = reduceAction(state, { type: 'LOAD_PALLET', vehicleId });
    }
    const best = engine.bestRoute(stops);
    state = reduceAction(state, { type: 'SET_ROUTE', vehicleId, stops: best.stops });
  }
  return finishShift(state).report;
}

for (const level of LEVELS) {
  test(`level ${level.id} "${level.title}" is winnable with three stars and a profit`, () => {
    const report = play(level.id);
    assert.equal(report.deliveredPercent, 100, 'доставка');
    assert.equal(report.onTimePercent, 100, 'вовремя');
    assert.equal(report.precisionPercent, 100, 'точность');
    assert.equal(report.spoiledPallets, 0, 'порча');
    assert.equal(report.stars, 3, `звёзды, причины: ${report.reasons.join('; ')}`);
    assert.ok(report.profit > 0, `прибыль ${report.profit} должна быть положительной`);
  });
}

test('stuffing pallets beyond the order costs both stars and money', () => {
  const honest = play(1);
  const stuffed = play(1, 4);
  assert.equal(honest.stars, 3);
  assert.ok(stuffed.stars < 3, 'набивка не должна давать три звезды');
  assert.ok(stuffed.profit < honest.profit, `набивка ${stuffed.profit} должна быть невыгоднее честной игры ${honest.profit}`);
  assert.ok(stuffed.reasons.some((reason) => /сверх заявки/.test(reason)), 'отчёт должен назвать лишний груз');
});
```

- [ ] **Step 2: Запустить тест**

Run: `node --test tests/balance.test.js`

Expected: PASS, девять тестов.

Если какой-то уровень падает по `onTimePercent`, причина почти наверняка в том, что `SET_ROUTE` вызывается до загрузки всех паллет этой машины — порядок шагов в `play` важен. Если падает по прибыли, смотреть на константы в `scoring.js`: ожидаемые значения — от 1 260 ₽ на первом уровне до 7 380 ₽ на пятом.

- [ ] **Step 3: Прогнать весь набор**

Run: `node --test tests/*.test.js`

Expected: PASS, ноль падений.

- [ ] **Step 4: Коммит**

```bash
git add tests/balance.test.js
git commit -m "test: prove every campaign level is winnable with three stars"
```

---

## Проверка по завершении

- [ ] `node --test tests/*.test.js` — все тесты проходят
- [ ] Первый уровень при честной игре даёт три звезды и 1 260 ₽
- [ ] Набивка кузова даёт меньше звёзд и меньше денег
- [ ] В `index.html` нет ни `цель 90%`, ни `id="utilization"`
- [ ] `scoreShift` больше не экспортируется из `game-engine.js`

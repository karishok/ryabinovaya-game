const test = require('node:test');
const assert = require('node:assert/strict');
const { metricsFor, starsFor, profitFor } = require('../scoring.js');

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

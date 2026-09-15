const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { reduceAction, startLevel, tick, finishShift } = require('../app-state.js');

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

test('tick applies a scheduled demand change once and exposes short feedback', () => {
  const state = startLevel(7);
  const next = tick(state, 120);
  assert.equal(next.orders.find((order) => order.id === 'order-west').quantity, 4);
  assert.deepEqual(next.events.map((event) => event.type), ['demand-increase']);
  assert.equal(next.feedback.code, 'demand-increase');
});

test('end-shift action keeps all report metrics available at the top level', () => {
  const state = {
    ...startLevel(1),
    metrics: { deliveredPercent: 100, onTimePercent: 100, utilizationPercent: 90, spoiledPallets: 0, routePenalty: 0 },
  };
  const next = reduceAction(state, { type: 'END_SHIFT' });
  assert.deepEqual(next.report, {
    stars: 3,
    profit: 16700,
    deliveredPercent: 100,
    onTimePercent: 100,
    utilizationPercent: 90,
    spoiledPallets: 0,
    reasons: [],
    inputs: {
      deliveredPercent: 100,
      onTimePercent: 100,
      utilizationPercent: 90,
      spoiledPallets: 0,
      routePenalty: 0,
      spoilageReasons: [],
    },
  });
});

test('dismiss-feedback removes an operational notification without changing shift state', () => {
  const state = { ...startLevel(1), feedback: { kind: 'info', code: 'vehicle-ready', message: 'Машина готова.' } };
  const next = reduceAction(state, { type: 'DISMISS_FEEDBACK' });
  assert.equal(next.feedback, null);
  assert.equal(next.levelId, 1);
});

test('campaign shell includes briefing, operational feedback, and a complete report', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<script src="levels\.js"><\/script>\s*<script src="app-state\.js"><\/script>/);
  for (const id of ['levelBriefing', 'storyCard', 'eventBanner', 'reportDelivered', 'reportOnTime', 'reportSpoiled', 'nextShift']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Следующая смена/);
});

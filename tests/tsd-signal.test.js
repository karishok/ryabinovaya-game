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

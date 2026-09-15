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

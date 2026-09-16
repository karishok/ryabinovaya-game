const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('final mobile prototype keeps the product vocabulary', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Рябиновая', 'Сухач', 'Заморозка', 'Охлаждёнка', 'Собрать паллету', 'reportModal']) {
    assert.match(html, new RegExp(label));
  }
});

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

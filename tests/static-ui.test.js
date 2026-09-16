const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('final mobile prototype keeps the product vocabulary', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Рябиновая', 'Сухач', 'Заморозка', 'Охлаждёнка', 'Собрать паллету', 'reportModal']) {
    assert.match(html, new RegExp(label));
  }
});

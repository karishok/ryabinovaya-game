const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('living warehouse shell keeps product vocabulary and scene layers', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const label of ['Рябиновая', 'Сухач', 'Заморозка', 'Охлаждёнка', 'Собрать паллету', 'reportModal']) {
    assert.match(html, new RegExp(label));
  }
  for (const id of ['warehouseScene', 'sceneStatus', 'sceneOperator', 'sceneOperatorName', 'sceneAgv', 'scenePallet', 'sceneTruckBay', 'tsdDevice', 'tsdBackdrop', 'tsdScreen']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const zone of ['dry', 'chilled', 'frozen']) {
    assert.match(html, new RegExp(`data-scene-zone="${zone}"`));
  }
  assert.match(html, /assets\/warehouse-center\.webp/);
});

test('warehouse backdrop is an optimized mobile asset', () => {
  const asset = 'assets/warehouse-center.webp';
  assert.equal(fs.existsSync(asset), true);
  assert.ok(fs.statSync(asset).size < 900_000, 'warehouse backdrop must stay below 900 KB');
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

test('the README documents the mobile QA screenshot and the file exists', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /Reference screenshot: `docs\/screenshots\/living-warehouse-mobile\.png`/);
  assert.equal(fs.existsSync('docs/screenshots/living-warehouse-mobile.png'), true);
});

test('vehicle rows use a CSS glyph instead of an emoji', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.doesNotMatch(app, /🚚/, 'app.js should not render the truck emoji over the persistent scene overlay');
  assert.match(app, /class="vehicle-glyph"/);
  assert.match(css, /\.vehicle-glyph/);
});

test('warehouse styles define mobile motion and accessible fallbacks', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(css, /--industrial-green:/);
  assert.match(css, /\.warehouse-scene\s*\{/);
  assert.match(css, /height:\s*clamp\([^;]*svh/);
  assert.match(css, /\[data-mode="to-dispatch"\]/);
  assert.match(css, /\[data-mode="spoiled"\]/);
  assert.match(css, /@media\s*\(max-width:\s*390px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /overflow-x:\s*hidden/);
});

test('warehouse actions are attached to the pallet and truck instead of a bottom control panel', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<button class="scene-pallet" id="scenePallet"[^>]*data-action="OPEN_BUILDER"/);
  assert.match(html, /<button class="truck-bay" id="sceneTruckBay"[^>]*data-action="OPEN_VEHICLES"/);
  assert.doesNotMatch(html, /class="mission-ribbon"/);
  assert.doesNotMatch(html, /class="mission-dock"/);
});

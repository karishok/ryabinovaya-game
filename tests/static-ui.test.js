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
  assert.match(html, /<button class="scene-pallet(?: scene-object)?" id="scenePallet"[^>]*data-action="OPEN_BUILDER"/);
  assert.match(html, /<button class="truck-bay(?: scene-object)?" id="sceneTruckBay"[^>]*data-action="OPEN_VEHICLES"/);
  assert.doesNotMatch(html, /class="mission-ribbon"/);
  assert.doesNotMatch(html, /class="mission-dock"/);
});

test('builder, vehicle and report content share the physical TSD shell', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const id of ['tsdBuilder', 'tsdVehicles', 'tsdReport']) assert.match(html, new RegExp(`id="${id}"`));
  assert.equal((html.match(/class="tsd-device"/g) || []).length, 1);
});

test('route-build action is sticky inside the TSD screen', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /<div class="tsd-sticky-action"><button class="btn full-width" id="routeButton"/);
  assert.match(css, /\.tsd-sticky-action\s*\{[^}]*position:\s*sticky;/s);
});

test('TSD is outside the warehouse stacking context and layers above navigation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(html, /<\/section>\s*<\/section>\s*<div class="tsd-backdrop" id="tsdBackdrop"/);
  assert.match(css, /\.tsd-backdrop\s*\{[^}]*z-index:\s*18;/s);
  assert.match(css, /\.tsd-device\s*\{[^}]*z-index:\s*19;/s);
});

test('scene AGV is decorative and cannot intercept warehouse taps', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(css, /\.agv\s*\{[^}]*pointer-events:\s*none;/s);
});

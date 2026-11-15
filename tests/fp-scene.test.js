const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { FRAMES, LOCATIONS } = require('../fp-view.js');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

test('every place has its frame on disk, light enough for a phone', () => {
  for (const location of LOCATIONS) {
    const path = FRAMES[location];
    assert.equal(fs.existsSync(path), true, `${path} must exist`);
    assert.ok(fs.statSync(path).size < 400_000, `${path} must stay below 400 KB`);
  }
});

test('the page preloads all six frames so a move never shows an empty scene', () => {
  for (const location of LOCATIONS) {
    assert.match(html, new RegExp(`<link rel="preload" as="image" href="${FRAMES[location]}"`));
  }
});

test('the scene shows the frame in two layers and starts in the aisle', () => {
  assert.match(html, /id="sceneBackdropPrev"/);
  assert.match(html, /id="sceneBackdrop"[^>]*data-frame="hub"/);
  assert.match(html, /id="warehouseScene"[^>]*data-location="hub"/);
  assert.doesNotMatch(html, /warehouse-center\.webp/);
});

test('each tap target is visible only in the frame it belongs to', () => {
  const hidden = (place, selector) => new RegExp(`\\.warehouse-scene:not\\(\\[data-location="${place}"\\]\\) ${selector.replace('.', '\\.')}[,\\s{]`);
  assert.match(css, hidden('hub', '.scene-zone-sign'));
  assert.match(css, hidden('receiving', '.scene-dock'));
  assert.match(css, hidden('shelf', '.scene-pallet'));
  // Переезды видны на проезде, у полки и у отгрузки; на приёмке и вне смены их нет.
  assert.match(css, /\.warehouse-scene:not\(\[data-location="hub"\]\):not\(\[data-location="shelf"\]\):not\(\[data-location="shipping"\]\) \.fp-nav[,\s{]/);
  // На проезде нет «На проезд», у отгрузки нет «К отгрузке».
  assert.match(css, /\[data-location="hub"\] #fpToHub/);
  assert.match(css, /\[data-location="shipping"\] #fpToShipping/);
  assert.match(css, hidden('shipping', '.scene-gate'));
  assert.match(css, hidden('shipping', '.truck-bay'));
});

test('three gates stand in the order of the zones and carry the zone temperatures', () => {
  const order = ['dry', 'chilled', 'frozen'].map((zone) => html.indexOf(`data-gate-zone="${zone}"`));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const left = (zone) => Number(css.match(new RegExp(`\\.scene-gate--${zone}\\s*\\{[^}]*left:\\s*([\\d.]+)%`))[1]);
  assert.ok(left('dry') < left('chilled') && left('chilled') < left('frozen'));
  // Те же места по горизонтали, что и у вывесок зон: жёлтое слева, синее справа.
  const signLeft = (zone) => Number(css.match(new RegExp(`\\.scene-zone--${zone}\\s*\\{[^}]*left:\\s*([\\d.]+)%`))[1]);
  assert.ok(signLeft('dry') < signLeft('chilled') && signLeft('chilled') < signLeft('frozen'));
});

test('the departure timer is no longer inside the trucks button', () => {
  const truck = html.slice(html.indexOf('id="sceneTruckBay"'));
  assert.doesNotMatch(truck.slice(0, truck.indexOf('</button>')), /id="truckTimer"/);
  assert.match(html, /id="truckTimer"/);
});

test('frame change is animated and reduced motion switches it off', () => {
  assert.match(css, /\[data-frame-parity="0"\] \.scene-backdrop:not\(\.scene-backdrop--prev\)\s*\{[^}]*animation:\s*fp-enter-a 400ms/);
  assert.match(css, /\[data-frame-parity="1"\] \.scene-backdrop:not\(\.scene-backdrop--prev\)\s*\{[^}]*animation:\s*fp-enter-b 400ms/);
  const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotion, /\.scene-backdrop\s*\{[^}]*animation:\s*none\s*!important/);
});

test('nothing in the frame scene hints at the placement zone', () => {
  // Подсветка «верных» ворот есть, «верной» зоны — нет.
  assert.match(css, /\.scene-gate\.is-focus/);
  assert.doesNotMatch(css, /\.scene-zone-sign\.is-right/);
  assert.doesNotMatch(fs.readFileSync('app.js', 'utf8'), /pending\.zone|inbound\.zone/);
});

test('loaded pallets are drawn only in the shipping frame, with up to three per truck', () => {
  assert.match(css, /\.warehouse-scene:not\(\[data-location="shipping"\]\) \.truck-load[,\s{]/);
  for (const zone of ['dry', 'chilled', 'frozen']) {
    const box = html.match(new RegExp(`<div class="truck-load truck-load--${zone}" id="truckLoad-${zone}"[^>]*>([\\s\\S]*?)</div>`));
    assert.ok(box, `truck-load for ${zone} must exist`);
    assert.equal((box[1].match(/class="truck-pallet"/g) || []).length, 3);
  }
  assert.ok(fs.statSync('assets/fp/pallet-load.webp').size < 60_000);
  // Сколько паллет видно, решает data-pallets, а не отдельные классы.
  assert.match(css, /\.truck-load\[data-pallets="0"\] \.truck-pallet/);
  assert.match(css, /\.truck-load\[data-pallets="1"\] \.truck-pallet:nth-child\(n\+2\)/);
  assert.match(css, /\.truck-load\[data-pallets="2"\] \.truck-pallet:nth-child\(3\)/);
});

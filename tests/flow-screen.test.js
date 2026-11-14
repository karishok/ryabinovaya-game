const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const app = fs.readFileSync('flow-app.js', 'utf8');
const screen = html.slice(html.indexOf('data-screen="flow"'), html.indexOf('<div class="tsd-backdrop"'));

test('the flow mode is a screen of its own, not a graft onto the campaign', () => {
  /* У режима другой темп и другие правила. Слепить его с экраном кампании
     значило бы делить с ней DOM и ломать обоим. */
  assert.match(html, /<section class="screen flow" data-screen="flow">/);
  const campaign = html.slice(html.indexOf('data-screen="warehouse"'), html.indexOf('data-screen="flow"'));
  for (const id of ['flowGates', 'flowPallets', 'flowStrip', 'flowReport']) {
    assert.doesNotMatch(campaign, new RegExp(`id="${id}"`), `${id} не должен жить внутри кампании`);
  }
});

test('the flow controller keeps its hands off the campaign click stream', () => {
  // Кампания слушает data-action; общий обработчик ловил бы её нажатия.
  assert.match(app, /closest\('\[data-flow-action\]'\)/);
  assert.doesNotMatch(app, /closest\('\[data-action\]'\)/);
  assert.match(screen, /data-flow-action="LEAVE"/);
  assert.doesNotMatch(screen, /data-action="/);
});

test('entering the mode hides the campaign terminal, leaving it restores it', () => {
  /* Терминал кампании нарисован фиксированно поверх страницы и на экране
     конца кампании держится открытым принудительно — без этого он лёг бы
     поверх смены. */
  assert.match(app, /showCampaignOverlay\(false\)/);
  assert.match(app, /showCampaignOverlay\(true\)/);
  assert.match(app, /getElementById\('tsdDevice'\).*getElementById\('tsdBackdrop'\)/s);
});

test('the report takes the whole screen instead of stacking on the live shift', () => {
  for (const id of ['flowHead', 'flowStation', 'flowStrip']) {
    assert.match(app, new RegExp(`byId\\('${id}'\\)\\.hidden = !view\\.running`),
      `${id} должен скрываться под отчётом`);
  }
  assert.match(app, /byId\('flowReport'\)\.hidden = view\.running/);
});

test('the shift clock is stopped on every exit so it cannot tick on in the background', () => {
  assert.match(app, /function leave\(\)[\s\S]*?stopClock\(\)/);
  assert.match(app, /function startShift\(\)[\s\S]*?stopClock\(\)/);
  assert.match(app, /if \(state\.phase !== 'running'\) stopClock\(\)/);
});

test('the mode is reachable from the end of the campaign, which used to be a dead end', () => {
  const endless = html.slice(html.indexOf('id="tsdEndless"'), html.indexOf('id="builderModal"'));
  assert.match(endless, /data-flow-action="START_FLOW"/);
  assert.doesNotMatch(endless, /ещё в разработке/i);
});

test('the flow screen carries its own styles and a zone mark per temperature', () => {
  assert.match(css, /\.flow-zone-mark\[data-zone="chilled"\]/);
  assert.match(css, /\.flow-zone-mark\[data-zone="frozen"\]/);
  assert.match(css, /\.flow-zone-mark\[data-zone="dry"\]/);
  // Полоса срока — единственное место, где видно, сколько паллете осталось.
  assert.match(css, /\.flow-pallet\.is-critical/);
});

test('every module the flow screen needs is loaded, in dependency order', () => {
  const order = ['game-engine.js', 'levels.js', 'flow-engine.js', 'flow-view.js', 'flow-app.js']
    .map((file) => html.indexOf(`src="${file}"`));
  assert.ok(order.every((at) => at > -1), 'все модули режима должны быть подключены');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'модуль должен грузиться после своих зависимостей');
});

test('the outbound half of the warehouse is on the screen: stock, dock and vans', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('flow-app.js', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  const screen = html.slice(html.indexOf('data-screen="flow"'));
  for (const id of ['flowOutbound', 'flowStock', 'flowStaging', 'flowVans']) assert.match(screen, new RegExp(`id="${id}"`));
  // Отбор и погрузка — свои действия в общем потоке нажатий режима.
  assert.match(app, /flowAction === 'PICK'/);
  assert.match(app, /flowAction === 'LOAD'/);
  assert.match(app, /data-flow-action="\$\{picking \? 'PICK' : 'LOAD'\}"/);
  // Срочный фургон обязан выделяться: он уйдёт пустым.
  assert.match(css, /\.flow-van\.is-critical/);
  // Отчёт называет итог выхода, а не только входа.
  assert.match(app, /'Отгружено', view\.report\.shipped/);
  assert.match(app, /'Сорвано', view\.report\.missed/);
});

test('incoming goods carry no zone mark on the screen', () => {
  const app = require('node:fs').readFileSync('flow-app.js', 'utf8');
  const gate = app.slice(app.indexOf('function gateMarkup'), app.indexOf('function palletMarkup'));
  const pallet = app.slice(app.indexOf('function palletMarkup'), app.indexOf('function vanMarkup'));
  assert.doesNotMatch(gate, /flow-zone-mark/);
  assert.doesNotMatch(pallet, /flow-zone-mark/);
});

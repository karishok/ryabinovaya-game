const engine = window.RyabinovayaEngine;
// Названия дарксторов и зон — из данных уровней, а не второй копией здесь.
const { LEVELS, ZONE_NAMES: zones, STORE_NAMES: stores, ZONE_MARKS: zoneMarks } = window.RyabinovayaLevels;
const {
  reduceAction, startLevel, liveMetrics, fulfillmentFor, missingRouteVehicles,
  activeOrderFor, remainingFor, vehicleForPallet, vehicleLabel: labelFor, roomIn, orphanPalletsFor,
  currentTaskFor, nextTaskFor, guidedFor,
} = window.RyabinovayaAppState;
const { warehouseViewFor } = window.RyabinovayaSceneView;
const { terminalViewFor } = window.RyabinovayaTsdView;
const { signalTsd } = window.RyabinovayaTsdSignal || { signalTsd: () => {} };
const itemDetails = {
  water: { emoji: '💧', name: 'Вода 1,5 л' }, milk: { emoji: '🥛', name: 'Молоко' }, banana: { emoji: '🍌', name: 'Бананы' }, bread: { emoji: '🍞', name: 'Хлеб' }, 'ice-cream': { emoji: '🍨', name: 'Мороженое' },
};
const items = Object.values(engine.ITEMS).map((item) => ({ ...item, ...itemDetails[item.sku] }));
/* Игра помнит, на какой смене остановились: вкладку закрывают, а проходить
   обучение заново ради пятой смены никто не станет. Хранилище может быть
   недоступно (приватное окно, тесты) — тогда просто начинаем с первой. */
const LEVEL_KEY = 'ryabinovaya.level';
const savedLevelId = () => {
  try {
    const id = Number(window.localStorage?.getItem(LEVEL_KEY));
    return LEVELS.some((level) => level.id === id) ? id : 1;
  } catch (error) { return 1; }
};
const rememberLevel = (levelId) => {
  try { window.localStorage?.setItem(LEVEL_KEY, String(levelId)); } catch (error) { /* не страшно */ }
};
let state = startLevel(savedLevelId());
let rememberedLevelId = null;
let tsdReturnFocus = null;
let lastTsdSignal = 'idle';
let audioContext = null;
let audioUnlocked = false;

const byId = (document, id) => document.getElementById(id);
const quantityFor = (pallet, sku) => pallet.items.filter((item) => item.sku === sku).reduce((total, item) => total + item.quantity, 0);
const levelFor = (levelId) => LEVELS.find((level) => level.id === levelId);
const screenForTsd = (nextState, baseScreen) => {
  if (nextState.report || nextState.phase === 'report') return 'report';
  if (nextState.builderOpen) return 'builder';
  if (nextState.vehicleDrawerOpen) return 'vehicles';
  if (nextState.guideOpen) return 'guide';
  if (nextState.phase === 'endless') return 'endless';
  if (nextState.phase === 'briefing' || nextState.phase === 'story-after') return 'briefing';
  /* Только ошибка забирает экран терминала. Успех и рабочие уведомления
     уходят в тост: раньше каждая собранная паллета требовала лишнего
     нажатия «Продолжить» на полноэкранном сообщении. */
  if (nextState.feedback?.kind === 'error') return 'feedback';
  if (baseScreen === 'inbound') return 'inbound';
  /* На смене с очередью экран задаёт сама очередь: предложено задание —
     экран задания, принято — текущая работа. Запомненный в состоянии экран
     тут устаревает после каждого выполненного задания. */
  if (!guidedFor(nextState) && nextState.phase === 'shift') return baseScreen;
  if (nextState.tsd?.screen === 'task') return 'task';
  return nextState.tsd?.screen || baseScreen;
};
const tsdViewFor = (nextState) => {
  const baseView = terminalViewFor(nextState);
  const screen = screenForTsd(nextState, baseView.screen);
  const titleByScreen = {
    builder: 'Сборка паллеты',
    vehicles: 'Машины и маршрут',
    guide: 'Как играть?',
    feedback: 'Ошибка',
  };
  const panelScreen = ['builder', 'vehicles', 'guide'].includes(screen);
  return {
    ...baseView,
    open: baseView.open || !['current', 'task', 'inbound'].includes(screen),
    screen,
    // Панели сборки и транспорта — модальные диалоги, их затемнение нужно.
    blocking: baseView.blocking || panelScreen || screen === 'feedback',
    showOrderBlock: baseView.showOrderBlock && !panelScreen,
    // У панелей есть собственный крестик; второй, ничего не закрывающий,
    // только путал — CLOSE_TSD на открытой панели не давал эффекта.
    canClose: baseView.canClose && !panelScreen,
    title: titleByScreen[screen] || baseView.title,
    /* Пока фура стоит на приёмке, базовый экран терминала — накладная. Её
       строка и кнопка «Принять паллету» вылезали в шапку сборки и экрана
       фургона, хотя к ним не относятся. */
    message: screen === 'feedback' ? nextState.feedback?.message || baseView.message : panelScreen ? '' : baseView.message,
    canReceive: baseView.canReceive && !panelScreen,
    canAccept: baseView.canAccept && !panelScreen,
  };
};
const orderLabel = (order) => {
  const item = itemDetails[order.sku] || { emoji: '📦', name: order.sku };
  return `${item.emoji} ${item.name} · ${order.quantity} шт.`;
};
const orderMarkup = (order) => `<div class="order-row"><strong>${stores[order.storeId] || order.storeId}</strong><span>${orderLabel(order)} · ${zones[order.zone]}</span></div>`;
function playWarehouseBeep(kind) {
  if (!audioUnlocked) return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    audioContext ||= new AudioContextCtor();
    const resumeResult = audioContext.resume?.();
    if (resumeResult && typeof resumeResult.catch === 'function') resumeResult.catch(() => {});
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = kind === 'error' ? 220 : kind === 'success' ? 660 : 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.12);
  } catch (_error) {
    audioContext = null;
  }
}

function renderScene(view, document) {
  const scene = byId(document, 'warehouseScene');
  scene.dataset.mode = view.mode;
  scene.dataset.activeZone = view.activeZone;
  scene.dataset.selectedZone = view.selectedZone;
  scene.dataset.vehicleZone = view.selectedVehicleZone || '';
  scene.dataset.event = view.eventCode || '';
  scene.dataset.highlight = view.highlightObject || '';
  // Что подсвечено, решает следующий шаг, а не последнее действие игрока.
  scene.dataset.focus = view.focus || '';
  // Ворота мигают только когда порядок остановок ещё можно сократить.
  scene.dataset.routeAttention = String(view.routeCanBeShortened);
  byId(document, 'sceneStatus').textContent = view.statusText;
  byId(document, 'sceneOperatorName').textContent = view.operatorName;
  const scenePallet = byId(document, 'scenePallet');
  scenePallet.style.setProperty('--pallet-fill', `${view.palletFillPercent}%`);
  const palletGoal = byId(document, 'palletGoal');
  palletGoal.hidden = !view.palletGoalText;
  palletGoal.textContent = view.palletGoalText;
  scenePallet.setAttribute('aria-label', view.palletGoalText
    ? `Текущая паллета: ${view.palletGoalText}, заполнена на ${view.palletFillPercent}%`
    : `Текущая паллета заполнена на ${view.palletFillPercent}%`);
  const truckBay = byId(document, 'sceneTruckBay');
  truckBay.dataset.routeReady = String(view.routeReady);
  truckBay.dataset.loadedPallets = String(view.loadedPalletCount);
  const dock = byId(document, 'sceneDock');
  dock.hidden = view.inboundCount === 0;
  dock.dataset.awaiting = String(Boolean(view.awaitingPlacement));
  byId(document, 'dockBadge').textContent = String(view.inboundCount);
  scenePallet.classList.toggle('is-focus', view.focus === 'pallet');
  truckBay.classList.toggle('is-focus', view.focus === 'truck');
  dock.classList.toggle('is-focus', view.focus === 'dock');
  document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
    const active = zone.dataset.sceneZone === view.activeZone;
    const selected = zone.dataset.sceneZone === view.selectedZone;
    // На размещении шаг указывает на все вывески сразу, а не на верную.
    zone.classList.toggle('is-focus', view.focus === 'zones');
    zone.classList.toggle('is-active', active);
    zone.classList.toggle('is-selected', selected && !view.awaitingPlacement);
    zone.classList.toggle('is-target', Boolean(view.awaitingPlacement));
    zone.setAttribute('aria-current', String(active));
  });
}

/* Карточка «Сейчас»: заголовок, детали и кнопка следующего шага. Кнопка
   несёт тот же data-action, что и объект на схеме, поэтому проходит через
   общий обработчик кликов без отдельной ветки. */
function renderNowCard(step, document) {
  const card = byId(document, 'nowCard');
  if (!card) return;
  card.hidden = !step;
  if (!step) return;
  card.dataset.step = step.key;
  byId(document, 'nowTitle').textContent = step.title;
  byId(document, 'nowDetail').textContent = step.detail;
  const button = byId(document, 'nowAction');
  /* У шага может не быть кнопки: размещение игрок выполняет сам, нажав
     вывеску зоны, и кнопка-автопилот выбрала бы зону за него. */
  button.hidden = !step.action;
  button.textContent = step.actionLabel;
  button.dataset.action = step.action || '';
  if (step.zone) {
    button.dataset.zone = step.zone;
    button.dataset.sceneZone = step.zone;
  } else {
    delete button.dataset.zone;
    delete button.dataset.sceneZone;
  }
  if (step.vehicleId) button.dataset.vehicleId = step.vehicleId;
  else delete button.dataset.vehicleId;
}

/* Доска заявок — табло. Раньше её строка была кнопкой, и заявку выбирали
   с доски; теперь задания выдаёт ТСД, а доска только показывает, что в
   работе, что терминал предложит следующим и что уже уехало. */
function renderOrderBoard(rows, document) {
  const board = byId(document, 'orderBoard');
  if (!board) return;
  board.hidden = !rows;
  if (!rows) return;
  // Восемь заявок «Большого развоза» в обычных строках не помещаются под схемой.
  board.classList.toggle('is-dense', rows.length > 6);
  byId(document, 'orderBoardRows').innerHTML = rows.map((row) => {
    const progress = row.status === 'cancelled' ? '' : `<b class="order-progress">${row.loaded} / ${row.quantity}${row.status === 'done' ? ' ✓' : ''}</b>`;
    const mark = row.active ? ' · <em class="order-mark">в работе</em>' : row.next ? ` · <em class="order-mark">${row.urgent ? 'срочно' : 'на ТСД'}</em>` : '';
    const detail = row.status === 'cancelled'
      ? row.note
      : `<i class="order-zone" data-zone="${row.zone}">${row.zoneMark}</i> ${row.itemName}${row.note ? ` · ${row.note}` : ''}${mark}`;
    const body = `<span class="order-top"><strong>${row.storeName}</strong>${progress}</span><small class="order-detail">${detail}</small>`;
    return `<div class="order-line${row.alert ? ' is-alert' : ''}${row.active ? ' is-active' : ''}" data-status="${row.status}">${body}</div>`;
  }).join('');
}

function renderTsd(view, document) {
  const device = byId(document, 'tsdDevice');
  device.dataset.open = String(view.open);
  device.dataset.screen = view.screen;
  device.dataset.signal = view.signal;
  const hardware = byId(document, 'tsdHardware');
  hardware.setAttribute('aria-hidden', String(view.open));
  hardware.setAttribute('tabindex', view.open ? '-1' : '0');
  /* Рядом с прибором ничего не написано, поэтому задание переезжает в
     подпись кнопки: глазами его видно нажатием, экранным читалкам — сразу. */
  hardware.setAttribute('aria-label', `ТСД. ${view.compactKicker}: ${view.compactTask}`);
  hardware.dataset.attention = String(view.attention);
  byId(document, 'tsdBackdrop').setAttribute('aria-hidden', String(!view.blocking));
  byId(document, 'tsdScreen').setAttribute('aria-hidden', String(!view.open));
  byId(document, 'tsdTitle').textContent = view.title;
  /* Одни и те же строки заявки раньше печатались и в шапке терминала, и в
     карточках экрана. Шапку показываем только там, где она и есть задание. */
  byId(document, 'tsdStore').hidden = !view.showOrderBlock;
  byId(document, 'tsdOrder').hidden = !view.showOrderBlock;
  byId(document, 'tsdZone').hidden = !view.showOrderBlock || !view.zoneName;
  byId(document, 'tsdProgress').hidden = !view.showOrderBlock || !view.progressText;
  byId(document, 'tsdStore').textContent = view.storeName;
  byId(document, 'tsdOrder').textContent = view.orderText;
  byId(document, 'tsdZone').textContent = view.zoneName ? `Зона: ${view.zoneName}` : '';
  byId(document, 'tsdProgress').textContent = view.progressText;
  byId(document, 'tsdTaskStore').textContent = view.storeName;
  byId(document, 'tsdTaskOrder').textContent = view.orderText;
  byId(document, 'tsdTaskZone').textContent = view.zoneName;
  // Подписи карточек задания свои для сборки и для снятия паллеты.
  const [storeLabel, orderLabelText, zoneLabel] = view.taskLabels || ['Куда', 'Что собрать', 'Зона хранения'];
  byId(document, 'tsdTaskStoreLabel').textContent = storeLabel;
  byId(document, 'tsdTaskOrderLabel').textContent = orderLabelText;
  byId(document, 'tsdTaskZoneLabel').textContent = zoneLabel;
  const defer = byId(document, 'tsdDefer');
  defer.hidden = !view.canDefer;
  defer.textContent = view.deferLabel || 'Отложить';
  const urgent = byId(document, 'tsdUrgent');
  urgent.hidden = !view.canTakeUrgent;
  urgent.textContent = view.urgentLabel || 'Взять срочное';
  const message = byId(document, 'tsdMessage');
  message.textContent = view.message;
  // Пустая строка статуса всё равно держала 24 px в шапке прибора.
  message.hidden = !view.message;
  const continueStory = byId(document, 'tsdContinueStory');
  // На экране конца кампании эта кнопка ничего не делала — там своя.
  continueStory.hidden = view.screen !== 'briefing';
  continueStory.textContent = view.storyKind === 'after' ? 'Продолжить' : 'Начать смену';
  byId(document, 'tsdAccept').hidden = !view.canAccept;
  byId(document, 'tsdReceive').hidden = !view.canReceive;
  byId(document, 'tsdClose').hidden = !view.canClose;
  byId(document, 'tsdInboundSupplier').textContent = view.storeName;
  byId(document, 'tsdInboundGoods').textContent = view.orderText;
  byId(document, 'tsdContinue').hidden = view.screen !== 'report';
  byId(document, 'tsdFeedbackContinue').hidden = view.screen !== 'feedback';
  const panels = document.querySelectorAll ? document.querySelectorAll('[data-tsd-panel]') : [];
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.tsdPanel !== view.screen;
    panel.setAttribute('aria-hidden', String(panel.hidden));
  });
  byId(document, 'warehouseScene').setAttribute('aria-hidden', 'false');
}

/* Карта центра и дарксторов по тем же координатам, которыми движок считает
   длину рейса. Без неё игрок не может судить, какой порядок остановок
   короче, и «Вовремя» выглядит произвольной оценкой. */
function routeMapSvg(state, routeStops) {
  const pointOf = (id) => {
    const [x, y] = engine.STORE_COORDINATES[id] || [0, 0];
    return [x, -y];
  };
  const [depotX, depotY] = pointOf('depot');
  const line = routeStops.length
    ? `<polyline class="map-route" points="${['depot', ...routeStops].map((id) => pointOf(id).join(',')).join(' ')}" />`
    : '';
  const nodes = (state.stores || []).map((store) => {
    const [x, y] = pointOf(store.id);
    const order = routeStops.indexOf(store.id);
    const visited = order >= 0;
    return `<circle class="map-node${visited ? ' is-visited' : ''}" cx="${x}" cy="${y}" r="0.34" />`
      + (visited ? `<text class="map-index" x="${x}" y="${y + 0.12}">${order + 1}</text>` : '')
      + `<text class="map-label" x="${x}" y="${y - 0.52}">${stores[store.id] || store.id}</text>`;
  }).join('');
  return `<svg viewBox="-4.1 -4.1 9.2 5.2" role="img" aria-label="Карта дарксторов и текущего маршрута">`
    + line
    + `<rect class="map-depot" x="${depotX - 0.28}" y="${depotY - 0.28}" width="0.56" height="0.56" />`
    + `<text class="map-label" x="${depotX}" y="${depotY + 0.78}">Рябиновая</text>`
    + nodes
    + '</svg>';
}

/* Подсказка говорит, есть ли запас, но не диктует порядок: раньше здесь
   печатался готовый оптимум, и единственное решение в игре решалось за
   игрока. Точный лучший маршрут показывается в отчёте — после смены. */
function routeSummaryHtml(routeStops, guided = true) {
  if (!routeStops.length) return 'Загрузите паллеты — их адреса появятся в маршруте.';
  const current = engine.buildRoute(null, routeStops).minutes;
  if (routeStops.length === 1) return `Рейс — <b>${current} мин</b> до адреса «${stores[routeStops[0]] || routeStops[0]}».`;
  // Без поводыря экран называет только длину рейса: короче ли он — видно по карте.
  if (!guided) return `Ваш порядок — <b>${current} мин</b>.`;
  const best = engine.bestRoute(routeStops);
  if (current <= best.minutes) return `Ваш порядок — <b>${current} мин</b>. Короче не выйдет.`;
  const gap = current - best.minutes;
  return `Ваш порядок — <b>${current} мин</b>. Можно быстрее на <b>${gap} мин</b> — переставьте остановки по карте.`;
}

function render(nextState, document) {
  const sceneView = warehouseViewFor(nextState);
  const view = tsdViewFor(nextState);
  renderScene(sceneView, document);
  renderTsd(view, document);
  if (view.signal !== lastTsdSignal) {
    const navigatorApi = typeof navigator !== 'undefined' ? navigator : window.navigator;
    signalTsd(view.signal, {
      vibrate: (pattern) => navigatorApi?.vibrate?.(pattern),
      beep: (kind) => playWarehouseBeep(kind),
    });
    lastTsdSignal = view.signal;
  }
  const level = levelFor(nextState.levelId);
  const selectedVehicle = nextState.vehicles.find((vehicle) => vehicle.id === nextState.selectedVehicleId) || nextState.vehicles[0];
  const minutes = String(Math.floor(nextState.secondsRemaining / 60)).padStart(2, '0');
  const seconds = String(nextState.secondsRemaining % 60).padStart(2, '0');
  byId(document, 'levelTitle').textContent = `Уровень ${nextState.levelId} · ${level.title}`;
  byId(document, 'clock').textContent = `${minutes}:${seconds}`;
  const fulfillment = fulfillmentFor(nextState);
  byId(document, 'orders').textContent = `${fulfillment.fulfilledQuantity} / ${fulfillment.demandQuantity}`;
  const metrics = liveMetrics(nextState);
  /* До первой погрузки считать нечего. Ноль вместо прочерка читался как
     «ты уже всё испортил», хотя смена ещё не начиналась. */
  const hasShipped = nextState.loadedPallets.length > 0;
  byId(document, 'ontime').textContent = hasShipped ? `${metrics.onTimePercent}%` : '—';
  byId(document, 'precision').textContent = hasShipped ? `${metrics.precisionPercent}%` : '—';
  byId(document, 'mapPallets').textContent = `${nextState.loadedPallets.length} палл.`;
  byId(document, 'vehicleName').textContent = selectedVehicle ? labelFor(nextState, selectedVehicle) : 'Выберите машину';
  byId(document, 'guideOrders').innerHTML = nextState.orders.filter((order) => !order.cancelled).map(orderMarkup).join('') || '<p>Все заявки закрыты.</p>';

  const pause = document.querySelector('[data-action="PAUSE"]');
  pause.disabled = nextState.phase !== 'shift';
  pause.classList.toggle('active', nextState.paused);
  pause.textContent = nextState.paused ? '▶' : 'Ⅱ';
  document.querySelectorAll('.store-select').forEach((button) => {
    const available = nextState.stores.some((store) => store.id === button.dataset.store);
    button.hidden = !available;
    button.classList.toggle('selected', button.dataset.store === nextState.pallet.storeId);
  });
  document.querySelectorAll('.zone-select').forEach((button) => {
    const available = nextState.unlockedZones.includes(button.dataset.zone);
    button.hidden = !available;
    button.classList.toggle('selected', button.dataset.zone === nextState.pallet.zone);
  });
  document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
    const unlocked = nextState.unlockedZones.includes(zone.dataset.sceneZone);
    zone.classList.toggle('locked', !unlocked);
    zone.disabled = !unlocked;
    /* Закрытой зоны на схеме нет вовсе: полупрозрачная кнопка всё равно
       читалась как «куда-то надо нажать» на уровне с одной зоной. */
    zone.hidden = !unlocked;
  });
  if (nextState.levelId !== rememberedLevelId) {
    rememberedLevelId = nextState.levelId;
    rememberLevel(nextState.levelId);
  }
  renderNowCard(sceneView.nextStep, document);
  renderOrderBoard(sceneView.orderBoard, document);

  byId(document, 'itemRows').innerHTML = items.filter((item) => item.zone === nextState.pallet.zone).map((item) => `<div class="item-row">
    <span class="item-emoji">${item.emoji}</span><div><strong>${item.name}</strong><small>${item.weightPerUnit} кг · ${zones[item.zone]}</small></div>
    <div class="qty"><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="-1" aria-label="Убрать ${item.name}">−</button><b>${quantityFor(nextState.pallet, item.sku)}</b><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="1" aria-label="Добавить ${item.name}">+</button></div>
  </div>`).join('');
  byId(document, 'capacity').textContent = `${nextState.pallet.weight} / ${nextState.pallet.capacity} кг`;
  // Адрес и зону на смене с очередью задаёт задание — выбирать их нечем.
  byId(document, 'builderTarget').hidden = !guidedFor(nextState);
  byId(document, 'builderTargetLabel').textContent = `${stores[nextState.pallet.storeId] || nextState.pallet.storeId} · ${zones[nextState.pallet.zone]}`;
  /* Куда поедет паллета, видно до нажатия: на смене с делением заявки это
     единственный способ понять, что остаток уходит во вторую машину. */
  const pick = vehicleForPallet(nextState, nextState.pallet, nextState.selectedVehicleId);
  const targetMessages = {
    'fleet-full': 'все фургоны зоны загружены',
    'vehicle-not-ready': 'в готовые фургоны не влезает, ещё один в рейсе',
    'no-vehicle': 'фургона этой зоны в смене нет',
  };
  byId(document, 'capacityTarget').textContent = pick.vehicle
    ? `→ ${labelFor(nextState, pick.vehicle)}, свободно ${roomIn(pick.vehicle)} кг`
    : `→ ${targetMessages[pick.reason] || 'машина не найдена'}`;
  /* Задание в шапке панели: экран задания мы больше не показываем
     принудительно, значит адрес и товар должны быть видны там, где собирают. */
  /* Задание — та заявка, под которую адресована паллета: на смене без
     поводыря игрок сам выбирает, какую брать, и первая открытая по списку
     уже не обязательно она. */
  const activeOrder = nextState.orders.find((order) => !order.cancelled && remainingFor(nextState, order) > 0
    && order.storeId === nextState.pallet.storeId && order.zone === nextState.pallet.zone)
    || activeOrderFor(nextState);
  byId(document, 'builderTask').textContent = activeOrder
    ? `Задание: ${stores[activeOrder.storeId]} · ${orderLabel({ ...activeOrder, quantity: remainingFor(nextState, activeOrder) })} · ${zones[activeOrder.zone]}`
    : 'Все заявки закрыты — можно завершать смену.';
  byId(document, 'vehicleTask').textContent = selectedVehicle
    ? `${labelFor(nextState, selectedVehicle)} · ${selectedVehicle.pallets.length} палл.`
    : 'Машина не выбрана';
  const routelessVehicles = new Set(missingRouteVehicles(nextState));
  byId(document, 'vehicleRows').innerHTML = nextState.vehicles.map((vehicle) => {
    /* Статус описывает машину, а не совпадение с текущей пустой паллетой:
       загруженный фургон, который как раз маршрутизируют, раньше подписывался
       «другая зона». */
    const loadedKg = vehicle.pallets.reduce((total, pallet) => total + pallet.weight, 0);
    const stops = nextState.routeStopsByVehicle?.[vehicle.id]?.length || 0;
    const status = !vehicle.ready
      ? 'ожидаем'
      : routelessVehicles.has(vehicle.id)
        ? 'нет маршрута'
        : stops > 0
          ? `${loadedKg} / ${vehicle.capacity} кг · ${stops} ост.`
          : 'пусто';
    return `<button class="vehicle-row ${vehicle.id === nextState.selectedVehicleId ? 'selected' : ''}" data-action="SELECT_VEHICLE" data-vehicle-id="${vehicle.id}" ${vehicle.ready ? '' : 'disabled'} aria-label="${labelFor(nextState, vehicle)}"><strong>${labelFor(nextState, vehicle).replace(' фургон', '')}</strong><b class="${routelessVehicles.has(vehicle.id) ? 'warn' : ''}">${status}</b></button>`;
  }).join('');
  /* Список машин нужен, только когда есть из чего выбирать: с одним
     фургоном он повторял заголовок панели. */
  byId(document, 'vehicleRows').hidden = nextState.vehicles.length < 2;
  const inBay = selectedVehicle?.pallets || [];
  /* Паллета отменённой заявки помечена прямо в кузове: иначе на экране
     фургона не видно, какую из трёх одинаковых строк надо снять. */
  const orphanIndexes = new Set(orphanPalletsFor(nextState)
    .filter((entry) => entry.vehicleId === selectedVehicle?.id)
    .map((entry) => entry.palletIndex));
  /* Паллеты в один адрес с одним товаром — одна строка со счётчиком. Раньше
     каждая паллета была отдельной строкой, и дозаказ или деление заявки
     печатали «Саларьево · Хлеб» по два-три раза подряд. «Снять» убирает
     одну паллету из группы. */
  const bayGroups = [];
  inBay.forEach((pallet, index) => {
    const goods = (pallet.items || []).map((item) => itemDetails[item.sku]?.name || item.sku).join(', ');
    const orphan = orphanIndexes.has(index);
    const key = `${pallet.storeId}|${goods}|${orphan}`;
    let group = bayGroups.find((entry) => entry.key === key);
    if (!group) { group = { key, storeId: pallet.storeId, goods, orphan, count: 0, weight: 0, quantity: 0, lastIndex: index }; bayGroups.push(group); }
    group.count += 1;
    group.weight += pallet.weight;
    group.quantity += (pallet.items || []).reduce((total, item) => total + item.quantity, 0);
    group.lastIndex = index;
  });
  const routeStops = nextState.routeStops || [];
  /* Карта и стрелки нужны, когда остановок хотя бы две: с одной они
     занимали пол-экрана и не давали ничего решить. */
  const reorderable = routeStops.length > 1;
  const routeMap = byId(document, 'routeMap');
  routeMap.hidden = !reorderable;
  routeMap.innerHTML = reorderable ? routeMapSvg(nextState, routeStops) : '';
  byId(document, 'routeSummary').innerHTML = routeSummaryHtml(routeStops, sceneView.guided);
  byId(document, 'routeStopsLabel').textContent = inBay.length
    ? `Остановки и груз · ${inBay.reduce((total, pallet) => total + pallet.weight, 0)} кг`
    : 'Остановки и груз';
  const loadLine = (group, leg = '') => `<small>${leg}${group.goods || 'пусто'} · ${group.quantity}&nbsp;шт. · ${group.weight}&nbsp;кг${group.count > 1 ? ` · ${group.count}&nbsp;паллеты` : ''}${group.orphan ? '<em>заявка отменена</em>' : ''}</small>`;
  const unloadButton = (group) => `<button class="stop-unload${group.orphan ? ' is-orphan' : ''}" data-action="UNLOAD_PALLET" data-vehicle-id="${selectedVehicle.id}" data-pallet-index="${group.lastIndex}">${group.count > 1 ? 'Снять 1' : 'Снять'}</button>`;
  // Адрес без остановки в маршруте быть не должен, но груз не прячем и тогда.
  const stopIds = [...routeStops, ...bayGroups.map((group) => group.storeId).filter((storeId) => !routeStops.includes(storeId))]
    .filter((storeId, index, list) => list.indexOf(storeId) === index);
  byId(document, 'routeStops').innerHTML = stopIds.length ? stopIds.map((storeId) => {
    const index = routeStops.indexOf(storeId);
    const [first, ...rest] = bayGroups.filter((group) => group.storeId === storeId);
    // Плечо стоит в строке груза: заголовок остановки остаётся коротким и не переносится.
    const leg = index >= 0 ? `<b class="leg">${engine.legMinutes(index === 0 ? 'depot' : routeStops[index - 1], storeId)}&nbsp;мин</b> · ` : '';
    const arrows = reorderable && index >= 0
      ? `<button class="stop-move" data-action="MOVE_STOP" data-index="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Выше">↑</button><button class="stop-move" data-action="MOVE_STOP" data-index="${index}" data-direction="1" ${index === routeStops.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>`
      : '';
    const extra = rest.map((group) => `<div class="stop-extra${group.orphan ? ' is-orphan' : ''}"><span>${loadLine(group)}</span>${unloadButton(group)}</div>`).join('');
    return `<div class="route-stop${first?.orphan ? ' is-orphan' : ''}"><div class="stop-main"><span class="stop-text"><strong>${index >= 0 ? `${index + 1}. ` : ''}${stores[storeId] || storeId}</strong>${first ? loadLine(first, leg) : `<small>${leg}</small>`}</span><span class="stop-actions">${arrows}${first ? unloadButton(first) : ''}</span></div>${extra}</div>`;
  }).join('') : '<p class="empty-route">Кузов пуст.</p>';
  byId(document, 'routeButton').textContent = routeStops.length
    ? `Готово · рейс ${engine.buildRoute(null, routeStops).minutes} мин`
    : 'Остановок пока нет';

  const builder = byId(document, 'builderModal');
  builder.classList.toggle('open', nextState.builderOpen);
  builder.setAttribute('aria-hidden', String(!nextState.builderOpen));
  const builderFeedback = byId(document, 'builderFeedback');
  const isBuilderError = nextState.builderOpen && nextState.feedback?.kind === 'error';
  builderFeedback.textContent = isBuilderError ? nextState.feedback.message : '';
  builderFeedback.classList.toggle('show', isBuilderError);
  const vehicleModal = byId(document, 'vehicleModal');
  vehicleModal.classList.toggle('open', nextState.vehicleDrawerOpen);
  vehicleModal.setAttribute('aria-hidden', String(!nextState.vehicleDrawerOpen));

  const guideModal = byId(document, 'guideModal');
  guideModal.classList.toggle('open', nextState.guideOpen);
  guideModal.setAttribute('aria-hidden', String(!nextState.guideOpen));
  document.querySelectorAll('[data-action="OPEN_GUIDE"]').forEach((button) => {
    button.setAttribute('aria-expanded', String(nextState.guideOpen));
  });

  const reportModal = byId(document, 'reportModal');
  reportModal.classList.toggle('open', false);
  reportModal.setAttribute('aria-hidden', String(nextState.report ? false : true));
  if (nextState.report) {
    byId(document, 'reportStars').textContent = '★'.repeat(nextState.report.stars);
    byId(document, 'reportDelivered').textContent = `${nextState.report.deliveredPercent}%`;
    byId(document, 'reportOnTime').textContent = `${nextState.report.onTimePercent}%`;
    byId(document, 'reportPrecision').textContent = `${nextState.report.precisionPercent}%`;
    byId(document, 'reportSpoiled').textContent = String(nextState.report.spoiledPallets);
    byId(document, 'reportProfit').textContent = `${nextState.report.profit.toLocaleString('ru-RU')} ₽`;
    /* Первую причину печатает шапка прибора, поэтому список продолжает с
       второй, а не начинает с той же строки заново. */
    byId(document, 'reportReasons').innerHTML = nextState.report.reasons.slice(1, 3).map((reason) => `<li>${reason}</li>`).join('');
    byId(document, 'tsdContinue').textContent = nextState.nextLevelId ? 'Следующая смена' : 'Завершить кампанию';
  }

  /* Карточка нужна только перед сменой: там она несёт цель и вход в гайд.
     После смены в ней оставалась пустая рамка с «Как играть?», хотя смена
     уже закончилась, — итог целиком печатает шапка прибора. */
  const briefing = byId(document, 'levelBriefing');
  const showStory = !nextState.guideOpen && nextState.phase === 'briefing';
  briefing.hidden = !showStory;
  briefing.setAttribute('aria-hidden', String(!showStory));
  if (showStory) byId(document, 'briefingGoal').textContent = level.goal;

  const eventBanner = byId(document, 'eventBanner');
  const showTsdFeedback = view.screen === 'feedback';
  eventBanner.textContent = showTsdFeedback ? nextState.feedback?.message || '' : '';
  eventBanner.classList.toggle('show', showTsdFeedback);
  /* Успех и рабочие уведомления живут в тосте и гаснут сами; экран терминала
     забирает только ошибка, которую нужно прочитать и исправить. */
  const toast = byId(document, 'toast');
  const showToast = Boolean(nextState.feedback) && !isBuilderError && !showTsdFeedback;
  toast.textContent = showToast ? nextState.feedback.message : '';
  toast.className = `toast ${showToast ? `show ${nextState.feedback.kind}` : ''}`;
  scheduleToastDismiss(showToast ? nextState.feedback.message : null);
}

let toastMessage = null;
let toastTimer = null;
function scheduleToastDismiss(message) {
  if (message === toastMessage) return;
  toastMessage = message;
  if (typeof window.clearTimeout === 'function') window.clearTimeout(toastTimer);
  if (!message || typeof window.setTimeout !== 'function') return;
  toastTimer = window.setTimeout(() => {
    if (state.feedback?.message === message) dispatch({ type: 'DISMISS_FEEDBACK' });
  }, 3200);
}

function dispatch(action) {
  const queueShift = !guidedFor(state) && state.phase === 'shift';
  if (action.type === 'OPEN_BUILDER') {
    if (queueShift) {
      /* На смене с очередью паллета собирается только под принятое задание.
         Нет принятого — нажатие на паллету показывает, что предлагает ТСД. */
      state = currentTaskFor(state)?.kind === 'pick'
        ? { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } }
        : { ...state, feedback: null, tsd: { ...state.tsd, open: true, dismissedTaskId: null } };
    } else {
      /* Нажатие на паллету открывает сборку сразу. Раньше оно уводило на
         экран задания, и «Принять» приходилось жать только чтобы вернуться. */
      if (!state.tsd?.acceptedOrderId) state = reduceAction(state, { type: 'ACCEPT_TASK' });
      state = { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } };
    }
  } else if (action.type === 'CLOSE_BUILDER') state = { ...state, builderOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
  else if (action.type === 'OPEN_VEHICLES') {
    // Карточка шага открывает сразу тот фургон, о котором говорит.
    if (action.vehicleId) state = reduceAction(state, { type: 'SELECT_VEHICLE', vehicleId: action.vehicleId });
    state = { ...state, vehicleDrawerOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'vehicles' } };
  }
  else if (action.type === 'CLOSE_VEHICLES') state = { ...state, vehicleDrawerOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
  else if (action.type === 'OPEN_GUIDE') {
    state = reduceAction(state, action);
    state = { ...state, tsd: { ...state.tsd, open: true, screen: 'guide' } };
  } else if (action.type === 'CLOSE_GUIDE') {
    state = reduceAction(state, action);
    state = { ...state, tsd: { ...state.tsd, open: false, screen: 'current' } };
  }
  else {
    state = reduceAction(state, action);
    if (action.type === 'SELECT_ZONE') {
      const compatibleVehicle = state.vehicles.find((vehicle) => vehicle.zone === state.pallet.zone && vehicle.ready);
      if (compatibleVehicle) state = { ...state, selectedVehicleId: compatibleVehicle.id };
    }
    /* Заявка тяжелее паллеты собирается в несколько заходов: пока задание в
       работе, сборка остаётся открытой для следующей паллеты. */
    const stillPicking = queueShift && currentTaskFor(state)?.kind === 'pick';
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success' && !stillPicking) state = { ...state, builderOpen: false };
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success' && stillPicking) state = { ...state, tsd: { ...state.tsd, open: true, screen: 'builder' } };
    /* Принятое задание сразу открывает свой экран: сборку — для заявки,
       фургон — для снятия паллеты. Приёмка экрана не открывает: её
       продолжение — вывески зон на схеме. */
    if (queueShift && (action.type === 'ACCEPT_TASK' || action.type === 'TAKE_URGENT')) {
      const task = currentTaskFor(state);
      if (task?.kind === 'pick') state = { ...state, builderOpen: true, vehicleDrawerOpen: false, tsd: { ...state.tsd, open: true, screen: 'builder' } };
      if (task?.kind === 'unload') state = { ...state, vehicleDrawerOpen: true, builderOpen: false, tsd: { ...state.tsd, open: true, screen: 'vehicles' } };
    }
    // Крестик на предложенном задании — «не сейчас»: терминал не всплывает снова, пока задание то же.
    if (queueShift && action.type === 'CLOSE_TSD') state = { ...state, tsd: { ...state.tsd, dismissedTaskId: nextTaskFor(state)?.id || null } };
    /* Маршрут уже построен при погрузке, поэтому кнопка просто подтверждает
       порядок и закрывает панель — отдельное нажатие на крестик не нужно. */
    if (action.type === 'SET_ROUTE') state = { ...state, vehicleDrawerOpen: false, tsd: { ...state.tsd, open: false, screen: 'current' } };
  }
  state = offerNextTask(state);
  render(state, document);
  return state;
}

/* Задания приходят на ТСД сами: когда принятого задания нет, а в очереди
   есть выполнимое, терминал открывается с ним. Не всплывает поверх панелей,
   во время размещения паллеты, на ошибке и если игрок это задание только
   что закрыл крестиком. */
function offerNextTask(current) {
  if (guidedFor(current) || current.phase !== 'shift' || current.paused) return current;
  if (current.builderOpen || current.vehicleDrawerOpen || current.guideOpen) return current;
  if (current.feedback?.kind === 'error' || current.tsd?.open) return current;
  const offered = nextTaskFor(current);
  if (!offered || currentTaskFor(current)) return current;
  if (current.tsd?.dismissedTaskId === offered.id) return current;
  return { ...current, tsd: { ...current.tsd, open: true } };
}

document.addEventListener('click', (event) => {
  audioUnlocked = true;
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action } = button.dataset;
  if (action === 'OPEN_TSD') tsdReturnFocus = button;
  if (action === 'ADD_ITEM') return dispatch({ type: action, sku: button.dataset.sku, zone: button.dataset.zone, weightPerUnit: Number(button.dataset.weight), quantity: Number(button.dataset.quantity) });
  if (action === 'SELECT_STORE') return dispatch({ type: action, storeId: button.dataset.store });
  if (action === 'SELECT_ZONE') {
    /* Вывеска зоны на схеме — это и есть размещение: пока принятая паллета
       стоит на тележке, нажатие на зону убирает её туда, а не переключает
       фильтр товаров в сборке. */
    const placing = Boolean(button.dataset.sceneZone) && terminalViewFor(state).awaitingPlacement;
    /* На смене с очередью вывеска вне размещения ничего не делает: адрес и
       зону паллеты задаёт принятое задание, а не нажатие на схеме. */
    if (!placing && button.dataset.sceneZone && !guidedFor(state)) return state;
    return dispatch(placing ? { type: 'PLACE_PALLET', zone: button.dataset.zone } : { type: action, zone: button.dataset.zone });
  }
  if (action === 'LOAD_PALLET') return dispatch({ type: action, vehicleId: state.selectedVehicleId });
  if (action === 'SET_ROUTE') return dispatch({ type: action, vehicleId: state.selectedVehicleId, stops: state.routeStops });
  if (action === 'SELECT_VEHICLE') return dispatch({ type: action, vehicleId: button.dataset.vehicleId });
  if (action === 'OPEN_VEHICLES') return dispatch({ type: action, vehicleId: button.dataset.vehicleId });
  if (action === 'MOVE_STOP') return dispatch({ type: action, index: button.dataset.index, direction: button.dataset.direction });
  if (action === 'UNLOAD_PALLET') return dispatch({ type: action, vehicleId: button.dataset.vehicleId, palletIndex: button.dataset.palletIndex });
  // Пройти заново — это просто старт первого уровня, отдельное действие не нужно.
  if (action === 'RESTART_CAMPAIGN') return dispatch({ type: 'START_LEVEL', levelId: 1 });
  const nextState = dispatch({ type: action });
  if (action === 'CLOSE_TSD' || action === 'ACCEPT_TASK') {
    tsdReturnFocus?.focus();
    tsdReturnFocus = null;
  }
  return nextState;
});

window.dispatch = dispatch;
window.render = render;
window.renderScene = renderScene;
window.renderTsd = renderTsd;

render(state, document);
setInterval(() => {
  if (state.phase !== 'shift' || state.paused || state.report) return;
  dispatch({ type: 'TICK' });
  if (state.secondsRemaining === 0) dispatch({ type: 'END_SHIFT' });
}, 1000);

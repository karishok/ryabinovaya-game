const engine = window.RyabinovayaEngine;
const { LEVELS, ZONE_NAMES: zones } = window.RyabinovayaLevels;
const { reduceAction, startLevel, liveMetrics, fulfillmentFor, missingRouteVehicles, activeOrderFor, remainingFor } = window.RyabinovayaAppState;
const { warehouseViewFor } = window.RyabinovayaSceneView;
const { terminalViewFor } = window.RyabinovayaTsdView;
const { signalTsd } = window.RyabinovayaTsdSignal || { signalTsd: () => {} };
const stores = { north: 'Северный', central: 'Центральный', west: 'Западный', east: 'Восточный' };
const itemDetails = {
  water: { emoji: '💧', name: 'Вода 1,5 л' }, milk: { emoji: '🥛', name: 'Молоко' }, banana: { emoji: '🍌', name: 'Бананы' }, bread: { emoji: '🍞', name: 'Хлеб' }, 'ice-cream': { emoji: '🍨', name: 'Мороженое' },
};
const items = Object.values(engine.ITEMS).map((item) => ({ ...item, ...itemDetails[item.sku] }));
let state = startLevel(1);
let tsdReturnFocus = null;
let lastTsdSignal = 'idle';
let audioContext = null;
let audioUnlocked = false;

const byId = (document, id) => document.getElementById(id);
const quantityFor = (pallet, sku) => pallet.items.filter((item) => item.sku === sku).reduce((total, item) => total + item.quantity, 0);
const vehicleLabel = (vehicle) => `${zones[vehicle.zone]} фургон`;
const levelFor = (levelId) => LEVELS.find((level) => level.id === levelId);
const screenForTsd = (nextState, baseScreen) => {
  if (nextState.report || nextState.phase === 'report') return 'report';
  if (nextState.builderOpen) return 'builder';
  if (nextState.vehicleDrawerOpen) return 'vehicles';
  if (nextState.guideOpen) return 'guide';
  if (nextState.phase === 'briefing' || nextState.phase === 'story-after') return 'briefing';
  /* Только ошибка забирает экран терминала. Успех и рабочие уведомления
     уходят в тост: раньше каждая собранная паллета требовала лишнего
     нажатия «Продолжить» на полноэкранном сообщении. */
  if (nextState.feedback?.kind === 'error') return 'feedback';
  if (baseScreen === 'inbound') return 'inbound';
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
    message: screen === 'feedback' ? nextState.feedback?.message || baseView.message : baseView.message,
  };
};
const orderLabel = (order) => {
  const item = itemDetails[order.sku] || { emoji: '📦', name: order.sku };
  return `${item.emoji} ${item.name} · ${order.quantity} шт.`;
};
const orderMarkup = (order) => `<div class="order-row"><strong>${stores[order.storeId] || order.storeId}</strong><span>${orderLabel(order)} · ${zones[order.zone]}</span></div>`;
/* В сводке заявка занимает одну строку и показывает остаток, а не исходное
   количество: после частичной отгрузки важно, сколько ещё собирать. */
const boardOrderMarkup = (state, order) => {
  const left = remainingFor(state, order);
  return `<div class="order-row${left === 0 ? ' is-done' : ''}"><strong>${stores[order.storeId] || order.storeId}</strong><span>${orderLabel({ ...order, quantity: left })}</span></div>`;
};

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
  byId(document, 'sceneStatus').textContent = view.statusText;
  byId(document, 'boardStatus').textContent = view.statusText;
  byId(document, 'sceneOperatorName').textContent = view.operatorName;
  const scenePallet = byId(document, 'scenePallet');
  scenePallet.style.setProperty('--pallet-fill', `${view.palletFillPercent}%`);
  scenePallet.setAttribute('aria-label', `Текущая паллета заполнена на ${view.palletFillPercent}%`);
  const truckBay = byId(document, 'sceneTruckBay');
  truckBay.dataset.routeReady = String(view.routeReady);
  truckBay.dataset.loadedPallets = String(view.loadedPalletCount);
  const dock = byId(document, 'sceneDock');
  dock.hidden = view.inboundCount === 0;
  dock.dataset.awaiting = String(Boolean(view.placementZone));
  byId(document, 'dockBadge').textContent = String(view.inboundCount);
  document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
    const active = zone.dataset.sceneZone === view.activeZone;
    const selected = zone.dataset.sceneZone === view.selectedZone;
    zone.classList.toggle('is-active', active);
    zone.classList.toggle('is-selected', selected && !view.placementZone);
    zone.classList.toggle('is-target', Boolean(view.placementZone));
    zone.setAttribute('aria-current', String(active));
  });
}

function renderTsd(view, document) {
  const device = byId(document, 'tsdDevice');
  device.dataset.open = String(view.open);
  device.dataset.screen = view.screen;
  device.dataset.signal = view.signal;
  const hardware = byId(document, 'tsdHardware');
  hardware.setAttribute('aria-hidden', String(view.open));
  hardware.setAttribute('tabindex', view.open ? '-1' : '0');
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
  byId(document, 'tsdCompactKicker').textContent = view.compactKicker;
  byId(document, 'tsdCompactTask').textContent = view.compactTask;
  byId(document, 'tsdCompactMeta').textContent = view.compactMeta;
  byId(document, 'tsdTaskStore').textContent = view.storeName;
  byId(document, 'tsdTaskOrder').textContent = view.orderText;
  byId(document, 'tsdTaskZone').textContent = view.zoneName;
  const message = byId(document, 'tsdMessage');
  message.textContent = view.message;
  // Пустая строка статуса всё равно держала 24 px в шапке прибора.
  message.hidden = !view.message;
  byId(document, 'tsdReportSummary').textContent = view.reportSummary || '';
  byId(document, 'tsdReportSummary').hidden = view.screen !== 'report';
  const continueStory = byId(document, 'tsdContinueStory');
  continueStory.hidden = view.screen !== 'briefing';
  continueStory.textContent = view.title === 'Смена завершена' ? 'Продолжить' : 'Начать смену';
  byId(document, 'tsdAccept').hidden = !view.canAccept;
  byId(document, 'tsdReceive').hidden = !view.canReceive;
  byId(document, 'tsdClose').hidden = !view.canClose;
  byId(document, 'tsdInboundSupplier').textContent = view.storeName;
  byId(document, 'tsdInboundGoods').textContent = view.orderText;
  byId(document, 'tsdInboundZone').textContent = view.zoneName;
  byId(document, 'tsdInboundHint').textContent = view.awaitingPlacement
    ? `Паллета на тележке. Нажмите вывеску «${view.zoneName}» на схеме склада.`
    : 'Сверьте накладную с паллетой и примите её.';
  byId(document, 'tsdContinue').hidden = view.screen !== 'report';
  byId(document, 'tsdFeedbackContinue').hidden = view.screen !== 'feedback';
  const panels = document.querySelectorAll ? document.querySelectorAll('[data-tsd-panel]') : [];
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.tsdPanel !== view.screen;
    panel.setAttribute('aria-hidden', String(panel.hidden));
  });
  byId(document, 'warehouseScene').setAttribute('aria-hidden', 'false');
}

/* Карта депо и дарксторов по тем же координатам, которыми движок считает
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
    + `<text class="map-label" x="${depotX}" y="${depotY + 0.78}">Депо</text>`
    + nodes
    + '</svg>';
}

/* Подсказка говорит, есть ли запас, но не диктует порядок: раньше здесь
   печатался готовый оптимум, и единственное решение в игре решалось за
   игрока. Точный лучший маршрут показывается в отчёте — после смены. */
function routeSummaryHtml(routeStops) {
  if (!routeStops.length) return 'Загрузите паллеты — их адреса появятся на карте.';
  const current = engine.buildRoute(null, routeStops).minutes;
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
  byId(document, 'vehicleName').textContent = selectedVehicle ? vehicleLabel(selectedVehicle) : 'Выберите машину';
  byId(document, 'ordersList').innerHTML = nextState.orders.filter((order) => !order.cancelled).map((order) => boardOrderMarkup(nextState, order)).join('') || '<p>Активных заявок нет.</p>';
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
  });

  byId(document, 'itemRows').innerHTML = items.filter((item) => item.zone === nextState.pallet.zone).map((item) => `<div class="item-row">
    <span class="item-emoji">${item.emoji}</span><div><strong>${item.name}</strong><small>${item.weightPerUnit} кг · ${zones[item.zone]}</small></div>
    <div class="qty"><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="-1" aria-label="Убрать ${item.name}">−</button><b>${quantityFor(nextState.pallet, item.sku)}</b><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="1" aria-label="Добавить ${item.name}">+</button></div>
  </div>`).join('');
  byId(document, 'capacity').textContent = `${nextState.pallet.weight} / ${nextState.pallet.capacity} кг`;
  byId(document, 'builderTargetLabel').textContent = `${stores[nextState.pallet.storeId] || nextState.pallet.storeId} · ${zones[nextState.pallet.zone]}`;
  /* Задание в шапке панели: экран задания мы больше не показываем
     принудительно, значит адрес и товар должны быть видны там, где собирают. */
  const activeOrder = activeOrderFor(nextState);
  byId(document, 'builderTask').textContent = activeOrder
    ? `Задание: ${stores[activeOrder.storeId]} · ${orderLabel({ ...activeOrder, quantity: remainingFor(nextState, activeOrder) })} · ${zones[activeOrder.zone]}`
    : 'Все заявки закрыты — можно завершать смену.';
  byId(document, 'vehicleTask').textContent = selectedVehicle
    ? `${vehicleLabel(selectedVehicle)} · ${selectedVehicle.pallets.length} палл.`
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
          ? `${stops} ост. · ${loadedKg} кг`
          : 'свободна';
    return `<button class="vehicle-row ${vehicle.id === nextState.selectedVehicleId ? 'selected' : ''}" data-action="SELECT_VEHICLE" data-vehicle-id="${vehicle.id}" ${vehicle.ready ? '' : 'disabled'}><span class="vehicle-glyph" aria-hidden="true"></span><span><strong>${vehicleLabel(vehicle)}</strong><small>${vehicle.pallets.length} паллет · до ${vehicle.capacity} кг</small></span><b class="${routelessVehicles.has(vehicle.id) ? 'warn' : ''}">${status}</b></button>`;
  }).join('');
  const routeStops = nextState.routeStops || [];
  byId(document, 'routeMap').innerHTML = routeMapSvg(nextState, routeStops);
  byId(document, 'routeSummary').innerHTML = routeSummaryHtml(routeStops);
  byId(document, 'routeStops').innerHTML = routeStops.length ? routeStops.map((storeId, index) => `<div class="route-stop"><span>${index + 1}. ${stores[storeId] || storeId} <b class="leg">${engine.legMinutes(index === 0 ? 'depot' : routeStops[index - 1], storeId)} мин</b></span><span><button data-action="MOVE_STOP" data-index="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Выше">↑</button><button data-action="MOVE_STOP" data-index="${index}" data-direction="1" ${index === routeStops.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button></span></div>`).join('') : '<p class="empty-route">Загрузите паллеты для добавления остановок.</p>';
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
    byId(document, 'reportMessage').textContent = nextState.report.reasons[0] || 'Срочные паллеты готовы к отгрузке.';
    byId(document, 'reportDelivered').textContent = `${nextState.report.deliveredPercent}%`;
    byId(document, 'reportOnTime').textContent = `${nextState.report.onTimePercent}%`;
    byId(document, 'reportPrecision').textContent = `${nextState.report.precisionPercent}%`;
    byId(document, 'reportSpoiled').textContent = String(nextState.report.spoiledPallets);
    byId(document, 'reportProfit').textContent = `${nextState.report.profit.toLocaleString('ru-RU')} ₽`;
    byId(document, 'reportReasons').innerHTML = nextState.report.reasons.slice(0, 3).map((reason) => `<li>${reason}</li>`).join('');
    byId(document, 'nextShift').textContent = nextState.nextLevelId ? 'Следующая смена' : 'Завершить кампанию';
  }

  const briefing = byId(document, 'levelBriefing');
  const showStory = !nextState.guideOpen && (nextState.phase === 'briefing' || nextState.phase === 'story-after');
  briefing.classList.toggle('open', false);
  briefing.hidden = !showStory;
  briefing.setAttribute('aria-hidden', String(!showStory));
  if (showStory) {
    byId(document, 'briefingKicker').textContent = nextState.phase === 'briefing' ? 'Новая смена' : 'Итоги истории';
    byId(document, 'briefingTitle').textContent = nextState.phase === 'briefing' ? `Уровень ${level.id} · ${level.title}` : 'Смена завершена';
    byId(document, 'briefingText').textContent = nextState.story?.text || '';
    byId(document, 'briefingGoal').textContent = nextState.phase === 'briefing' ? level.goal : (nextState.nextLevelId ? 'Нажмите, чтобы перейти к следующей смене.' : 'Кампания пройдена.');
  }
  const endless = byId(document, 'endlessMode');
  endless.hidden = nextState.phase !== 'endless';
  endless.classList.toggle('open', nextState.phase === 'endless');
  endless.setAttribute('aria-hidden', String(nextState.phase !== 'endless'));

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
  if (action.type === 'OPEN_BUILDER') {
    /* Нажатие на паллету открывает сборку сразу. Раньше оно уводило на
       экран задания, и «Принять» приходилось жать только чтобы вернуться. */
    if (!state.tsd?.acceptedOrderId) state = reduceAction(state, { type: 'ACCEPT_TASK' });
    state = { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } };
  } else if (action.type === 'CLOSE_BUILDER') state = { ...state, builderOpen: false, feedback: null, tsd: { ...state.tsd, open: false, screen: 'current' } };
  else if (action.type === 'OPEN_VEHICLES') state = { ...state, vehicleDrawerOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'vehicles' } };
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
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success') state = { ...state, builderOpen: false };
    /* Маршрут уже построен при погрузке, поэтому кнопка просто подтверждает
       порядок и закрывает панель — отдельное нажатие на крестик не нужно. */
    if (action.type === 'SET_ROUTE') state = { ...state, vehicleDrawerOpen: false, tsd: { ...state.tsd, open: false, screen: 'current' } };
  }
  render(state, document);
  return state;
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
    return dispatch(placing ? { type: 'PLACE_PALLET', zone: button.dataset.zone } : { type: action, zone: button.dataset.zone });
  }
  if (action === 'LOAD_PALLET') return dispatch({ type: action, vehicleId: state.selectedVehicleId });
  if (action === 'SET_ROUTE') return dispatch({ type: action, vehicleId: state.selectedVehicleId, stops: state.routeStops });
  if (action === 'SELECT_VEHICLE') return dispatch({ type: action, vehicleId: button.dataset.vehicleId });
  if (action === 'MOVE_STOP') return dispatch({ type: action, index: button.dataset.index, direction: button.dataset.direction });
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

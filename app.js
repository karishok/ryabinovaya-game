const engine = window.RyabinovayaEngine;
const { LEVELS, ZONE_NAMES: zones } = window.RyabinovayaLevels;
const { reduceAction, startLevel, liveMetrics, fulfillmentFor, missingRouteVehicles } = window.RyabinovayaAppState;
const { warehouseViewFor } = window.RyabinovayaSceneView;
const { terminalViewFor } = window.RyabinovayaTsdView;
const stores = { north: 'Северный', central: 'Центральный', west: 'Западный', east: 'Восточный' };
const itemDetails = {
  water: { emoji: '💧', name: 'Вода 1,5 л' }, milk: { emoji: '🥛', name: 'Молоко' }, banana: { emoji: '🍌', name: 'Бананы' }, bread: { emoji: '🍞', name: 'Хлеб' }, 'ice-cream': { emoji: '🍨', name: 'Мороженое' },
};
const items = Object.values(engine.ITEMS).map((item) => ({ ...item, ...itemDetails[item.sku] }));
let state = startLevel(1);
let tsdReturnFocus = null;

const byId = (document, id) => document.getElementById(id);
const quantityFor = (pallet, sku) => pallet.items.filter((item) => item.sku === sku).reduce((total, item) => total + item.quantity, 0);
const vehicleLabel = (vehicle) => `${zones[vehicle.zone]} фургон`;
const levelFor = (levelId) => LEVELS.find((level) => level.id === levelId);
const screenForTsd = (nextState, baseScreen) => {
  if (nextState.report || nextState.phase === 'report') return 'report';
  if (nextState.builderOpen) return 'builder';
  if (nextState.vehicleDrawerOpen) return 'vehicles';
  if (nextState.guideOpen) return 'guide';
  if (nextState.tsd?.screen === 'task') return 'task';
  if (nextState.phase === 'briefing' || nextState.phase === 'story-after') return 'briefing';
  if (nextState.feedback) return 'feedback';
  return nextState.tsd?.screen || baseScreen;
};
const tsdViewFor = (nextState) => {
  const baseView = terminalViewFor(nextState);
  const screen = screenForTsd(nextState, baseView.screen);
  const titleByScreen = {
    builder: 'Сборка паллеты',
    vehicles: 'Машины',
    guide: 'Как играть?',
    feedback: 'Оперативное обновление',
  };
  return {
    ...baseView,
    open: baseView.open || !['current', 'task'].includes(screen),
    screen,
    title: titleByScreen[screen] || baseView.title,
    message: screen === 'feedback' ? nextState.feedback?.message || baseView.message : baseView.message,
  };
};
const orderLabel = (order) => {
  const item = itemDetails[order.sku] || { emoji: '📦', name: order.sku };
  return `${item.emoji} ${item.name} · ${order.quantity} шт.`;
};
const orderMarkup = (order) => `<div class="order-row"><strong>${stores[order.storeId] || order.storeId}</strong><span>${orderLabel(order)} · ${zones[order.zone]}</span></div>`;

function renderScene(view, document) {
  const scene = byId(document, 'warehouseScene');
  scene.dataset.mode = view.mode;
  scene.dataset.activeZone = view.activeZone;
  scene.dataset.selectedZone = view.selectedZone;
  scene.dataset.vehicleZone = view.selectedVehicleZone || '';
  scene.dataset.event = view.eventCode || '';
  byId(document, 'sceneStatus').textContent = view.statusText;
  byId(document, 'sceneOperatorName').textContent = view.operatorName;
  const scenePallet = byId(document, 'scenePallet');
  scenePallet.style.setProperty('--pallet-fill', `${view.palletFillPercent}%`);
  scenePallet.setAttribute('aria-label', `Текущая паллета заполнена на ${view.palletFillPercent}%`);
  const truckBay = byId(document, 'sceneTruckBay');
  truckBay.dataset.routeReady = String(view.routeReady);
  truckBay.dataset.loadedPallets = String(view.loadedPalletCount);
  document.querySelectorAll('[data-scene-zone]').forEach((zone) => {
    const active = zone.dataset.sceneZone === view.activeZone;
    const selected = zone.dataset.sceneZone === view.selectedZone;
    zone.classList.toggle('is-active', active);
    zone.classList.toggle('is-selected', selected);
    zone.setAttribute('aria-current', String(active));
  });
}

function renderTsd(view, document) {
  const device = byId(document, 'tsdDevice');
  device.dataset.open = String(view.open);
  device.dataset.screen = view.screen;
  device.dataset.signal = view.signal;
  byId(document, 'tsdBackdrop').setAttribute('aria-hidden', String(!view.open));
  byId(document, 'tsdScreen').setAttribute('aria-hidden', String(!view.open));
  byId(document, 'tsdTitle').textContent = view.title;
  byId(document, 'tsdStore').textContent = view.storeName;
  byId(document, 'tsdOrder').textContent = view.orderText;
  byId(document, 'tsdZone').textContent = view.zoneName ? `Зона: ${view.zoneName}` : '';
  byId(document, 'tsdProgress').textContent = view.progressText;
  byId(document, 'tsdMessage').textContent = view.message;
  byId(document, 'tsdReportSummary').textContent = view.reportSummary || '';
  byId(document, 'tsdReportSummary').hidden = view.screen !== 'report';
  const continueStory = byId(document, 'tsdContinueStory');
  continueStory.hidden = view.screen !== 'briefing';
  continueStory.textContent = view.title === 'Смена завершена' ? 'Продолжить' : 'Начать смену';
  byId(document, 'tsdAccept').hidden = !view.canAccept;
  byId(document, 'tsdContinue').hidden = view.screen !== 'report';
  const panels = document.querySelectorAll ? document.querySelectorAll('[data-tsd-panel]') : [];
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.tsdPanel !== view.screen;
    panel.setAttribute('aria-hidden', String(panel.hidden));
  });
  byId(document, 'warehouseScene').setAttribute('aria-hidden', 'false');
}

function render(nextState, document) {
  renderScene(warehouseViewFor(nextState), document);
  renderTsd(tsdViewFor(nextState), document);
  const level = levelFor(nextState.levelId);
  const selectedVehicle = nextState.vehicles.find((vehicle) => vehicle.id === nextState.selectedVehicleId) || nextState.vehicles[0];
  const minutes = String(Math.floor(nextState.secondsRemaining / 60)).padStart(2, '0');
  const seconds = String(nextState.secondsRemaining % 60).padStart(2, '0');
  byId(document, 'levelTitle').textContent = `Уровень ${nextState.levelId} · ${level.title}`;
  byId(document, 'clock').textContent = `${minutes}:${seconds}`;
  const fulfillment = fulfillmentFor(nextState);
  byId(document, 'orders').textContent = `${fulfillment.fulfilledQuantity} / ${fulfillment.demandQuantity}`;
  const metrics = liveMetrics(nextState);
  byId(document, 'ontime').textContent = `${metrics.onTimePercent}%`;
  byId(document, 'precision').textContent = `${metrics.precisionPercent}%`;
  byId(document, 'mapPallets').textContent = `${nextState.loadedPallets.length} паллет`;
  byId(document, 'vehicleName').textContent = selectedVehicle ? vehicleLabel(selectedVehicle) : 'Выберите машину';
  byId(document, 'transportSummary').textContent = selectedVehicle ? `${vehicleLabel(selectedVehicle)}: ${selectedVehicle.pallets.length} паллет в кузове.` : 'Выберите машину для отгрузки.';
  byId(document, 'ordersList').innerHTML = nextState.orders.filter((order) => !order.cancelled).map(orderMarkup).join('') || '<p>Активных заявок нет.</p>';
  byId(document, 'guideOrders').innerHTML = nextState.orders.filter((order) => !order.cancelled).map(orderMarkup).join('') || '<p>Все заявки закрыты.</p>';

  const pause = document.querySelector('[data-action="PAUSE"]');
  pause.disabled = nextState.phase !== 'shift';
  pause.classList.toggle('active', nextState.paused);
  pause.textContent = nextState.paused ? '▶' : 'Ⅱ';
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === nextState.activeScreen));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.screenTarget === nextState.activeScreen));
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
  const routelessVehicles = new Set(missingRouteVehicles(nextState));
  byId(document, 'vehicleRows').innerHTML = nextState.vehicles.map((vehicle) => {
    const status = !vehicle.ready
      ? 'ожидаем'
      : routelessVehicles.has(vehicle.id)
        ? 'нет маршрута'
        : (vehicle.zone === nextState.pallet.zone ? 'подходит' : 'другая зона');
    return `<button class="vehicle-row ${vehicle.id === nextState.selectedVehicleId ? 'selected' : ''}" data-action="SELECT_VEHICLE" data-vehicle-id="${vehicle.id}" ${vehicle.ready ? '' : 'disabled'}><span class="vehicle-glyph" aria-hidden="true"></span><span><strong>${vehicleLabel(vehicle)}</strong><small>${vehicle.pallets.length} паллет · ${vehicle.capacity} кг</small></span><b class="${routelessVehicles.has(vehicle.id) ? 'warn' : ''}">${status}</b></button>`;
  }).join('');
  const routeStops = nextState.routeStops || [];
  byId(document, 'routeStops').innerHTML = routeStops.length ? routeStops.map((storeId, index) => `<div class="route-stop"><span>${index + 1}. ${stores[storeId] || storeId}</span><span><button data-action="MOVE_STOP" data-index="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Выше">↑</button><button data-action="MOVE_STOP" data-index="${index}" data-direction="1" ${index === routeStops.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button></span></div>`).join('') : '<p class="empty-route">Загрузите паллеты для добавления остановок.</p>';
  byId(document, 'routeButton').textContent = routeStops.length ? `Построить маршрут: ${routeStops.map((storeId) => stores[storeId] || storeId).join(' → ')}` : 'Маршрут пока пуст';

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
  const eventCodes = ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'];
  const isEvent = nextState.phase === 'shift' && eventCodes.includes(nextState.feedback?.code);
  const showTsdFeedback = tsdViewFor(nextState).screen === 'feedback';
  eventBanner.textContent = showTsdFeedback ? nextState.feedback?.message || '' : '';
  eventBanner.classList.toggle('show', showTsdFeedback);
  const toast = byId(document, 'toast');
  const showToast = nextState.feedback && !isBuilderError && !isEvent && !showTsdFeedback;
  toast.textContent = showToast ? nextState.feedback.message : '';
  toast.className = `toast ${showToast ? `show ${nextState.feedback.kind}` : ''}`;
}

function dispatch(action) {
  if (action.type === 'OPEN_BUILDER') {
    if (!state.tsd?.acceptedOrderId) state = reduceAction(state, { type: 'SHOW_TSD_TASK' });
    else state = { ...state, builderOpen: true, feedback: null, tsd: { ...state.tsd, open: true, screen: 'builder' } };
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
  else if (action.type === 'NAVIGATE') state = { ...state, activeScreen: action.screen, feedback: null };
  else {
    state = reduceAction(state, action);
    if (action.type === 'SELECT_ZONE') {
      const compatibleVehicle = state.vehicles.find((vehicle) => vehicle.zone === state.pallet.zone && vehicle.ready);
      if (compatibleVehicle) state = { ...state, selectedVehicleId: compatibleVehicle.id };
    }
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success') state = { ...state, builderOpen: false };
  }
  render(state, document);
  if (action.type === 'TICK' && ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(state.feedback?.code)) {
    const eventCode = state.feedback.code;
    window.setTimeout(() => {
      if (state.feedback?.code === eventCode) dispatch({ type: 'DISMISS_FEEDBACK' });
    }, 3500);
  }
  return state;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action } = button.dataset;
  if (action === 'OPEN_TSD') tsdReturnFocus = button;
  if (action === 'ADD_ITEM') return dispatch({ type: action, sku: button.dataset.sku, zone: button.dataset.zone, weightPerUnit: Number(button.dataset.weight), quantity: Number(button.dataset.quantity) });
  if (action === 'SELECT_STORE') return dispatch({ type: action, storeId: button.dataset.store });
  if (action === 'SELECT_ZONE') return dispatch({ type: action, zone: button.dataset.zone });
  if (action === 'LOAD_PALLET') return dispatch({ type: action, vehicleId: state.selectedVehicleId });
  if (action === 'SET_ROUTE') return dispatch({ type: action, vehicleId: state.selectedVehicleId, stops: state.routeStops });
  if (action === 'NAVIGATE') return dispatch({ type: action, screen: button.dataset.screenTarget });
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

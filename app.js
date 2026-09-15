const engine = window.RyabinovayaEngine;
const { reduceAction } = window.RyabinovayaAppState;
const stores = { north: 'Северный', central: 'Центральный', west: 'Западный' };
const zones = { dry: 'Сухач', chilled: 'Охлаждёнка', frozen: 'Заморозка' };
const itemDetails = {
  water: { emoji: '💧', name: 'Вода 1,5 л' },
  milk: { emoji: '🥛', name: 'Молоко' },
  banana: { emoji: '🍌', name: 'Бананы' },
  bread: { emoji: '🍞', name: 'Хлеб' },
  'ice-cream': { emoji: '🍨', name: 'Мороженое' },
};
const items = Object.values(engine.ITEMS).map((item) => ({ ...item, ...itemDetails[item.sku] }));
let state = {
  secondsRemaining: 210,
  paused: false,
  activeScreen: 'warehouse',
  builderOpen: false,
  vehicleDrawerOpen: false,
  report: null,
  selectedVehicleId: 'dry-1',
  orders: [{ storeId: 'north' }],
  routeStops: [],
  pallet: engine.createPallet({ storeId: 'north', zone: 'dry' }),
  vehicles: [
    engine.createVehicle({ id: 'dry-1', zone: 'dry' }),
    engine.createVehicle({ id: 'chilled-1', zone: 'chilled' }),
    engine.createVehicle({ id: 'frozen-1', zone: 'frozen' }),
  ],
  loadedPallets: [],
  metrics: { spoiledPallets: 0, routePenalty: 0 },
  feedback: null,
};

const byId = (document, id) => document.getElementById(id);
const quantityFor = (pallet, sku) => pallet.items.filter((item) => item.sku === sku).reduce((total, item) => total + item.quantity, 0);
const vehicleLabel = (vehicle) => `${zones[vehicle.zone]} фургон`;

function render(nextState, document) {
  const selectedVehicle = nextState.vehicles.find((vehicle) => vehicle.id === nextState.selectedVehicleId);
  const loadedWeight = nextState.loadedPallets.reduce((total, pallet) => total + pallet.weight, 0);
  const minutes = String(Math.floor(nextState.secondsRemaining / 60)).padStart(2, '0');
  const seconds = String(nextState.secondsRemaining % 60).padStart(2, '0');

  byId(document, 'clock').textContent = `${minutes}:${seconds}`;
  const pause = document.querySelector('[data-action="PAUSE"]');
  pause.classList.toggle('active', nextState.paused);
  pause.textContent = nextState.paused ? '▶' : 'Ⅱ';
  byId(document, 'orders').textContent = `${nextState.loadedPallets.length} / 1`;
  byId(document, 'utilization').textContent = `${Math.min(100, loadedWeight)}%`;
  byId(document, 'mapPallets').textContent = `${nextState.loadedPallets.length} паллет`;
  byId(document, 'vehicleName').textContent = `🚚 ${vehicleLabel(selectedVehicle)}`;
  byId(document, 'transportSummary').textContent = `${vehicleLabel(selectedVehicle)}: ${selectedVehicle.pallets.length} паллет в кузове.`;

  document.querySelectorAll('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === nextState.activeScreen));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.screenTarget === nextState.activeScreen));
  document.querySelectorAll('.store-select').forEach((button) => button.classList.toggle('selected', button.dataset.store === nextState.pallet.storeId));
  document.querySelectorAll('.zone-select').forEach((button) => button.classList.toggle('selected', button.dataset.zone === nextState.pallet.zone));

  byId(document, 'itemRows').innerHTML = items.filter((item) => item.zone === nextState.pallet.zone).map((item) => `<div class="item-row">
    <span class="item-emoji">${item.emoji}</span><div><strong>${item.name}</strong><small>${item.weightPerUnit} кг · ${zones[item.zone]}</small></div>
    <div class="qty"><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="-1" aria-label="Убрать ${item.name}">−</button><b>${quantityFor(nextState.pallet, item.sku)}</b><button data-action="ADD_ITEM" data-sku="${item.sku}" data-zone="${item.zone}" data-weight="${item.weightPerUnit}" data-quantity="1" aria-label="Добавить ${item.name}">+</button></div>
  </div>`).join('');
  byId(document, 'capacity').textContent = `${nextState.pallet.weight} / ${nextState.pallet.capacity} кг`;

  byId(document, 'vehicleRows').innerHTML = nextState.vehicles.map((vehicle) => `<button class="vehicle-row ${vehicle.id === nextState.selectedVehicleId ? 'selected' : ''}" data-action="SELECT_VEHICLE" data-vehicle-id="${vehicle.id}"><span>🚚</span><span><strong>${vehicleLabel(vehicle)}</strong><small>${vehicle.pallets.length} паллет · ${vehicle.capacity} кг</small></span><b>${vehicle.zone === nextState.pallet.zone ? 'подходит' : 'другая зона'}</b></button>`).join('');
  const routeStops = nextState.routeStops || [];
  byId(document, 'routeStops').innerHTML = routeStops.length ? routeStops.map((storeId, index) => `<div class="route-stop"><span>${index + 1}. ${stores[storeId] || storeId}</span><span><button data-action="MOVE_STOP" data-index="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Выше">↑</button><button data-action="MOVE_STOP" data-index="${index}" data-direction="1" ${index === routeStops.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button></span></div>`).join('') : '<p class="empty-route">Загрузите паллеты для добавления остановок.</p>';
  byId(document, 'routeButton').textContent = routeStops.length ? `Построить маршрут: ${routeStops.map((storeId) => stores[storeId] || storeId).join(' → ')}` : 'Маршрут пока пуст';

  const builder = byId(document, 'builderModal');
  builder.classList.toggle('open', nextState.builderOpen);
  builder.setAttribute('aria-hidden', String(!nextState.builderOpen));
  const builderFeedback = byId(document, 'builderFeedback');
  const isBuilderError = nextState.builderOpen && nextState.feedback && nextState.feedback.kind === 'error';
  builderFeedback.textContent = isBuilderError ? nextState.feedback.message : '';
  builderFeedback.classList.toggle('show', isBuilderError);

  const vehicleModal = byId(document, 'vehicleModal');
  vehicleModal.classList.toggle('open', nextState.vehicleDrawerOpen);
  vehicleModal.setAttribute('aria-hidden', String(!nextState.vehicleDrawerOpen));
  const reportModal = byId(document, 'reportModal');
  reportModal.classList.toggle('open', Boolean(nextState.report));
  reportModal.setAttribute('aria-hidden', String(!nextState.report));
  if (nextState.report) {
    byId(document, 'reportStars').textContent = '★'.repeat(nextState.report.stars);
    byId(document, 'reportMessage').textContent = nextState.report.reasons[0] || 'Срочные паллеты готовы к отгрузке.';
    byId(document, 'reportUtilization').textContent = `${nextState.report.inputs.utilizationPercent}%`;
    byId(document, 'reportProfit').textContent = `${nextState.report.profit.toLocaleString('ru-RU')} ₽`;
  }

  const toast = byId(document, 'toast');
  const showToast = nextState.feedback && (!nextState.builderOpen || nextState.feedback.kind !== 'error');
  toast.textContent = showToast ? nextState.feedback.message : '';
  toast.classList.toggle('show', Boolean(showToast));
}

function dispatch(action) {
  if (action.type === 'OPEN_BUILDER') state = { ...state, builderOpen: true, feedback: null };
  else if (action.type === 'CLOSE_BUILDER') state = { ...state, builderOpen: false, feedback: null };
  else if (action.type === 'OPEN_VEHICLES') state = { ...state, vehicleDrawerOpen: true, feedback: null };
  else if (action.type === 'CLOSE_VEHICLES') state = { ...state, vehicleDrawerOpen: false, feedback: null };
  else if (action.type === 'CLOSE_REPORT') state = { ...state, report: null, feedback: null };
  else if (action.type === 'NAVIGATE') state = { ...state, activeScreen: action.screen, feedback: null };
  else if (action.type === 'SELECT_VEHICLE') state = { ...state, selectedVehicleId: action.vehicleId, feedback: null };
  else if (action.type === 'MOVE_STOP') {
    const routeStops = [...state.routeStops];
    const index = Number(action.index);
    const target = index + Number(action.direction);
    if (routeStops[target]) [routeStops[index], routeStops[target]] = [routeStops[target], routeStops[index]];
    state = { ...state, routeStops, feedback: null };
  }
  else {
    state = reduceAction(state, action);
    if (action.type === 'SELECT_ZONE') {
      const compatibleVehicle = state.vehicles.find((vehicle) => vehicle.zone === state.pallet.zone);
      if (compatibleVehicle) state = { ...state, selectedVehicleId: compatibleVehicle.id };
    }
    if (action.type === 'LOAD_PALLET' && state.feedback?.kind === 'success') state = { ...state, builderOpen: false };
  }
  render(state, document);
  return state;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action } = button.dataset;
  if (action === 'ADD_ITEM') return dispatch({ type: action, sku: button.dataset.sku, zone: button.dataset.zone, weightPerUnit: Number(button.dataset.weight), quantity: Number(button.dataset.quantity) });
  if (action === 'SELECT_STORE') return dispatch({ type: action, storeId: button.dataset.store });
  if (action === 'SELECT_ZONE') return dispatch({ type: action, zone: button.dataset.zone });
  if (action === 'LOAD_PALLET') return dispatch({ type: action, vehicleId: state.selectedVehicleId });
  if (action === 'SET_ROUTE') return dispatch({ type: action, vehicleId: state.selectedVehicleId, stops: state.routeStops });
  if (action === 'NAVIGATE') return dispatch({ type: action, screen: button.dataset.screenTarget });
  if (action === 'SELECT_VEHICLE') return dispatch({ type: action, vehicleId: button.dataset.vehicleId });
  if (action === 'MOVE_STOP') return dispatch({ type: action, index: button.dataset.index, direction: button.dataset.direction });
  dispatch({ type: action });
});

window.dispatch = dispatch;
window.render = render;
render(state, document);
setInterval(() => {
  if (state.paused || state.report) return;
  if (state.secondsRemaining <= 1) return dispatch({ type: 'END_SHIFT' });
  state = { ...state, secondsRemaining: state.secondsRemaining - 1 };
  render(state, document);
}, 1000);

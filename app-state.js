(function (root, factory) {
  const engine = typeof module !== 'undefined' && module.exports
    ? require('./game-engine.js')
    : root.RyabinovayaEngine;
  const api = factory(engine);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyabinovayaAppState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  const feedback = (kind, code, message) => ({ kind, code, message });
  const withFeedback = (state, nextFeedback) => ({ ...state, feedback: nextFeedback });
  const palletFor = (state, overrides = {}) => engine.createPallet({
    storeId: overrides.storeId || state.pallet.storeId,
    zone: overrides.zone || state.pallet.zone,
  });
  const normalizedPallet = (pallet) => ({ capacity: 100, ...pallet });

  function reduceAction(state, action) {
    const pallet = normalizedPallet(state.pallet || engine.createPallet({ storeId: 'north', zone: 'dry' }));

    if (action.type === 'SELECT_ZONE') {
      return withFeedback({ ...state, pallet: palletFor({ ...state, pallet }, { zone: action.zone }) }, null);
    }

    if (action.type === 'SELECT_STORE') {
      return withFeedback({ ...state, pallet: palletFor({ ...state, pallet }, { storeId: action.storeId }) }, null);
    }

    if (action.type === 'ADD_ITEM') {
      const quantity = Number(action.quantity);
      if (!Number.isInteger(quantity) || quantity === 0) {
        return withFeedback(state, feedback('error', 'invalid-quantity', 'Укажите целое количество товара.'));
      }

      const item = { sku: action.sku, zone: action.zone, weightPerUnit: action.weightPerUnit };
      if (quantity < 0) {
        const current = pallet.items.find((entry) => entry.sku === item.sku);
        if (!current) {
          return withFeedback(state, feedback('info', 'empty-item', 'На паллете этого товара ещё нет.'));
        }
        const nextQuantity = current.quantity + quantity;
        if (nextQuantity < 0) {
          return withFeedback(state, feedback('error', 'invalid-quantity', 'Нельзя убрать больше товара, чем собрано.'));
        }
        const items = pallet.items
          .map((entry) => entry.sku === item.sku ? { ...entry, quantity: nextQuantity } : entry)
          .filter((entry) => entry.quantity > 0);
        return withFeedback({ ...state, pallet: { ...pallet, items, weight: pallet.weight + item.weightPerUnit * quantity } }, null);
      }

      const result = engine.addItemToPallet(pallet, item, quantity);
      if (!result.ok) {
        const messages = {
          'wrong-zone': 'Этот товар нужно собирать в другой зоне.',
          'over-capacity': 'Паллета не выдержит такой вес.',
        };
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      return withFeedback({ ...state, pallet: result.pallet }, null);
    }

    if (action.type === 'LOAD_PALLET') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === action.vehicleId);
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Машина для отгрузки не найдена.'));
      if (pallet.weight === 0) return withFeedback(state, feedback('info', 'empty-pallet', 'Сначала добавьте товар на паллету.'));
      const result = engine.loadPallet(vehicle, pallet);
      if (!result.ok) {
        const messages = {
          'wrong-zone': 'Эта машина не обслуживает выбранную зону.',
          'over-capacity': 'В машине не осталось места для этой паллеты.',
        };
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      return withFeedback({
        ...state,
        vehicles: state.vehicles.map((entry) => entry.id === vehicle.id ? result.vehicle : entry),
        loadedPallets: [...(state.loadedPallets || []), pallet],
        pallet: palletFor({ ...state, pallet }),
      }, feedback('success', 'pallet-loaded', 'Паллета собрана и готова к отгрузке.'));
    }

    if (action.type === 'SET_ROUTE') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === (action.vehicleId || state.selectedVehicleId));
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Выберите машину для маршрута.'));
      return withFeedback({ ...state, route: engine.buildRoute(vehicle, action.stops) }, null);
    }

    if (action.type === 'PAUSE') return withFeedback({ ...state, paused: !state.paused }, feedback('info', state.paused ? 'resumed' : 'paused', state.paused ? 'Смена продолжается.' : 'Смена приостановлена.'));

    if (action.type === 'END_SHIFT') {
      const loaded = (state.loadedPallets || []).length;
      const score = engine.scoreShift({
        deliveredPercent: loaded ? 94 : 0,
        onTimePercent: loaded ? 92 : 0,
        utilizationPercent: loaded ? 87 : 0,
        spoiledPallets: state.metrics?.spoiledPallets || 0,
        routePenalty: state.metrics?.routePenalty || 0,
      });
      return withFeedback({ ...state, paused: true, report: score }, feedback('success', 'shift-ended', 'Смена завершена.'));
    }

    return withFeedback(state, feedback('error', 'unknown-action', 'Команда не поддерживается.'));
  }

  return { reduceAction };
});

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
  const consolidateItems = (items) => Object.values(items.reduce((bySku, item) => {
    const existing = bySku[item.sku];
    bySku[item.sku] = existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item };
    return bySku;
  }, {}));
  const normalizedPallet = (pallet) => ({ capacity: 100, ...pallet, items: consolidateItems(pallet.items || []) });

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
        const currentIndex = pallet.items.findIndex((entry) => entry.sku === item.sku);
        const current = pallet.items[currentIndex];
        if (!current) {
          return withFeedback(state, feedback('info', 'empty-item', 'На паллете этого товара ещё нет.'));
        }
        const nextQuantity = current.quantity + quantity;
        if (nextQuantity < 0) {
          return withFeedback(state, feedback('error', 'invalid-quantity', 'Нельзя убрать больше товара, чем собрано.'));
        }
        const items = pallet.items
          .map((entry, index) => index === currentIndex ? { ...entry, quantity: nextQuantity } : entry)
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
      return withFeedback({ ...state, pallet: normalizedPallet(result.pallet) }, null);
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
        if (result.reason === 'wrong-zone') {
          return withFeedback({
            ...state,
            metrics: {
              ...state.metrics,
              spoiledPallets: (state.metrics?.spoiledPallets || 0) + 1,
              routePenalty: (state.metrics?.routePenalty || 0) + 10,
            },
            spoilageReasons: [...(state.spoilageReasons || []), result.spoilageReason],
          }, feedback('error', result.reason, messages[result.reason]));
        }
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      return withFeedback({
        ...state,
        vehicles: state.vehicles.map((entry) => entry.id === vehicle.id ? result.vehicle : entry),
        loadedPallets: [...(state.loadedPallets || []), pallet],
        routeStops: (state.routeStops || []).includes(pallet.storeId) ? (state.routeStops || []) : [...(state.routeStops || []), pallet.storeId],
        pallet: palletFor({ ...state, pallet }),
      }, feedback('success', 'pallet-loaded', 'Паллета собрана и готова к отгрузке.'));
    }

    if (action.type === 'SET_ROUTE') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === (action.vehicleId || state.selectedVehicleId));
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Выберите машину для маршрута.'));
      const route = engine.buildRoute(vehicle, action.stops);
      return withFeedback({ ...state, route, routeStops: [...route.stops] }, null);
    }

    if (action.type === 'PAUSE') return withFeedback({ ...state, paused: !state.paused }, feedback('info', state.paused ? 'resumed' : 'paused', state.paused ? 'Смена продолжается.' : 'Смена приостановлена.'));

    if (action.type === 'END_SHIFT') {
      const loadedPallets = state.loadedPallets || [];
      const orderStores = [...new Set((state.orders || loadedPallets).map((order) => order.storeId))];
      const deliveredStores = new Set(loadedPallets.map((pallet) => pallet.storeId));
      const deliveredPercent = orderStores.length ? Math.round((orderStores.filter((storeId) => deliveredStores.has(storeId)).length / orderStores.length) * 100) : 0;
      const loadedVehicles = (state.vehicles || []).filter((vehicle) => vehicle.pallets?.length > 0);
      const loadedWeight = loadedPallets.reduce((total, loadedPallet) => total + loadedPallet.weight, 0);
      const vehicleCapacity = loadedVehicles.reduce((total, vehicle) => total + vehicle.capacity, 0);
      const utilizationPercent = vehicleCapacity ? Math.round((loadedWeight / vehicleCapacity) * 100) : 0;
      const onTimePercent = state.secondsRemaining > 0 ? Math.max(0, 100 - (state.route?.minutes || 0)) : 0;
      const inputs = {
        deliveredPercent,
        onTimePercent,
        utilizationPercent,
        spoiledPallets: state.metrics?.spoiledPallets || 0,
        routePenalty: state.metrics?.routePenalty || 0,
        spoilageReasons: state.spoilageReasons || [],
      };
      const score = engine.scoreShift({
        ...inputs,
      });
      return withFeedback({ ...state, paused: true, report: { ...score, inputs } }, feedback('success', 'shift-ended', 'Смена завершена.'));
    }

    return withFeedback(state, feedback('error', 'unknown-action', 'Команда не поддерживается.'));
  }

  return { reduceAction };
});

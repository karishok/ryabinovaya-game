(function (root, factory) {
  const engine = typeof module !== 'undefined' && module.exports ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = typeof module !== 'undefined' && module.exports ? require('./levels.js') : root.RyabinovayaLevels;
  const api = factory(engine, levelData);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyabinovayaAppState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData) {
  const LEVELS = levelData.LEVELS;
  const feedback = (kind, code, message) => ({ kind, code, message });
  const withFeedback = (state, nextFeedback) => ({ ...state, feedback: nextFeedback });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const levelFor = (levelId) => LEVELS.find((level) => level.id === Number(levelId));
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

  function startLevel(levelId) {
    const level = levelFor(levelId);
    if (!level) throw new RangeError(`Unknown level: ${levelId}`);
    const scenario = engine.createShiftState(level);
    const delayedVehicles = new Set(level.events.filter((event) => event.type === 'vehicle-ready').map((event) => event.vehicleId));
    const vehicles = scenario.vehicles.map((vehicle) => ({ ...vehicle, pallets: [...(vehicle.pallets || [])], ready: !delayedVehicles.has(vehicle.id) }));
    const firstStore = scenario.orders[0]?.storeId || level.stores[0].id;
    const firstZone = scenario.orders[0]?.zone || level.unlockedZones[0];

    return {
      ...scenario,
      stores: copy(level.stores),
      unlockedZones: [...level.unlockedZones],
      vehicles,
      scheduledEvents: copy(level.events),
      appliedEventIndexes: [],
      elapsedSeconds: 0,
      paused: false,
      phase: 'briefing',
      story: { kind: 'before', text: level.storyBefore },
      activeScreen: 'warehouse',
      builderOpen: false,
      vehicleDrawerOpen: false,
      report: null,
      nextLevelId: null,
      selectedVehicleId: vehicles.find((vehicle) => vehicle.ready)?.id || vehicles[0]?.id || null,
      routeStops: [],
      pallet: engine.createPallet({ storeId: firstStore, zone: firstZone }),
      loadedPallets: [],
      spoilageReasons: [],
      feedback: null,
    };
  }

  function eventFeedback(event) {
    if (event.type === 'demand-increase') return feedback('info', 'demand-increase', `Заявка обновлена: ${event.quantity} шт. нужно добавить.`);
    if (event.type === 'vehicle-ready') return feedback('info', 'vehicle-ready', 'Дополнительная машина готова к загрузке.');
    if (event.type === 'store-reception-change') return feedback('info', 'store-reception-change', 'Даркстор изменил окно приёмки.');
    if (event.type === 'order-cancelled') return feedback('info', 'order-cancelled', 'Заявка отменена диспетчером.');
    return feedback('info', 'scenario-event', 'План смены обновлён.');
  }

  function tick(state, seconds = 1) {
    if (state.paused) return state;
    const requestedSeconds = Math.max(0, Number(seconds) || 0);
    const consumedSeconds = Math.min(requestedSeconds, state.secondsRemaining || 0);
    const previousElapsed = state.elapsedSeconds || 0;
    const elapsedSeconds = previousElapsed + consumedSeconds;
    let next = { ...state, secondsRemaining: Math.max(0, (state.secondsRemaining || 0) - consumedSeconds), elapsedSeconds };
    const triggeredIndexes = (state.scheduledEvents || [])
      .map((event, index) => ({ event, index }))
      .filter(({ event, index }) => !(state.appliedEventIndexes || []).includes(index) && event.atSecond > previousElapsed && event.atSecond <= elapsedSeconds);

    for (const { event, index } of triggeredIndexes) {
      next = engine.advanceScenario(next, event);
      next = { ...next, appliedEventIndexes: [...(next.appliedEventIndexes || []), index], feedback: eventFeedback(event) };
    }
    return next;
  }

  function scoreInputs(state) {
    const metric = state.metrics || {};
    const loadedPallets = state.loadedPallets || [];
    const orderStores = [...new Set((state.orders || loadedPallets).filter((order) => !order.cancelled).map((order) => order.storeId))];
    const deliveredStores = new Set(loadedPallets.map((pallet) => pallet.storeId));
    const calculatedDeliveredPercent = orderStores.length ? Math.round((orderStores.filter((storeId) => deliveredStores.has(storeId)).length / orderStores.length) * 100) : 0;
    const loadedVehicles = (state.vehicles || []).filter((vehicle) => vehicle.pallets?.length > 0);
    const loadedWeight = loadedPallets.reduce((total, loadedPallet) => total + loadedPallet.weight, 0);
    const vehicleCapacity = loadedVehicles.reduce((total, vehicle) => total + vehicle.capacity, 0);
    const calculatedUtilizationPercent = vehicleCapacity ? Math.round((loadedWeight / vehicleCapacity) * 100) : 0;
    const calculatedOnTimePercent = state.secondsRemaining > 0 ? Math.max(0, 100 - (state.route?.minutes || 0)) : 0;
    const supplied = (key, fallback) => Number.isFinite(metric[key]) ? metric[key] : fallback;

    return {
      deliveredPercent: supplied('deliveredPercent', calculatedDeliveredPercent),
      onTimePercent: supplied('onTimePercent', calculatedOnTimePercent),
      utilizationPercent: supplied('utilizationPercent', calculatedUtilizationPercent),
      spoiledPallets: supplied('spoiledPallets', 0),
      routePenalty: supplied('routePenalty', 0),
      spoilageReasons: state.spoilageReasons || [],
    };
  }

  function finishShift(state) {
    const inputs = scoreInputs(state);
    const score = engine.scoreShift(inputs);
    const report = {
      ...score,
      deliveredPercent: inputs.deliveredPercent,
      onTimePercent: inputs.onTimePercent,
      utilizationPercent: inputs.utilizationPercent,
      spoiledPallets: inputs.spoiledPallets,
      inputs,
    };
    const currentIndex = LEVELS.findIndex((level) => level.id === state.levelId);
    return { report, nextLevelId: currentIndex >= 0 ? LEVELS[currentIndex + 1]?.id || null : null };
  }

  function reduceAction(state, action) {
    if (action.type === 'START_LEVEL') return startLevel(action.levelId);
    if (action.type === 'TICK') return tick(state, action.seconds);
    if (action.type === 'DISMISS_FEEDBACK') return { ...state, feedback: null };
    if (action.type === 'CONTINUE_STORY') {
      if (state.phase === 'story-after') return state.nextLevelId ? startLevel(state.nextLevelId) : { ...state, phase: 'endless', story: null, report: null };
      if (state.phase === 'briefing') return { ...state, phase: 'shift', story: null };
      return state;
    }
    if (action.type === 'SHOW_STORY_AFTER') {
      const level = levelFor(state.levelId);
      return { ...state, phase: 'story-after', report: null, story: { kind: 'after', text: level?.storyAfter || 'Смена завершена.' }, feedback: null };
    }

    const pallet = normalizedPallet(state.pallet || engine.createPallet({ storeId: 'north', zone: 'dry' }));
    if (action.type === 'SELECT_ZONE') return withFeedback({ ...state, pallet: palletFor({ ...state, pallet }, { zone: action.zone }) }, null);
    if (action.type === 'SELECT_STORE') return withFeedback({ ...state, pallet: palletFor({ ...state, pallet }, { storeId: action.storeId }) }, null);

    if (action.type === 'ADD_ITEM') {
      const quantity = Number(action.quantity);
      if (!Number.isInteger(quantity) || quantity === 0) return withFeedback(state, feedback('error', 'invalid-quantity', 'Укажите целое количество товара.'));
      const item = { sku: action.sku, zone: action.zone, weightPerUnit: action.weightPerUnit };
      if (quantity < 0) {
        const currentIndex = pallet.items.findIndex((entry) => entry.sku === item.sku);
        const current = pallet.items[currentIndex];
        if (!current) return withFeedback(state, feedback('info', 'empty-item', 'На паллете этого товара ещё нет.'));
        const nextQuantity = current.quantity + quantity;
        if (nextQuantity < 0) return withFeedback(state, feedback('error', 'invalid-quantity', 'Нельзя убрать больше товара, чем собрано.'));
        const items = pallet.items.map((entry, index) => index === currentIndex ? { ...entry, quantity: nextQuantity } : entry).filter((entry) => entry.quantity > 0);
        return withFeedback({ ...state, pallet: { ...pallet, items, weight: pallet.weight + item.weightPerUnit * quantity } }, null);
      }
      const result = engine.addItemToPallet(pallet, item, quantity);
      if (!result.ok) {
        const messages = { 'wrong-zone': 'Этот товар нужно собирать в другой зоне.', 'over-capacity': 'Паллета не выдержит такой вес.' };
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      return withFeedback({ ...state, pallet: normalizedPallet(result.pallet) }, null);
    }

    if (action.type === 'LOAD_PALLET') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === action.vehicleId);
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Машина для отгрузки не найдена.'));
      if (vehicle.ready === false) return withFeedback(state, feedback('info', 'vehicle-not-ready', 'Эта машина будет готова позже.'));
      if (pallet.weight === 0) return withFeedback(state, feedback('info', 'empty-pallet', 'Сначала добавьте товар на паллету.'));
      const result = engine.loadPallet(vehicle, pallet);
      if (!result.ok) {
        const messages = { 'wrong-zone': 'Эта машина не обслуживает выбранную зону.', 'over-capacity': 'В машине не осталось места для этой паллеты.' };
        if (result.reason === 'wrong-zone') {
          return withFeedback({
            ...state,
            metrics: { ...state.metrics, spoiledPallets: (state.metrics?.spoiledPallets || 0) + 1, routePenalty: (state.metrics?.routePenalty || 0) + 10 },
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
      const { report, nextLevelId } = finishShift(state);
      return withFeedback({ ...state, paused: true, report, nextLevelId, phase: 'report' }, feedback('success', 'shift-ended', 'Смена завершена.'));
    }
    return withFeedback(state, feedback('error', 'unknown-action', 'Команда не поддерживается.'));
  }

  return { reduceAction, startLevel, tick, finishShift };
});

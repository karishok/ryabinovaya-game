(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const scoring = isNode ? require('./scoring.js') : root.RyabinovayaScoring;
  const api = factory(engine, levelData, scoring);
  if (isNode) module.exports = api;
  else root.RyabinovayaAppState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData, scoring) {
  const LEVELS = levelData.LEVELS;
  const STORE_NAMES = levelData.STORE_NAMES;
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
  const routeFor = (state, vehicleId) => {
    if (Object.keys(state.routesByVehicle || {}).length > 0) return state.routesByVehicle[vehicleId] || null;
    const vehicleIds = new Set((state.vehicles || []).map((vehicle) => vehicle.id));
    if (vehicleIds.size > 1 && state.selectedVehicleId !== vehicleId) return null;
    if (vehicleIds.size === 1 && !vehicleIds.has(vehicleId)) return null;
    return state.route || null;
  };
  const routeStopsFor = (state, vehicleId) => state.routeStopsByVehicle?.[vehicleId]
    || routeFor(state, vehicleId)?.stops
    || [];
  const missingRouteVehicles = (state) => {
    const loadedVehicleIds = new Set((state.loadedPallets || []).map((pallet) => pallet.vehicleId));
    return (state.vehicles || [])
      .filter((vehicle) => loadedVehicleIds.has(vehicle.id) && !(routeFor(state, vehicle.id)?.stops.length > 0))
      .map((vehicle) => vehicle.id);
  };
  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => !(state.loadedPallets || []).some((pallet) => pallet.storeId === order.storeId)) || active[0] || null;
  };
  const initialTsdState = () => ({
    open: true,
    screen: 'briefing',
    acceptedOrderId: null,
    signal: 'new',
  });

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
      tsd: initialTsdState(),
      builderOpen: false,
      vehicleDrawerOpen: false,
      guideOpen: false,
      guidePausedBeforeOpen: null,
      report: null,
      nextLevelId: null,
      selectedVehicleId: vehicles.find((vehicle) => vehicle.ready)?.id || vehicles[0]?.id || null,
      routeStops: [],
      routeStopsByVehicle: {},
      routesByVehicle: {},
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

  function shiftOutcome(state) {
    const activeOrders = (state.orders || []).filter((order) => !order.cancelled);
    const fulfilledByLine = new Map();
    let loadedWeight = 0;

    for (const pallet of state.loadedPallets || []) {
      loadedWeight += pallet.weight;
      const vehicle = (state.vehicles || []).find((entry) => entry.id === pallet.vehicleId);
      const route = routeFor(state, pallet.vehicleId);
      if (!vehicle || vehicle.zone !== pallet.zone || !route?.stops.includes(pallet.storeId)) continue;
      for (const item of pallet.items || []) {
        if (item.zone !== pallet.zone) continue;
        const key = `${pallet.storeId}:${pallet.zone}:${item.sku}`;
        fulfilledByLine.set(key, (fulfilledByLine.get(key) || 0) + item.quantity);
      }
    }

    const remaining = new Map(fulfilledByLine);
    const delivered = [];
    let usefulWeight = 0;
    for (const order of activeOrders) {
      const key = `${order.storeId}:${order.zone}:${order.sku}`;
      const counted = Math.min(order.quantity, remaining.get(key) || 0);
      remaining.set(key, (remaining.get(key) || 0) - counted);
      if (counted > 0) {
        const item = engine.itemBySku(order.sku);
        usefulWeight += counted * (item?.weightPerUnit || 0);
        delivered.push({ storeId: order.storeId, zone: order.zone, sku: order.sku, quantity: counted, price: item?.price || 0 });
      }
    }

    const loadedVehicleIds = new Set((state.loadedPallets || []).map((pallet) => pallet.vehicleId));
    const routes = (state.vehicles || [])
      .filter((vehicle) => loadedVehicleIds.has(vehicle.id))
      .map((vehicle) => {
        const route = routeFor(state, vehicle.id);
        const stops = route?.stops || [];
        const best = engine.bestRoute(stops);
        return { vehicleId: vehicle.id, stops, minutes: route?.minutes || 0, bestStops: best.stops, bestMinutes: best.minutes };
      });

    return {
      demand: activeOrders.map((order) => ({
        storeId: order.storeId, zone: order.zone, sku: order.sku, quantity: order.quantity,
        storeName: STORE_NAMES[order.storeId] || order.storeId,
        itemName: engine.itemBySku(order.sku)?.name || order.sku,
      })),
      delivered,
      loadedWeight,
      usefulWeight,
      routes,
      vehiclesWithoutRoute: missingRouteVehicles(state),
      spoiledPallets: state.metrics?.spoiledPallets || 0,
      spoilageReasons: state.spoilageReasons || [],
      storeNames: STORE_NAMES,
    };
  }

  const liveMetrics = (state) => scoring.metricsFor(shiftOutcome(state));

  function fulfillmentFor(state) {
    const outcome = shiftOutcome(state);
    return {
      fulfilledQuantity: outcome.delivered.reduce((total, line) => total + line.quantity, 0),
      demandQuantity: outcome.demand.reduce((total, line) => total + line.quantity, 0),
      deliveredPercent: scoring.metricsFor(outcome).deliveredPercent,
    };
  }

  function finishShift(state) {
    const outcome = shiftOutcome(state);
    const score = scoring.scoreShift(outcome);
    const report = {
      stars: score.stars,
      profit: score.profit,
      reasons: score.reasons,
      deliveredPercent: score.metrics.deliveredPercent,
      onTimePercent: score.metrics.onTimePercent,
      precisionPercent: score.metrics.precisionPercent,
      spoiledPallets: outcome.spoiledPallets,
    };
    const currentIndex = LEVELS.findIndex((level) => level.id === state.levelId);
    return { report, nextLevelId: currentIndex >= 0 ? LEVELS[currentIndex + 1]?.id || null : null };
  }

  function reduceAction(state, action) {
    if (action.type === 'START_LEVEL') return startLevel(action.levelId);
    if (action.type === 'TICK') return tick(state, action.seconds);
    if (action.type === 'DISMISS_FEEDBACK') return { ...state, feedback: null };
    if (action.type === 'OPEN_GUIDE') {
      return {
        ...state,
        guideOpen: true,
        guidePausedBeforeOpen: state.paused,
        paused: true,
      };
    }
    if (action.type === 'CLOSE_GUIDE') {
      return {
        ...state,
        guideOpen: false,
        paused: state.guidePausedBeforeOpen ?? state.paused,
        guidePausedBeforeOpen: null,
      };
    }
    if (action.type === 'CONTINUE_STORY') {
      if (state.phase === 'story-after') return state.nextLevelId ? startLevel(state.nextLevelId) : { ...state, phase: 'endless', story: null, report: null };
      if (state.phase === 'briefing') {
        return {
          ...state,
          phase: 'shift',
          story: null,
          tsd: { ...state.tsd, open: true, screen: 'task', signal: 'new' },
        };
      }
      return state;
    }
    if (action.type === 'SHOW_STORY_AFTER') {
      const level = levelFor(state.levelId);
      return { ...state, phase: 'story-after', report: null, story: { kind: 'after', text: level?.storyAfter || 'Смена завершена.' }, feedback: null };
    }

    if (action.type === 'OPEN_TSD') return { ...state, tsd: { ...state.tsd, open: true } };
    if (action.type === 'CLOSE_TSD') return { ...state, tsd: { ...state.tsd, open: false } };
    if (action.type === 'SHOW_TSD_TASK') {
      return { ...state, tsd: { ...state.tsd, open: true, screen: 'task', signal: 'new' } };
    }
    if (action.type === 'ACCEPT_TASK') {
      if (state.tsd?.acceptedOrderId) return state;
      const order = activeOrderFor(state);
      if (!order) return { ...state, tsd: { ...state.tsd, open: false, screen: 'current', signal: 'idle' } };
      return {
        ...state,
        tsd: { open: false, screen: 'current', acceptedOrderId: order.id, signal: 'idle' },
      };
    }

    if (action.type === 'SELECT_VEHICLE') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === action.vehicleId);
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Машина для отгрузки не найдена.'));
      const route = routeFor(state, vehicle.id);
      return withFeedback({ ...state, selectedVehicleId: vehicle.id, route, routeStops: [...routeStopsFor(state, vehicle.id)] }, null);
    }

    if (action.type === 'MOVE_STOP') {
      const vehicleId = state.selectedVehicleId;
      const routeStops = [...routeStopsFor(state, vehicleId)];
      const index = Number(action.index);
      const target = index + Number(action.direction);
      if (routeStops[target]) [routeStops[index], routeStops[target]] = [routeStops[target], routeStops[index]];
      return withFeedback({
        ...state,
        routeStops,
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicleId]: routeStops },
      }, null);
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
        const messages = { 'wrong-zone': 'Неверная зона: паллета испорчена, соберите её заново.', 'over-capacity': 'В машине не осталось места для этой паллеты.' };
        if (result.reason === 'wrong-zone') {
          return withFeedback({
            ...state,
            metrics: { ...state.metrics, spoiledPallets: (state.metrics?.spoiledPallets || 0) + 1 },
            spoilageReasons: [...(state.spoilageReasons || []), result.spoilageReason],
            pallet: palletFor({ ...state, pallet }),
          }, feedback('error', result.reason, messages[result.reason]));
        }
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      const vehicleRouteStops = routeStopsFor(state, vehicle.id);
      const nextRouteStops = vehicleRouteStops.includes(pallet.storeId) ? vehicleRouteStops : [...vehicleRouteStops, pallet.storeId];
      return withFeedback({
        ...state,
        vehicles: state.vehicles.map((entry) => entry.id === vehicle.id ? result.vehicle : entry),
        loadedPallets: [...(state.loadedPallets || []), result.pallet],
        routeStops: state.selectedVehicleId === vehicle.id ? nextRouteStops : state.routeStops || [],
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicle.id]: nextRouteStops },
        pallet: palletFor({ ...state, pallet }),
        tsd: {
          open: false,
          screen: 'current',
          acceptedOrderId: null,
          signal: 'success',
        },
      }, feedback('success', 'pallet-loaded', 'Паллета собрана и готова к отгрузке.'));
    }

    if (action.type === 'SET_ROUTE') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === (action.vehicleId || state.selectedVehicleId));
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Выберите машину для маршрута.'));
      const route = engine.buildRoute(vehicle, action.stops);
      return withFeedback({
        ...state,
        route,
        routeStops: [...route.stops],
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicle.id]: [...route.stops] },
        routesByVehicle: { ...(state.routesByVehicle || {}), [vehicle.id]: route },
      }, null);
    }
    if (action.type === 'PAUSE') return withFeedback({ ...state, paused: !state.paused }, feedback('info', state.paused ? 'resumed' : 'paused', state.paused ? 'Смена продолжается.' : 'Смена приостановлена.'));
    if (action.type === 'END_SHIFT') {
      const { report, nextLevelId } = finishShift(state);
      return withFeedback({ ...state, paused: true, report, nextLevelId, phase: 'report' }, feedback('success', 'shift-ended', 'Смена завершена.'));
    }
    return withFeedback(state, feedback('error', 'unknown-action', 'Команда не поддерживается.'));
  }

  return { reduceAction, startLevel, tick, finishShift, shiftOutcome, liveMetrics, fulfillmentFor, missingRouteVehicles };
});

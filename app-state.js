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
  /* Сколько по этой строке заявки уже уехало. Считать «магазин закрыт, если
     на него есть хоть одна паллета» нельзя: заявка может вырасти в середине
     смены или не влезть в одну паллету, и тогда остаток станет недостижимым. */
  const loadedQuantityFor = (state, order) => (state.loadedPallets || [])
    .filter((pallet) => pallet.storeId === order.storeId && pallet.zone === order.zone)
    .reduce((total, pallet) => total + (pallet.items || [])
      .filter((item) => item.sku === order.sku)
      .reduce((sum, item) => sum + item.quantity, 0), 0);

  const remainingFor = (state, order) => Math.max(0, order.quantity - loadedQuantityFor(state, order));

  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => remainingFor(state, order) > 0) || null;
  };

  const pendingInboundFor = (state) => (state.inbound || [])
    .find((pallet) => pallet.status === 'arrived' || pallet.status === 'received') || null;

  const roomIn = (vehicle) => vehicle.capacity - (vehicle.pallets || []).reduce((total, pallet) => total + pallet.weight, 0);

  /* Два фургона одной зоны назывались одинаково («Сухач фургон»), и в списке
     машин их было не различить — на смене с делением заявки это как раз то,
     что нужно понимать. Номер появляется только когда есть из чего выбирать. */
  function vehicleLabel(state, vehicle) {
    if (!vehicle) return 'Машина не выбрана';
    const zoneName = levelData.ZONE_NAMES[vehicle.zone] || vehicle.zone;
    const sameZone = (state.vehicles || []).filter((entry) => entry.zone === vehicle.zone);
    if (sameZone.length < 2) return `${zoneName} фургон`;
    return `${zoneName} фургон №${sameZone.findIndex((entry) => entry.id === vehicle.id) + 1}`;
  }

  /* Машину под паллету назначает склад, а не игрок: своя зона и достаточно
     места. Раньше выбор был неявным (первый подходящий фургон), и заявку,
     которая не влезает в одну машину, доставить было нельзя — вторая
     паллета упиралась в забитый кузов, а выбрать другой фургон в сборке
     было негде. */
  function vehicleForPallet(state, pallet, preferredId) {
    const fleet = (state.vehicles || []).filter((vehicle) => vehicle.zone === pallet.zone && vehicle.ready !== false);
    const preferred = fleet.find((vehicle) => vehicle.id === preferredId);
    if (preferred && roomIn(preferred) >= pallet.weight) return { vehicle: preferred };
    const withRoom = fleet.find((vehicle) => roomIn(vehicle) >= pallet.weight);
    if (withRoom) return { vehicle: withRoom };
    if (fleet.length > 0) return { reason: 'fleet-full' };
    const waiting = (state.vehicles || []).some((vehicle) => vehicle.zone === pallet.zone && vehicle.ready === false);
    return { reason: waiting ? 'vehicle-not-ready' : 'no-vehicle' };
  }
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
    if (event.type === 'pallet-arrived') return feedback('info', 'pallet-arrived', 'На приёмку пришла новая паллета.');
    if (event.type === 'store-reception-change') return feedback('info', 'store-reception-change', 'Даркстор изменил окно приёмки.');
    if (event.type === 'order-cancelled') return feedback('info', 'order-cancelled', 'Заявка отменена диспетчером.');
    return feedback('info', 'scenario-event', 'План смены обновлён.');
  }

  /* Событие смены срабатывает либо по секундам, либо по прогрессу игрока.
     Прогресс надёжнее: смену можно закрыть за пятнадцать секунд, и событие,
     назначенное на 120-ю секунду, не наступало никогда. */
  const eventIsDue = (event, state) => {
    if (typeof event.afterLoadedPallets === 'number') return (state.loadedPallets || []).length >= event.afterLoadedPallets;
    if (typeof event.afterPlacedPallets === 'number') return (state.inbound || []).filter((pallet) => pallet.status === 'placed').length >= event.afterPlacedPallets;
    if (typeof event.atSecond === 'number') return (state.elapsedSeconds || 0) >= event.atSecond;
    return false;
  };

  function applyScheduledEvents(state) {
    let next = state;
    const pending = (state.scheduledEvents || [])
      .map((event, index) => ({ event, index }))
      .filter(({ index }) => !(state.appliedEventIndexes || []).includes(index));

    for (const { event, index } of pending) {
      if (!eventIsDue(event, next)) continue;
      next = engine.advanceScenario(next, event);
      next = { ...next, appliedEventIndexes: [...(next.appliedEventIndexes || []), index], feedback: eventFeedback(event) };
    }
    return next;
  }

  function tick(state, seconds = 1) {
    if (state.paused) return state;
    const requestedSeconds = Math.max(0, Number(seconds) || 0);
    const consumedSeconds = Math.min(requestedSeconds, state.secondsRemaining || 0);
    const elapsedSeconds = (state.elapsedSeconds || 0) + consumedSeconds;
    const next = { ...state, secondsRemaining: Math.max(0, (state.secondsRemaining || 0) - consumedSeconds), elapsedSeconds };
    return applyScheduledEvents(next);
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

    const inbound = state.inbound || [];
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
      inboundTotal: inbound.length,
      inboundPlaced: inbound.filter((pallet) => pallet.status === 'placed').length,
      inboundLeftOnDock: inbound
        .filter((pallet) => pallet.status === 'arrived' || pallet.status === 'received')
        .map((pallet) => ({ itemName: engine.itemBySku(pallet.sku)?.name || pallet.sku, zoneName: levelData.ZONE_NAMES[pallet.zone] || pallet.zone })),
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

    /* Приёмка: кладовщик отмечает в ТСД, что паллета от поставщика принята.
       Пока она не размещена в зоне, товара на складе нет и отбирать нечего. */
    if (action.type === 'RECEIVE_PALLET') {
      const pending = pendingInboundFor(state);
      if (!pending) return withFeedback(state, feedback('info', 'no-inbound', 'На приёмке пусто.'));
      const result = engine.receiveInbound(pending);
      if (!result.ok) return withFeedback(state, feedback('info', 'already-received', 'Эта паллета уже принята — разместите её в зоне.'));
      return withFeedback({
        ...state,
        inbound: state.inbound.map((pallet) => pallet.id === pending.id ? result.pallet : pallet),
        tsd: { ...state.tsd, open: false, screen: 'current', signal: 'idle' },
      }, feedback('info', 'pallet-received', 'Паллета принята.'));
    }

    /* Размещение: игрок жмёт вывеску зоны на схеме склада. Ошибка портит
       паллету по тому же правилу, что и погрузка в неподходящий фургон. */
    if (action.type === 'PLACE_PALLET') {
      const pending = pendingInboundFor(state);
      if (!pending) return withFeedback(state, feedback('info', 'no-inbound', 'Размещать нечего.'));
      if (pending.status === 'arrived') return withFeedback(state, feedback('error', 'not-received', 'Сначала примите паллету в ТСД.'));
      const result = engine.placeInbound(pending, action.zone);
      const inbound = state.inbound.map((pallet) => pallet.id === pending.id ? result.pallet : pallet);
      if (!result.ok) {
        return withFeedback({
          ...state,
          inbound,
          metrics: { ...state.metrics, spoiledPallets: (state.metrics?.spoiledPallets || 0) + 1 },
          spoilageReasons: [...(state.spoilageReasons || []), result.spoilageReason],
        }, feedback('error', 'wrong-placement', `Не та зона: ${engine.itemBySku(pending.sku)?.name || pending.sku} испорчен.`));
      }
      return withFeedback({
        ...state,
        inbound,
        stock: engine.addToStock(state.stock, pending.zone, pending.sku, pending.quantity),
      }, feedback('success', 'pallet-placed', `${engine.itemBySku(pending.sku)?.name || pending.sku} на месте: ${pending.quantity} шт. в зоне «${levelData.ZONE_NAMES[pending.zone] || pending.zone}».`));
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
      const reordered = engine.buildRoute(null, routeStops);
      return withFeedback({
        ...state,
        route: reordered,
        routeStops,
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicleId]: routeStops },
        routesByVehicle: { ...(state.routesByVehicle || {}), [vehicleId]: reordered },
      }, null);
    }

    const pallet = normalizedPallet(state.pallet || engine.createPallet({ storeId: 'north', zone: 'dry' }));
    /* Смена зоны обнуляет паллету — товар другой зоны на ней лежать не может.
       Но отобранное надо вернуть в зону, иначе переключением зоны туда-сюда
       можно было безвозвратно списать запас смены. */
    if (action.type === 'SELECT_ZONE') {
      if (action.zone === pallet.zone) return withFeedback(state, null);
      const stock = pallet.items.reduce((total, item) => engine.addToStock(total, item.zone, item.sku, item.quantity), state.stock);
      return withFeedback({ ...state, stock, pallet: palletFor({ ...state, pallet }, { zone: action.zone }) }, null);
    }
    // Адрес паллеты меняется без потери товара: зона та же, значит груз годен.
    if (action.type === 'SELECT_STORE') return withFeedback({ ...state, pallet: { ...pallet, storeId: action.storeId } }, null);

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
        return withFeedback({
          ...state,
          pallet: { ...pallet, items, weight: pallet.weight + item.weightPerUnit * quantity },
          stock: engine.addToStock(state.stock, item.zone, item.sku, -quantity),
        }, null);
      }
      const taken = engine.takeFromStock(state.stock, item.zone, item.sku, quantity);
      if (!taken.ok) {
        const onDock = (state.inbound || []).find((entry) => entry.sku === item.sku && entry.status !== 'placed' && entry.status !== 'spoiled');
        const message = onDock
          ? 'В зоне не осталось товара — сначала примите и разместите поставку.'
          : 'В зоне не осталось этого товара.';
        return withFeedback(state, feedback('error', 'no-stock', message));
      }
      const result = engine.addItemToPallet(pallet, item, quantity);
      if (!result.ok) {
        /* «Поставьте в отгрузку», а не «отправьте»: отправки машин в игре нет,
           и слово уводило игрока искать несуществующую кнопку. */
        const messages = { 'wrong-zone': 'Этот товар нужно собирать в другой зоне.', 'over-capacity': 'Паллета больше не выдержит — поставьте её в отгрузку и начните новую.' };
        return withFeedback(state, feedback('error', result.reason, messages[result.reason]));
      }
      return withFeedback({ ...state, pallet: normalizedPallet(result.pallet), stock: taken.stock }, null);
    }

    if (action.type === 'LOAD_PALLET') {
      if (pallet.weight === 0) return withFeedback(state, feedback('info', 'empty-pallet', 'Сначала добавьте товар на паллету.'));
      const zoneName = levelData.ZONE_NAMES[pallet.zone] || pallet.zone;
      const pick = vehicleForPallet(state, pallet, action.vehicleId || state.selectedVehicleId);
      if (!pick.vehicle) {
        const messages = {
          /* Машины не уезжают до конца смены и свободными не становятся, так
             что советовать «отправьте и дождитесь» было обещанием действия,
             которого нет. Полный парк означает перебор по весу. */
          'fleet-full': `Все фургоны зоны «${zoneName}» полны. Откройте машины на схеме и снимите лишнюю паллету — товар вернётся в зону.`,
          'vehicle-not-ready': `Фургон зоны «${zoneName}» ещё в рейсе, он будет готов позже.`,
          'no-vehicle': `Для зоны «${zoneName}» в смене нет фургона.`,
        };
        return withFeedback(state, feedback('error', pick.reason, messages[pick.reason]));
      }
      const vehicle = pick.vehicle;
      const result = engine.loadPallet(vehicle, pallet);
      if (!result.ok) return withFeedback(state, feedback('error', result.reason, 'Этот фургон не берёт такую паллету.'));
      const vehicleRouteStops = routeStopsFor(state, vehicle.id);
      const nextRouteStops = vehicleRouteStops.includes(pallet.storeId) ? vehicleRouteStops : [...vehicleRouteStops, pallet.storeId];
      /* Маршрут строится сам в порядке погрузки. Раньше кнопку «Построить
         маршрут» можно было не нажать, и тогда смена молча обнулялась: все
         паллеты уезжали без рейса и не засчитывались. Порядок остановок
         по-прежнему решает игрок — он меняется стрелками и влияет на «Вовремя». */
      const loaded = {
        ...state,
        vehicles: state.vehicles.map((entry) => entry.id === vehicle.id ? result.vehicle : entry),
        loadedPallets: [...(state.loadedPallets || []), result.pallet],
        // Выбор следует за грузом: панель транспорта открывается на той
        // машине, которая только что забрала паллету.
        selectedVehicleId: vehicle.id,
        routeStops: nextRouteStops,
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicle.id]: nextRouteStops },
        routesByVehicle: { ...(state.routesByVehicle || {}), [vehicle.id]: engine.buildRoute(vehicle, nextRouteStops) },
        tsd: {
          open: false,
          screen: 'current',
          acceptedOrderId: null,
          signal: 'success',
        },
      };
      /* Следующая паллета сразу нацелена на следующую незакрытую заявку:
         переспрашивать адрес и зону, которые уже написаны в задании, незачем. */
      const nextOrder = activeOrderFor(loaded);
      return withFeedback({
        ...loaded,
        pallet: palletFor(loaded, nextOrder ? { storeId: nextOrder.storeId, zone: nextOrder.zone } : { storeId: pallet.storeId, zone: pallet.zone }),
      }, feedback('success', 'pallet-loaded', `${pallet.weight} кг в кузов «${vehicleLabel(state, vehicle)}», адрес в маршруте.`));
    }

    /* Снятие паллеты — единственный способ исправить забитый лишним кузов.
       Товар возвращается в зону, адрес уходит из маршрута, если в этой машине
       для него больше ничего не осталось. */
    if (action.type === 'UNLOAD_PALLET') {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === action.vehicleId);
      if (!vehicle) return withFeedback(state, feedback('error', 'unknown-vehicle', 'Машина не найдена.'));
      const result = engine.unloadPallet(vehicle, Number(action.palletIndex));
      if (!result.ok) return withFeedback(state, feedback('error', result.reason, 'Этой паллеты в кузове нет.'));

      const removed = result.pallet;
      const stock = (removed.items || []).reduce(
        (total, item) => engine.addToStock(total, item.zone, item.sku, item.quantity),
        state.stock,
      );
      let seen = false;
      const loadedPallets = (state.loadedPallets || []).filter((pallet) => {
        if (seen || pallet.vehicleId !== vehicle.id || pallet.storeId !== removed.storeId || pallet.weight !== removed.weight) return true;
        seen = true;
        return false;
      });
      const stillServed = new Set(result.vehicle.pallets.map((pallet) => pallet.storeId));
      const stops = (routeStopsFor(state, vehicle.id)).filter((storeId) => stillServed.has(storeId));
      const route = engine.buildRoute(null, stops);

      return withFeedback({
        ...state,
        stock,
        loadedPallets,
        vehicles: state.vehicles.map((entry) => entry.id === vehicle.id ? result.vehicle : entry),
        routeStops: state.selectedVehicleId === vehicle.id ? stops : state.routeStops || [],
        routeStopsByVehicle: { ...(state.routeStopsByVehicle || {}), [vehicle.id]: stops },
        routesByVehicle: { ...(state.routesByVehicle || {}), [vehicle.id]: route },
      }, feedback('info', 'pallet-unloaded', `Паллета снята, ${removed.weight} кг вернулись в зону.`));
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

  return {
    reduceAction, startLevel, tick, finishShift, shiftOutcome, liveMetrics, fulfillmentFor,
    missingRouteVehicles, activeOrderFor, pendingInboundFor, remainingFor,
    vehicleForPallet, vehicleLabel, roomIn,
  };
});

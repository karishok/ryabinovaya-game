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
  // Зона для игрока: название и температура с вывески, как на схеме.
  const zoneLabel = (zone) => `${levelData.ZONE_NAMES[zone] || zone} ${levelData.ZONE_MARKS[zone] || ''}`.trim();
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

  /* Паллета приёмки, с которой сейчас работают. На смене с поводырём это
     первая у ворот; на смене с очередью ТСД — та, чьё задание принято:
     паллета, стоящая у ворот дольше, не должна перехватывать приёмку срочной. */
  const pendingInboundFor = (state) => {
    const pending = (state.inbound || []).filter((pallet) => pallet.status === 'arrived' || pallet.status === 'received');
    const active = String(state.activeTaskId || '');
    const taken = active.startsWith('receive:') ? pending.find((pallet) => pallet.id === active.slice('receive:'.length)) : null;
    return taken || pending[0] || null;
  };

  /* Паллета-сирота: лежит в кузове, а заявки на неё больше нет — даркстор
     её отменил. Она едет мёртвым весом, пока её не снимут. */
  const orphanPalletsFor = (state) => {
    const open = new Set((state.orders || [])
      .filter((order) => !order.cancelled)
      .map((order) => `${order.storeId}:${order.zone}:${order.sku}`));
    return (state.vehicles || []).flatMap((vehicle) => (vehicle.pallets || [])
      .map((pallet, palletIndex) => ({ pallet, palletIndex, vehicleId: vehicle.id }))
      .filter(({ pallet }) => (pallet.items || []).length > 0
        && !(pallet.items || []).some((item) => open.has(`${pallet.storeId}:${pallet.zone}:${item.sku}`))));
  };

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
    const zoneFleet = (state.vehicles || []).filter((vehicle) => vehicle.zone === pallet.zone);
    // Фургон, ушедший в рейс, груз уже не возьмёт.
    if (zoneFleet.length > 0 && zoneFleet.every((vehicle) => vehicle.departed === true)) return { reason: 'vehicle-departed' };
    const fleet = zoneFleet.filter((vehicle) => vehicle.ready !== false && vehicle.departed !== true);
    const preferred = fleet.find((vehicle) => vehicle.id === preferredId);
    if (preferred && roomIn(preferred) >= pallet.weight) return { vehicle: preferred };
    const withRoom = fleet.find((vehicle) => roomIn(vehicle) >= pallet.weight);
    if (withRoom) return { vehicle: withRoom };
    /* Если фургон зоны ещё в рейсе, «все фургоны полны, снимите лишнее»
       было бы неправдой: место появится само, когда он вернётся. */
    const waiting = (state.vehicles || []).some((vehicle) => vehicle.zone === pallet.zone && vehicle.ready === false);
    if (waiting) return { reason: 'vehicle-not-ready' };
    return { reason: fleet.length > 0 ? 'fleet-full' : 'no-vehicle' };
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
    /* Время ухода в рейс — в секундах от начала смены. Фургон без него
       стоит до конца смены, как раньше. */
    const departures = level.departures || {};
    const vehicles = scenario.vehicles.map((vehicle) => ({
      ...vehicle,
      pallets: [...(vehicle.pallets || [])],
      ready: !delayedVehicles.has(vehicle.id),
      departsAt: typeof departures[vehicle.id] === 'number' ? departures[vehicle.id] : null,
      departed: false,
    }));
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
      // Очередь ТСД: что принято и что пришло срочным.
      activeTaskId: null,
      urgentTaskIds: [],
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

  /* Событие называет, кто и что поменял: «Заявка обновлена» без адреса
     заставляло искать, какая именно, а на смене с четырьмя дарксторами это
     и есть вся информация. */
  function eventFeedback(event, state) {
    const orderOf = (orderId) => (state?.orders || []).find((order) => order.id === orderId);
    const storeOf = (order) => `Даркстор «${STORE_NAMES[order?.storeId] || order?.storeId || '—'}»`;
    if (event.type === 'demand-increase') {
      return feedback('info', 'demand-increase', `${storeOf(orderOf(event.orderId))} дозаказал: ещё ${event.quantity} шт.`);
    }
    if (event.type === 'vehicle-ready') {
      const vehicle = (state?.vehicles || []).find((entry) => entry.id === event.vehicleId);
      return feedback('info', 'vehicle-ready', `«${vehicleLabel(state, vehicle)}» вернулся из рейса и готов к загрузке.`);
    }
    if (event.type === 'pallet-arrived') {
      const item = engine.itemBySku(event.pallet?.sku);
      return feedback('info', 'pallet-arrived', `На приёмку пришла фура: ${item?.name || 'поставка'}.`);
    }
    if (event.type === 'store-reception-change') return feedback('info', 'store-reception-change', 'Даркстор изменил окно приёмки.');
    if (event.type === 'order-cancelled') {
      const order = orderOf(event.orderId);
      // На смене без поводыря диспетчер сообщает факт, а вывод делает игрок.
      const guided = levelFor(state.levelId)?.guided !== false;
      const inTruck = guided && order && orphanPalletsFor(state).length > 0;
      return feedback('info', 'order-cancelled', inTruck
        ? `${storeOf(order)} отменил заявку. Его паллета уже в кузове — снимите её.`
        : `${storeOf(order)} отменил заявку.`);
    }
    return feedback('info', 'scenario-event', 'План смены обновлён.');
  }

  /* Событие смены срабатывает либо по секундам, либо по прогрессу игрока.
     Прогресс надёжнее: смену можно закрыть за пятнадцать секунд, и событие,
     назначенное на 120-ю секунду, не наступало никогда. */
  const eventIsDue = (event, state) => {
    /* Запасной срок: фура «в пути» обязана приехать и тому, кто решил её
       просто подождать, а не только тому, кто грузит другие заявки. */
    if (typeof event.orAtSecond === 'number' && (state.elapsedSeconds || 0) >= event.orAtSecond) return true;
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
      /* Пустая паллета нацелена на следующую заявку сразу после погрузки.
         Событие эту очередь меняет: выросшая заявка возвращается вперёд,
         отменённая исчезает. Без перенацеливания задание называло один
         даркстор, а паллета была адресована другому, и собранное на неё
         не засчитывалось. Начатую паллету не трогаем — её собирает игрок. */
      if ((next.pallet?.weight || 0) === 0 && !queueActive(next)) {
        const target = activeOrderFor(next);
        if (target) next = { ...next, pallet: palletFor(next, { storeId: target.storeId, zone: target.zone }) };
      }
      next = { ...next, appliedEventIndexes: [...(next.appliedEventIndexes || []), index], feedback: eventFeedback(event, next) };
      next = markUrgent(state, next, event);
    }
    return next;
  }

  function tick(state, seconds = 1) {
    if (state.paused) return state;
    const requestedSeconds = Math.max(0, Number(seconds) || 0);
    const consumedSeconds = Math.min(requestedSeconds, state.secondsRemaining || 0);
    const elapsedSeconds = (state.elapsedSeconds || 0) + consumedSeconds;
    const next = { ...state, secondsRemaining: Math.max(0, (state.secondsRemaining || 0) - consumedSeconds), elapsedSeconds };
    return syncQueue(applyDepartures(applyScheduledEvents(next)));
  }

  /* Фургон уходит в рейс по часам смены. С этой секунды в него нельзя
     грузить, из него нельзя снять паллету и порядок его остановок уже не
     поменять: что успели — уехало, что не успели — осталось. Это и делает
     порядок заданий решением: пока уйти не мог ни один фургон, собирать
     заявки можно было в любой последовательности. */
  function applyDepartures(state) {
    const leaving = (state.vehicles || []).filter((vehicle) => typeof vehicle.departsAt === 'number'
      && !vehicle.departed && (state.elapsedSeconds || 0) >= vehicle.departsAt);
    if (!leaving.length) return state;
    const ids = new Set(leaving.map((vehicle) => vehicle.id));
    const first = leaving[0];
    const empty = (first.pallets || []).length === 0;
    return withFeedback({
      ...state,
      vehicles: state.vehicles.map((vehicle) => (ids.has(vehicle.id) ? { ...vehicle, departed: true } : vehicle)),
      tsd: { ...state.tsd, signal: 'new' },
    }, feedback('info', 'vehicle-departed', `«${vehicleLabel(state, first)}» ушёл в рейс${empty ? ' пустым' : ''}.`));
  }

  const departedGuard = (state, vehicleId) => {
    const vehicle = (state.vehicles || []).find((entry) => entry.id === vehicleId);
    return vehicle?.departed === true
      ? withFeedback(state, feedback('error', 'vehicle-departed', `«${vehicleLabel(state, vehicle)}» уже в рейсе: его груз и маршрут не изменить.`))
      : null;
  };

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
      // В отчёт — названия машин, а не их идентификаторы.
      vehiclesWithoutRoute: missingRouteVehicles(state)
        .map((vehicleId) => vehicleLabel(state, (state.vehicles || []).find((vehicle) => vehicle.id === vehicleId))),
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

  /* ---- Очередь заданий ТСД ----
     На сменах без поводыря работу выдаёт терминал: одно задание за раз.
     Выбирать заявку с доски нельзя — в жизни кладовщик заявки не выбирает,
     они приходят на ТСД. Порядок строит сам терминал: первым идёт то, чей
     фургон уходит раньше, затем срочное, затем остальное в порядке
     поступления. У игрока одно решение об очереди — взять ли срочное
     задание, бросив начатую паллету.

     Раньше задание можно было отложить (три раза за смену), а заявку
     уходящего фургона терминал нарочно ставил последней. На практике было
     неясно, когда откладывать, и кнопку убрали вместе с этой ловушкой.

     Задания не хранятся — они выводятся из состояния смены: открытая заявка
     — «собрать», паллета у ворот — «принять», паллета отменённой заявки в
     кузове — «снять». Хранится только то, что решил игрок: какое задание
     принято, и какие пришли срочными посреди смены. */
  const guidedFor = (state) => levelFor(state.levelId)?.guided !== false;
  const queueActive = (state) => !guidedFor(state) && state.phase === 'shift';
  const isDeparted = (vehicle) => vehicle?.departed === true;

  function openTasksFor(state) {
    const tasks = [];
    (state.inbound || []).forEach((pallet, index) => {
      if (pallet.status !== 'arrived' && pallet.status !== 'received') return;
      tasks.push({ id: `receive:${pallet.id}`, kind: 'receive', inboundId: pallet.id, base: index, blocked: null });
    });
    const seenUnload = new Set();
    for (const orphan of orphanPalletsFor(state)) {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === orphan.vehicleId);
      // Из уехавшего фургона паллету уже не снять — такого задания нет.
      if (isDeparted(vehicle)) continue;
      const id = `unload:${orphan.vehicleId}:${orphan.pallet.storeId}`;
      if (seenUnload.has(id)) continue;
      seenUnload.add(id);
      tasks.push({ id, kind: 'unload', vehicleId: orphan.vehicleId, storeId: orphan.pallet.storeId, base: 500 + tasks.length, blocked: null });
    }
    /* Заявка даркстора — это всё, что он заказал из одной зоны: несколько
       строк товара едут одной паллетой и приходят одним заданием. Раньше
       каждая строка была отдельным заданием, и класть на паллету второй
       товар было незачем. Имя задания держится за первую строку группы,
       даже когда она уже собрана: иначе задание меняло бы имя посреди
       работы. */
    const seenGroups = new Set();
    (state.orders || []).forEach((anchor, index) => {
      if (anchor.cancelled) return;
      const groupKey = `${anchor.storeId}:${anchor.zone}`;
      if (seenGroups.has(groupKey)) return;
      seenGroups.add(groupKey);
      const lines = (state.orders || []).filter((order) => !order.cancelled && order.storeId === anchor.storeId
        && order.zone === anchor.zone && remainingFor(state, order) > 0);
      if (!lines.length) return;
      const fleet = (state.vehicles || []).filter((vehicle) => vehicle.zone === anchor.zone && !isDeparted(vehicle));
      // Все фургоны зоны уехали: заявку уже не выполнить, заданием она быть перестаёт.
      if (fleet.length === 0) return;
      const inStock = lines.filter((order) => engine.availableStock(state.stock, order.zone, order.sku) > 0);
      const lightest = Math.min(...(inStock.length ? inStock : lines).map((order) => engine.itemBySku(order.sku)?.weightPerUnit || 0));
      const blocked = inStock.length === 0 ? 'no-stock'
        : vehicleForPallet(state, { zone: anchor.zone, weight: lightest }).vehicle ? null : 'no-vehicle';
      tasks.push({
        /* В задание входят только строки, чей товар уже стоит в зоне. Строку,
           которая ещё едет, терминал не называет: она пришла бы вместе с
           зоной хранения и выдала бы, куда ставить паллету с приёмки. */
        id: `pick:${anchor.id}`, kind: 'pick', orderId: anchor.id, orderIds: (inStock.length ? inStock : lines).map((order) => order.id),
        storeId: anchor.storeId, zone: anchor.zone, base: 100 + index, blocked,
      });
    });
    return tasks;
  }

  /* Порядок очереди: принятое задание; затем задания со сроком — раньше то,
     чей фургон уходит раньше; затем срочные в порядке прихода; затем
     обычные в порядке поступления. Задание, которое сейчас выполнить нельзя
     (товар в пути, фургон в рейсе), уходит в хвост само: терминал не
     предлагает работу, которую нечем сделать. */
  function taskQueueFor(state) {
    const urgent = state.urgentTaskIds || [];
    const rank = (task) => {
      if (task.id === state.activeTaskId) return [0, 0];
      const deadline = taskDeadlineFor(state, task);
      if (typeof deadline === 'number') return [1, deadline * 1000 + task.base];
      if (urgent.includes(task.id)) return [2, urgent.indexOf(task.id)];
      return [3, task.base];
    };
    return openTasksFor(state)
      .map((task) => ({ ...task, urgent: urgent.includes(task.id), active: task.id === state.activeTaskId }))
      .sort((left, right) => {
        const blockedLeft = left.blocked && !left.active ? 1 : 0;
        const blockedRight = right.blocked && !right.active ? 1 : 0;
        if (blockedLeft !== blockedRight) return blockedLeft - blockedRight;
        const [groupLeft, orderLeft] = rank(left);
        const [groupRight, orderRight] = rank(right);
        return groupLeft - groupRight || orderLeft - orderRight;
      });
  }

  /* Срок задания: когда уйдёт последний фургон, который ещё может его
     увезти. Для «снять паллету» — когда уйдёт сам фургон. null — срока нет. */
  function taskDeadlineFor(state, task) {
    if (task.kind === 'unload') {
      return (state.vehicles || []).find((vehicle) => vehicle.id === task.vehicleId)?.departsAt ?? null;
    }
    const zoneOf = task.kind === 'pick'
      ? (state.orders || []).find((order) => order.id === task.orderId)?.zone
      : (state.inbound || []).find((pallet) => pallet.id === task.inboundId)?.zone;
    const fleet = (state.vehicles || []).filter((vehicle) => vehicle.zone === zoneOf && !isDeparted(vehicle));
    if (!fleet.length || fleet.some((vehicle) => typeof vehicle.departsAt !== 'number')) return null;
    return Math.max(...fleet.map((vehicle) => vehicle.departsAt));
  }

  const currentTaskFor = (state) => taskQueueFor(state).find((task) => task.active) || null;
  // Следующее задание — первое выполнимое, кроме уже принятого.
  const nextTaskFor = (state) => taskQueueFor(state).find((task) => !task.active && !task.blocked) || null;

  /* После любого действия очередь приводится к состоянию смены: закрытое
     задание перестаёт быть принятым, а пустая паллета принятой заявки
     остаётся адресованной ей — заявка тяжелее паллеты собирается в два
     захода, и между ними адрес теряться не должен. */
  function syncQueue(state) {
    if (!queueActive(state)) return state;
    const open = new Set(openTasksFor(state).map((task) => task.id));
    let next = state;
    const keep = (list) => (list || []).filter((id) => open.has(id));
    const urgentTaskIds = keep(state.urgentTaskIds);
    if (urgentTaskIds.length !== (state.urgentTaskIds || []).length) next = { ...next, urgentTaskIds };
    /* Принятая заявка, остаток которой ждёт поставки: собрать больше нечего,
       и держать её в работе значило бы запереть терминал. Она возвращается
       в очередь и придёт снова, когда товар встанет в зону. */
    const stalled = openTasksFor(next).find((task) => task.id === next.activeTaskId && task.kind === 'pick' && task.blocked);
    if (stalled && (next.pallet?.weight || 0) === 0) {
      next = { ...next, activeTaskId: null, tsd: { ...next.tsd, acceptedOrderId: null, signal: 'new' } };
    }
    if (next.activeTaskId && !open.has(next.activeTaskId)) {
      // Задание выполнено: терминал свободен и зовёт к следующему.
      next = { ...next, activeTaskId: null, tsd: { ...next.tsd, acceptedOrderId: null, signal: 'new' } };
    }
    const active = String(next.activeTaskId || '');
    if (active.startsWith('pick:') && (next.pallet?.weight || 0) === 0) {
      const order = (next.orders || []).find((entry) => entry.id === active.slice('pick:'.length));
      if (order && (next.pallet.storeId !== order.storeId || next.pallet.zone !== order.zone)) {
        next = { ...next, pallet: palletFor(next, { storeId: order.storeId, zone: order.zone }) };
      }
    }
    return next;
  }

  // Вернуть на полку то, что уже лежит на паллете: задание бросают целиком.
  function abandonPallet(state) {
    const items = state.pallet?.items || [];
    if (!items.length) return state;
    const stock = items.reduce((total, item) => engine.addToStock(total, item.zone, item.sku, item.quantity), state.stock);
    return { ...state, stock, pallet: palletFor(state) };
  }

  function activateTask(state, task) {
    let next = { ...state, activeTaskId: task.id, tsd: { ...state.tsd, open: false, screen: 'current', signal: 'idle', dismissedTaskId: null } };
    if (task.kind === 'pick') {
      const order = state.orders.find((entry) => entry.id === task.orderId);
      const ready = (state.vehicles || []).find((vehicle) => vehicle.zone === order.zone && vehicle.ready !== false && !isDeparted(vehicle));
      next = {
        ...abandonPallet(next),
        tsd: { ...next.tsd, acceptedOrderId: order.id },
        selectedVehicleId: ready?.id || next.selectedVehicleId,
      };
      next = { ...next, pallet: palletFor(next, { storeId: order.storeId, zone: order.zone }) };
    }
    if (task.kind === 'unload') next = { ...next, selectedVehicleId: task.vehicleId, routeStops: [...routeStopsFor(next, task.vehicleId)] };
    return next;
  }

  function reduceQueueAction(state, action) {
    const current = currentTaskFor(state);
    const offered = nextTaskFor(state);

    if (action.type === 'ACCEPT_TASK') {
      if (current || !offered) return state;
      // Принять поставку — это и есть «принять паллету»: отдельного нажатия нет.
      if (offered.kind === 'receive') return reduceCore(activateTask(state, offered), { type: 'RECEIVE_PALLET' });
      return activateTask(state, offered);
    }

    if (action.type === 'RECEIVE_PALLET' && !current) {
      const queue = taskQueueFor(state);
      const task = offered?.kind === 'receive' ? offered : queue.find((entry) => entry.kind === 'receive');
      return task ? reduceCore(activateTask(state, task), action) : reduceCore(state, action);
    }

    /* Срочное задание поверх начатого: начатое бросают, и собранное на
       паллету возвращается на полку. Принятую и уже снятую с фуры паллету
       бросить нельзя — она стоит на тележке посреди склада. */
    if (action.type === 'TAKE_URGENT') {
      if (!current || !offered?.urgent) return state;
      if (current.kind === 'receive' && (state.inbound || []).some((pallet) => pallet.id === current.inboundId && pallet.status === 'received')) {
        return withFeedback(state, feedback('info', 'placing-first', 'Сначала поставьте принятую паллету в зону.'));
      }
      const dropped = abandonPallet({ ...state, activeTaskId: null });
      return offered.kind === 'receive'
        ? reduceCore(activateTask(dropped, offered), { type: 'RECEIVE_PALLET' })
        : activateTask(dropped, offered);
    }

    return null;
  }

  /* Срочными становятся задания, которые родило событие посреди смены:
     приехавшая фура, дозаказ, отмена. Они встают в голову очереди. */
  function markUrgent(before, after, event) {
    if (!queueActive(after)) return after;
    const had = new Set(openTasksFor(before).map((task) => task.id));
    const born = openTasksFor(after).map((task) => task.id).filter((id) => !had.has(id));
    // Дозаказ по ещё открытой заявке нового задания не рождает, но срочным его делает.
    if (event.type === 'demand-increase') {
      const grown = openTasksFor(after).find((task) => task.kind === 'pick' && task.orderIds.includes(event.orderId));
      if (grown && !born.includes(grown.id)) born.push(grown.id);
    }
    const fresh = born.filter((id) => !(after.urgentTaskIds || []).includes(id) && id !== after.activeTaskId);
    if (!fresh.length) return after;
    return {
      ...after,
      urgentTaskIds: [...(after.urgentTaskIds || []), ...fresh],
      tsd: { ...after.tsd, signal: 'new', dismissedTaskId: null },
    };
  }

  function reduceAction(state, action) {
    if (queueActive(state)) {
      const handled = reduceQueueAction(state, action);
      if (handled) return syncQueue(handled);
    }
    return syncQueue(reduceCore(state, action));
  }

  function reduceCore(state, action) {
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
      }, feedback('info', 'pallet-received', 'Паллета принята. Выберите зону на схеме — нажмите вывеску.'));
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
          /* Причину для отчёта пишем здесь, словами игрока: движок знает
             только идентификаторы зон, и в отчёт уезжало «из зоны chilled
             убрали в зону frozen». */
          spoilageReasons: [...(state.spoilageReasons || []), {
            ...result.spoilageReason,
            message: `Испорчена паллета «${engine.itemBySku(pending.sku)?.name || pending.sku}»: её зона — «${zoneLabel(pending.zone)}», а поставили в «${zoneLabel(action.zone)}»`,
          }],
        }, feedback('error', 'wrong-placement', `Не та зона: паллета «${engine.itemBySku(pending.sku)?.name || pending.sku}» испорчена.`));
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
      const gone = departedGuard(state, vehicleId);
      if (gone) return gone;
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
        // Фура, которая ещё не приехала: товара нет не по вине игрока.
        const onTheWay = (state.scheduledEvents || []).some((event, index) => event.type === 'pallet-arrived'
          && event.pallet?.sku === item.sku && !(state.appliedEventIndexes || []).includes(index));
        const message = onDock
          ? 'В зоне не осталось товара — сначала примите и разместите поставку.'
          : onTheWay
            ? 'Этого товара на складе ещё нет — фура в пути. Займитесь пока другой заявкой.'
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
          'vehicle-not-ready': `В готовые фургоны зоны «${zoneName}» эта паллета не влезает, а ещё один в рейсе. Он вернётся позже — займитесь пока другой заявкой.`,
          'no-vehicle': `Для зоны «${zoneName}» в смене нет фургона.`,
          'vehicle-departed': `Фургон зоны «${zoneName}» уже ушёл в рейс — эту паллету не на чем увезти.`,
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
      const gone = departedGuard(state, vehicle.id);
      if (gone) return gone;
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
      const gone = departedGuard(state, vehicle.id);
      if (gone) return gone;
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
    vehicleForPallet, vehicleLabel, roomIn, orphanPalletsFor,
    taskQueueFor, currentTaskFor, nextTaskFor, taskDeadlineFor, guidedFor,
  };
});

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const api = factory(levelData, engine);
  if (isNode) module.exports = api;
  else root.RyabinovayaSceneView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levelData, engine) {
  const ZONE_NAMES = levelData.ZONE_NAMES;
  const STORE_NAMES = levelData.STORE_NAMES;
  const ZONE_MARKS = levelData.ZONE_MARKS;

  /* Маршрут заслуживает внимания игрока только пока его можно сократить.
     Раньше ворота отгрузки мигали всю смену подряд — с первой погруженной
     паллеты и до конца, — хотя нажимать туда было незачем. */
  const routeCanBeShortened = (state) => (state.vehicles || []).some((vehicle) => {
    const stops = state.routeStopsByVehicle?.[vehicle.id] || [];
    if (stops.length < 2) return false;
    return engine.buildRoute(null, stops).minutes > engine.bestRoute(stops).minutes;
  });

  const loadedQuantityFor = (state, order) => (state.loadedPallets || [])
    .filter((pallet) => pallet.storeId === order.storeId && pallet.zone === order.zone)
    .reduce((total, pallet) => total + (pallet.items || [])
      .filter((item) => item.sku === order.sku)
      .reduce((sum, item) => sum + item.quantity, 0), 0);

  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => order.quantity - loadedQuantityFor(state, order) > 0) || null;
  };

  const pendingInboundFor = (state) => (state.inbound || [])
    .find((pallet) => pallet.status === 'arrived' || pallet.status === 'received') || null;

  /* Цель по сборке обязана быть видна, не открывая ничего: сколько ещё
     штук класть на паллету. Раньше это число висело на полосе закрытого
     ТСД, а когда полосу убрали, единственным постоянным указателем осталась
     заливка паллеты в процентах — вес, а не задание. Считаем от остатка
     заявки за вычетом того, что уже лежит на текущей паллете. */
  const palletGoalFor = (state) => {
    if (pendingInboundFor(state)) return '';
    const order = activeOrderFor(state);
    if (!order) return '';
    const onPallet = (state.pallet?.items || [])
      .filter((item) => item.sku === order.sku)
      .reduce((total, item) => total + item.quantity, 0);
    const left = Math.max(0, order.quantity - loadedQuantityFor(state, order) - onPallet);
    // Ноль — это не «нечего делать», а «пора грузить», и так и написано.
    return left ? `ещё ${left} шт.` : 'готова';
  };

  const capacityTargetFor = (state) => {
    const message = String(state.feedback?.message || '');
    if (/паллета/i.test(message)) return 'pallet';
    if (/машин/i.test(message)) return 'truck';
    return 'truck';
  };

  /* Ровно один ответ на вопрос «что сейчас делать». Раньше подсветка на
     схеме включалась по уже сделанному действию: паллета загоралась, когда на
     ней появлялся вес, ворота — на секунду после погрузки. В стартовом
     состоянии, где игрок как раз не знает, куда нажать, не горело ничего.
     Здесь шаг считается от задачи, а не от прошлого жеста, и у него всегда
     есть кнопка, которая его выполняет — даже если объект на схеме не нашли. */
  function nextStepFor(state) {
    if (state.phase !== 'shift') return null;
    const inbound = pendingInboundFor(state);
    if (inbound) {
      const item = engine.itemBySku(inbound.sku);
      const zoneName = ZONE_NAMES[inbound.zone] || inbound.zone;
      if (inbound.status === 'arrived') {
        return {
          key: 'receive',
          title: 'Примите поставку',
          detail: `${inbound.supplier}: ${item?.name || inbound.sku} · ${inbound.quantity} шт. → зона «${zoneName}»`,
          actionLabel: 'Открыть накладную',
          action: 'OPEN_TSD',
          focus: 'dock',
        };
      }
      return {
        key: 'place',
        title: `Разместите паллету в зоне «${zoneName}»`,
        detail: `Нажмите вывеску ${ZONE_MARKS[inbound.zone] || ''} на схеме — другая зона испортит товар`.replace('  ', ' '),
        actionLabel: `В зону «${zoneName}»`,
        action: 'SELECT_ZONE',
        zone: inbound.zone,
        focus: 'zone',
      };
    }
    const order = activeOrderFor(state);
    if (order) {
      const item = engine.itemBySku(order.sku);
      const storeName = STORE_NAMES[order.storeId] || order.storeId;
      const zoneName = ZONE_NAMES[order.zone] || order.zone;
      const onPallet = (state.pallet?.items || [])
        .filter((entry) => entry.sku === order.sku)
        .reduce((total, entry) => total + entry.quantity, 0);
      const left = Math.max(0, order.quantity - loadedQuantityFor(state, order) - onPallet);
      if (left > 0) {
        return {
          key: 'collect',
          title: onPallet ? `Доберите паллету для ${storeName}` : `Соберите паллету для ${storeName}`,
          detail: `${item?.name || order.sku} · ещё ${left} шт. · зона «${zoneName}»`,
          actionLabel: onPallet ? 'Продолжить сборку' : 'Собрать паллету',
          action: 'OPEN_BUILDER',
          focus: 'pallet',
        };
      }
      return {
        key: 'load',
        title: 'Паллета готова — погрузите её',
        detail: `${state.pallet?.weight || 0} кг → фургон зоны «${zoneName}», адрес ${storeName}`,
        actionLabel: 'Погрузить в фургон',
        action: 'LOAD_PALLET',
        focus: 'pallet',
      };
    }
    if ((state.pallet?.weight || 0) > 0) {
      return {
        key: 'load',
        title: 'Паллета готова — погрузите её',
        detail: `${state.pallet.weight} кг → фургон зоны «${ZONE_NAMES[state.pallet.zone] || state.pallet.zone}»`,
        actionLabel: 'Погрузить в фургон',
        action: 'LOAD_PALLET',
        focus: 'pallet',
      };
    }
    if (routeCanBeShortened(state)) {
      return {
        key: 'route',
        title: 'Маршрут можно сократить',
        detail: 'Переставьте остановки так, чтобы рейс стал короче',
        actionLabel: 'Открыть маршрут',
        action: 'OPEN_VEHICLES',
        focus: 'truck',
      };
    }
    return {
      key: 'finish',
      title: 'Все заявки собраны',
      detail: 'Фургоны уедут по окончании смены — можно закрыть её сейчас',
      actionLabel: 'Завершить смену',
      action: 'END_SHIFT',
      focus: 'finish',
    };
  }

  function warehouseViewFor(state) {
    const order = activeOrderFor(state);
    const inbound = pendingInboundFor(state);
    const awaitingPlacement = Boolean(inbound && inbound.status === 'received');
    const selectedVehicle = (state.vehicles || []).find((vehicle) => vehicle.id === state.selectedVehicleId) || state.vehicles?.[0] || null;
    const route = state.routesByVehicle?.[selectedVehicle?.id] || null;
    const routeReady = Boolean(route?.stops?.length);
    const code = state.feedback?.code;
    let mode = 'idle';

    if (code === 'wrong-placement') mode = 'spoiled';
    else if (code === 'over-capacity' || code === 'fleet-full') mode = 'blocked';
    else if (awaitingPlacement) mode = 'placing';
    else if (inbound) mode = 'receiving';
    else if (code === 'pallet-loaded') mode = 'to-dispatch';
    /* Начатая паллета важнее уже уехавших: пока игрок её собирает, подсвечивать
       нужно её, а не ворота. Раньше route-ready перебивал сборку и внимание
       уводило на транспорт. */
    else if ((state.pallet?.weight || 0) > 0) mode = 'collecting';
    else if (routeReady) mode = 'route-ready';

    const statusByMode = {
      idle: order ? `Зона ${ZONE_NAMES[order.zone] || order.zone}: можно начинать сборку.` : 'Все заявки собраны. Проверьте транспорт.',
      receiving: 'На приёмке стоит паллета — примите её в ТСД.',
      placing: inbound ? `Отвезите паллету в зону «${ZONE_NAMES[inbound.zone] || inbound.zone}».` : '',
      collecting: 'Тележка готовит текущую паллету.',
      'to-dispatch': state.feedback?.message || 'Тележка везёт паллету к воротам.',
      // Не «готова к отправке»: отправлять её вручную не нужно и нечем.
      'route-ready': 'Маршрут построен — машина уедет по окончании смены.',
      spoiled: state.feedback?.message || 'Паллета испорчена из-за неверной зоны.',
      blocked: state.feedback?.message || 'Не хватает свободного места.',
    };

    const nextStep = nextStepFor(state);

    return {
      nextStep,
      focus: nextStep?.focus || '',
      /* Во время размещения подсвечивается зона из накладной, а не зона
         заявки: игрок должен попасть именно в неё. */
      placementZone: awaitingPlacement ? inbound.zone : null,
      inboundCount: (state.inbound || []).filter((pallet) => pallet.status === 'arrived' || pallet.status === 'received').length,
      // Подсвечивать зону имеет смысл только там, где есть из чего выбирать.
      // На уровнях с одной открытой зоной подсказка повторяет ТСД и схему.
      // Исключение — размещение: там зона и есть само задание.
      activeZone: awaitingPlacement
        ? inbound.zone
        : (state.unlockedZones || []).length > 1
          ? (order?.zone || state.pallet?.zone || 'dry')
          : null,
      selectedZone: state.pallet?.zone || 'dry',
      selectedVehicleZone: selectedVehicle?.zone || null,
      highlightObject: code === 'wrong-placement' ? 'pallet'
        : code === 'fleet-full' ? 'truck'
          : code === 'over-capacity' ? capacityTargetFor(state)
            : code === 'demand-increase' ? 'zone' : '',
      mode,
      palletFillPercent: Math.min(100, Math.round(((state.pallet?.weight || 0) / (state.pallet?.capacity || 100)) * 100)),
      palletGoalText: palletGoalFor(state),
      loadedPalletCount: (state.loadedPallets || []).length,
      routeReady,
      routeCanBeShortened: routeCanBeShortened(state),
      eventCode: ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(code) ? code : '',
      statusText: statusByMode[mode],
      operatorName: ['spoiled', 'blocked'].includes(mode) ? 'Лера' : 'Миша',
    };
  }

  return { warehouseViewFor, nextStepFor };
});

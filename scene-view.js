(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const api = factory(levelData, engine);
  if (isNode) module.exports = api;
  else root.RyabinovayaSceneView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levelData, engine) {
  const ZONE_NAMES = levelData.ZONE_NAMES;

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

  const capacityTargetFor = (state) => {
    const message = String(state.feedback?.message || '');
    if (/паллета/i.test(message)) return 'pallet';
    if (/машин/i.test(message)) return 'truck';
    return 'truck';
  };

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

    return {
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
      loadedPalletCount: (state.loadedPallets || []).length,
      routeReady,
      routeCanBeShortened: routeCanBeShortened(state),
      eventCode: ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(code) ? code : '',
      statusText: statusByMode[mode],
      operatorName: ['spoiled', 'blocked'].includes(mode) ? 'Лера' : 'Миша',
    };
  }

  return { warehouseViewFor };
});

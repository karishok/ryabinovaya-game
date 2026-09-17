(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const api = factory(levelData);
  if (isNode) module.exports = api;
  else root.RyabinovayaSceneView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levelData) {
  const ZONE_NAMES = levelData.ZONE_NAMES;

  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => !(state.loadedPallets || []).some((pallet) => pallet.storeId === order.storeId)) || active[0] || null;
  };

  function warehouseViewFor(state) {
    const order = activeOrderFor(state);
    const selectedVehicle = (state.vehicles || []).find((vehicle) => vehicle.id === state.selectedVehicleId) || state.vehicles?.[0] || null;
    const route = state.routesByVehicle?.[selectedVehicle?.id] || null;
    const hasLoadedVehicle = Boolean(selectedVehicle?.pallets?.length);
    const routeReady = Boolean(route?.stops?.length);
    const code = state.feedback?.code;
    let mode = 'idle';

    if (code === 'wrong-zone') mode = 'spoiled';
    else if (code === 'over-capacity') mode = 'blocked';
    else if (code === 'pallet-loaded') mode = 'to-dispatch';
    else if (hasLoadedVehicle && !routeReady) mode = 'awaiting-route';
    else if (routeReady) mode = 'route-ready';
    else if ((state.pallet?.weight || 0) > 0) mode = 'collecting';

    const statusByMode = {
      idle: order ? `Зона ${ZONE_NAMES[order.zone] || order.zone}: можно начинать сборку.` : 'Все заявки собраны. Проверьте транспорт.',
      collecting: 'Тележка готовит текущую паллету.',
      'to-dispatch': state.feedback?.message || 'Тележка везёт паллету к воротам.',
      'awaiting-route': 'Машина загружена и ждёт маршрут.',
      'route-ready': 'Маршрут построен, машина готова к отправке.',
      spoiled: state.feedback?.message || 'Паллета испорчена из-за неверной зоны.',
      blocked: state.feedback?.message || 'Не хватает свободного места.',
    };

    return {
      activeZone: order?.zone || state.pallet?.zone || 'dry',
      selectedZone: state.pallet?.zone || 'dry',
      selectedVehicleZone: selectedVehicle?.zone || null,
      highlightObject: code === 'wrong-zone' ? 'pallet' : code === 'over-capacity' ? 'truck' : code === 'demand-increase' ? 'zone' : '',
      mode,
      palletFillPercent: Math.min(100, Math.round(((state.pallet?.weight || 0) / (state.pallet?.capacity || 100)) * 100)),
      loadedPalletCount: (state.loadedPallets || []).length,
      routeReady,
      eventCode: ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(code) ? code : '',
      statusText: statusByMode[mode],
      operatorName: ['spoiled', 'blocked'].includes(mode) ? 'Лера' : 'Миша',
    };
  }

  return { warehouseViewFor };
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ZONES = Object.freeze({ DRY: 'dry', FROZEN: 'frozen', CHILLED: 'chilled' });

  const ITEMS = Object.freeze({
    WATER: Object.freeze({ sku: 'water', zone: ZONES.DRY, weightPerUnit: 12 }),
    MILK: Object.freeze({ sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10 }),
    BANANA: Object.freeze({ sku: 'banana', zone: ZONES.CHILLED, weightPerUnit: 8 }),
    BREAD: Object.freeze({ sku: 'bread', zone: ZONES.DRY, weightPerUnit: 6 }),
  });

  function createPallet({ storeId, zone }) {
    return { storeId, zone, items: [], weight: 0, capacity: 100 };
  }

  function addItemToPallet(pallet, item, quantity) {
    if (item.zone !== pallet.zone) return { ok: false, reason: 'wrong-zone' };

    const addedWeight = item.weightPerUnit * quantity;
    if (pallet.weight + addedWeight > pallet.capacity) {
      return { ok: false, reason: 'over-capacity' };
    }

    const nextItem = { ...item, quantity };
    const nextPallet = { ...pallet, items: [...pallet.items, nextItem] };
    nextPallet.weight = pallet.weight + addedWeight;
    return { ok: true, pallet: nextPallet };
  }

  function createVehicle({ id, zone, capacity = 100 }) {
    return { id, zone, capacity, pallets: [] };
  }

  function loadPallet(vehicle, pallet) {
    if (pallet.zone !== vehicle.zone) return { ok: false, reason: 'wrong-zone' };

    const loadedWeight = vehicle.pallets.reduce((total, loadedPallet) => total + loadedPallet.weight, 0);
    if (loadedWeight + pallet.weight > vehicle.capacity) {
      return { ok: false, reason: 'over-capacity' };
    }

    return { ok: true, vehicle: { ...vehicle, pallets: [...vehicle.pallets, pallet] } };
  }

  function buildRoute(vehicle, stops) {
    const routeStops = [...stops];
    const minutes = routeStops.length * 15;
    const distanceScore = Math.max(0, 100 - Math.max(0, routeStops.length - 1) * 15);
    return { stops: routeStops, minutes, distanceScore };
  }

  function scoreShift({ deliveredPercent, onTimePercent, utilizationPercent, spoiledPallets, routePenalty }) {
    const reasons = [];
    if (spoiledPallets > 0) reasons.push(`паллета испорчена: ${spoiledPallets}`);
    if (deliveredPercent < 90) reasons.push('Не все заявки доставлены');
    if (onTimePercent < 90) reasons.push('Опоздали из-за длинного маршрута');
    if (utilizationPercent < 80) reasons.push('Потеряли прибыль из-за недогруженной машины');
    if (routePenalty > 0) reasons.push('Маршрут оказался неэффективным');

    const stars = deliveredPercent >= 90 && onTimePercent >= 90 && utilizationPercent >= 80 && spoiledPallets === 0 && routePenalty <= 10
      ? 3
      : deliveredPercent >= 70 && onTimePercent >= 60
        ? 2
        : 1;
    const profit = Math.round(
      deliveredPercent * 100 + onTimePercent * 40 + utilizationPercent * 30 - spoiledPallets * 500 - routePenalty * 20,
    );
    return { stars, profit, reasons };
  }

  return {
    ZONES,
    ITEMS,
    createPallet,
    addItemToPallet,
    createVehicle,
    loadPallet,
    buildRoute,
    scoreShift,
  };
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ZONES = Object.freeze({ DRY: 'dry', FROZEN: 'frozen', CHILLED: 'chilled' });

  const ITEMS = Object.freeze({
    WATER: Object.freeze({ sku: 'water', zone: ZONES.DRY, weightPerUnit: 12, price: 1500, name: 'Вода 1,5 л' }),
    MILK: Object.freeze({ sku: 'milk', zone: ZONES.CHILLED, weightPerUnit: 10, price: 1400, name: 'Молоко' }),
    BANANA: Object.freeze({ sku: 'banana', zone: ZONES.CHILLED, weightPerUnit: 8, price: 1200, name: 'Бананы' }),
    BREAD: Object.freeze({ sku: 'bread', zone: ZONES.DRY, weightPerUnit: 6, price: 900, name: 'Хлеб' }),
    ICE_CREAM: Object.freeze({ sku: 'ice-cream', zone: ZONES.FROZEN, weightPerUnit: 9, price: 2200, name: 'Мороженое' }),
  });

  const ITEM_BY_SKU = Object.freeze(Object.fromEntries(Object.values(ITEMS).map((item) => [item.sku, item])));

  function itemBySku(sku) {
    return ITEM_BY_SKU[sku] || null;
  }

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

  /* Снять паллету с машины. Без этого набитый лишним кузов невозможно было
     разгрузить, и смена становилась непроходимой без единого действия,
     способного это исправить. */
  function unloadPallet(vehicle, palletIndex) {
    const pallets = vehicle.pallets || [];
    const pallet = pallets[palletIndex];
    if (!pallet) return { ok: false, reason: 'unknown-pallet' };
    return {
      ok: true,
      vehicle: { ...vehicle, pallets: pallets.filter((_, index) => index !== palletIndex) },
      pallet,
    };
  }

  /* Входящая паллета живёт на приёмке в три шага: приехала → принята в ТСД →
     размещена в зоне хранения. Зона у неё своя, и ошибка размещения портит
     товар по тому же правилу, что и погрузка в неподходящий фургон. */
  function createInboundPallet({ id, zone, sku, quantity, supplier }) {
    const item = itemBySku(sku);
    return {
      id,
      zone,
      sku,
      quantity,
      supplier: supplier || 'Поставщик',
      weight: (item?.weightPerUnit || 0) * quantity,
      status: 'arrived',
    };
  }

  function receiveInbound(pallet) {
    if (!pallet) return { ok: false, reason: 'unknown-pallet' };
    if (pallet.status !== 'arrived') return { ok: false, reason: 'already-received' };
    return { ok: true, pallet: { ...pallet, status: 'received' } };
  }

  function placeInbound(pallet, zone) {
    if (!pallet) return { ok: false, reason: 'unknown-pallet' };
    if (pallet.status !== 'received') return { ok: false, reason: 'not-received' };
    if (pallet.zone !== zone) {
      return {
        ok: false,
        reason: 'wrong-zone',
        pallet: { ...pallet, status: 'spoiled', placedZone: zone },
        spoilageReason: {
          type: 'wrong-placement',
          palletZone: pallet.zone,
          placedZone: zone,
          message: `паллета испорчена при размещении: товар из зоны ${pallet.zone} убрали в зону ${zone}`,
        },
      };
    }
    return { ok: true, pallet: { ...pallet, status: 'placed', placedZone: zone } };
  }

  /* Запас по зонам. Уровень без поля stock не ограничивает отбор — так
     старые смены остаются про отгрузку, а новые заставляют сначала принять
     поставку. */
  function stockFrom(stock) {
    if (!stock) return null;
    const result = {};
    for (const [zone, skus] of Object.entries(stock)) result[zone] = { ...skus };
    return result;
  }

  /* Уровень перечисляет только дефицит. Неупомянутый товар считается
     запасённым: иначе объявление нехватки в одной зоне молча обнуляло бы
     все остальные зоны смены. */
  function availableStock(stock, zone, sku) {
    if (!stock) return Infinity;
    const declared = stock[zone]?.[sku];
    return typeof declared === 'number' ? declared : Infinity;
  }

  function takeFromStock(stock, zone, sku, quantity) {
    const available = availableStock(stock, zone, sku);
    if (available < quantity) return { ok: false, reason: 'no-stock', available };
    if (!Number.isFinite(available)) return { ok: true, stock };
    return { ok: true, stock: { ...stock, [zone]: { ...stock[zone], [sku]: available - quantity } } };
  }

  function addToStock(stock, zone, sku, quantity) {
    const available = availableStock(stock, zone, sku);
    if (!Number.isFinite(available)) return stock;
    return { ...stock, [zone]: { ...(stock[zone] || {}), [sku]: available + quantity } };
  }

  /* Несовместимый фургон паллету не портит: в реальном центре её просто не
     примут в кузов. Товар гибнет там, где действительно простоял в чужой
     температуре — при размещении в неверную зону, см. placeInbound. */
  function loadPallet(vehicle, pallet) {
    if (pallet.zone !== vehicle.zone) return { ok: false, reason: 'wrong-zone' };

    const loadedWeight = vehicle.pallets.reduce((total, loadedPallet) => total + loadedPallet.weight, 0);
    if (loadedWeight + pallet.weight > vehicle.capacity) {
      return { ok: false, reason: 'over-capacity' };
    }

    const loadedPallet = { ...pallet, vehicleId: vehicle.id };
    return { ok: true, vehicle: { ...vehicle, pallets: [...vehicle.pallets, loadedPallet] }, pallet: loadedPallet };
  }

  /* Расположение депо и дарксторов. Интерфейс рисует по этим же числам
     карту, иначе игрок не может судить, какой порядок остановок короче. */
  const STORE_COORDINATES = Object.freeze({
    depot: [0, 0],
    north: [0, 3],
    central: [2, 0],
    west: [-3, 0],
    east: [4, 1],
  });

  function hashPoint(stop) {
    const text = String(stop);
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    const angle = (hash % 360) * (Math.PI / 180);
    const radius = 2 + (hash % 5);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }

  const pointFor = (stop) => STORE_COORDINATES[stop] || hashPoint(stop);

  function distanceBetween(from, to) {
    const [fromX, fromY] = pointFor(from);
    const [toX, toY] = pointFor(to);
    return Math.hypot(toX - fromX, toY - fromY);
  }

  /* Минуты одного плеча. Тот же коэффициент, что и в buildRoute, поэтому
     сумма плеч на карте совпадает с длительностью маршрута в отчёте. */
  const legMinutes = (from, to) => Math.max(0, Math.round(distanceBetween(from, to) * 5));

  function buildRoute(vehicle, stops) {
    const routeStops = [...stops];
    const totalDistance = routeStops.reduce((total, stop, index) => {
      const previous = index === 0 ? 'depot' : routeStops[index - 1];
      return total + distanceBetween(previous, stop);
    }, 0);
    const minutes = Math.max(0, Math.round(totalDistance * 5));
    const distanceScore = Math.max(0, Math.round(100 - totalDistance));
    return { stops: routeStops, minutes, distanceScore };
  }

  function permutations(values) {
    if (values.length <= 1) return [values];
    const result = [];
    values.forEach((value, index) => {
      const rest = [...values.slice(0, index), ...values.slice(index + 1)];
      for (const tail of permutations(rest)) result.push([value, ...tail]);
    });
    return result;
  }

  function bestRoute(stops) {
    const list = [...(stops || [])];
    if (list.length === 0) return { stops: [], minutes: 0 };
    if (list.length > 8) throw new RangeError(`Too many stops to optimize: ${list.length}`);
    let best = null;
    for (const candidate of permutations(list)) {
      const { minutes } = buildRoute(null, candidate);
      if (!best || minutes < best.minutes) best = { stops: candidate, minutes };
    }
    return best;
  }

  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, nested] of Object.entries(value)) result[key] = copy(nested);
      return result;
    }
    return value;
  }

  function createShiftState(level) {
    return {
      levelId: level.id,
      secondsRemaining: level.durationSeconds,
      orders: copy(level.initialOrders),
      pallets: [],
      vehicles: copy(level.vehicles),
      inbound: (level.inbound || []).map(createInboundPallet),
      stock: stockFrom(level.stock),
      events: [],
      metrics: {
        deliveredOrders: 0,
        cancelledOrders: 0,
        spoiledPallets: 0,
      },
    };
  }

  function advanceScenario(state, event) {
    const next = copy(state);
    next.events.push(copy(event));

    if (event.type === 'demand-increase') {
      next.orders = next.orders.map((order) => order.id === event.orderId
        ? { ...order, quantity: order.quantity + event.quantity }
        : order);
    } else if (event.type === 'vehicle-ready') {
      next.vehicles = next.vehicles.map((vehicle) => vehicle.id === event.vehicleId
        ? { ...vehicle, ready: true }
        : vehicle);
    } else if (event.type === 'store-reception-change') {
      next.orders = next.orders.map((order) => order.storeId === event.storeId
        ? { ...order, acceptsFromSecond: event.acceptsFromSecond }
        : order);
    } else if (event.type === 'pallet-arrived') {
      next.inbound = [...(next.inbound || []), createInboundPallet(event.pallet)];
    } else if (event.type === 'order-cancelled') {
      let cancelled = false;
      next.orders = next.orders.map((order) => {
        if (order.id !== event.orderId || order.cancelled) return order;
        cancelled = true;
        return { ...order, cancelled: true };
      });
      if (cancelled) next.metrics.cancelledOrders += 1;
    }

    return next;
  }

  return {
    ZONES,
    ITEMS,
    STORE_COORDINATES,
    legMinutes,
    createPallet,
    addItemToPallet,
    createVehicle,
    loadPallet,
    unloadPallet,
    createInboundPallet,
    receiveInbound,
    placeInbound,
    stockFrom,
    availableStock,
    takeFromStock,
    addToStock,
    buildRoute,
    bestRoute,
    itemBySku,
    createShiftState,
    advanceScenario,
  };
});

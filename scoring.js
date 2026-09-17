(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaScoring = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const percent = (part, whole) => Math.round((part / whole) * 100);

  function routeScore(route) {
    if (!route.stops || route.stops.length === 0) return 0;
    if (!route.minutes) return 100;
    return Math.min(100, Math.round((route.bestMinutes / route.minutes) * 100));
  }

  function metricsFor(outcome) {
    const demandQuantity = (outcome.demand || []).reduce((total, line) => total + line.quantity, 0);
    const deliveredQuantity = (outcome.delivered || []).reduce((total, line) => total + line.quantity, 0);
    const deliveredPercent = demandQuantity ? percent(deliveredQuantity, demandQuantity) : 100;

    const routes = outcome.routes || [];
    const onTimePercent = routes.length
      ? Math.round(routes.reduce((total, route) => total + routeScore(route), 0) / routes.length)
      : 0;

    const loadedWeight = outcome.loadedWeight || 0;
    const precisionPercent = loadedWeight ? percent(outcome.usefulWeight || 0, loadedWeight) : 100;

    return { deliveredPercent, onTimePercent, precisionPercent };
  }

  const RATES = Object.freeze({ perRouteMinute: 100, perLoadedKg: 10, spoiledPallet: 3000 });

  const isPerfect = (metrics, outcome) => metrics.deliveredPercent === 100
    && metrics.onTimePercent === 100
    && metrics.precisionPercent === 100
    && (outcome.spoiledPallets || 0) === 0
    && (outcome.inboundLeftOnDock || []).length === 0;

  function starsFor(metrics, outcome) {
    if (isPerfect(metrics, outcome)) return 3;
    return metrics.deliveredPercent >= 70 ? 2 : 1;
  }

  function profitFor(outcome) {
    const revenue = (outcome.delivered || []).reduce((total, line) => total + line.quantity * line.price, 0);
    const routeCost = (outcome.routes || []).reduce((total, route) => total + route.minutes * RATES.perRouteMinute, 0);
    const weightCost = (outcome.loadedWeight || 0) * RATES.perLoadedKg;
    const spoilCost = (outcome.spoiledPallets || 0) * RATES.spoiledPallet;
    return Math.round(revenue - routeCost - weightCost - spoilCost);
  }

  const routeLabel = (stops, storeNames) => stops.map((id) => storeNames[id] || id).join(' → ');

  // Assumes outcome.demand has at most one line per storeId:zone:sku — a duplicate key would
  // compare each line's shortfall against the same shared deliveredByKey total independently,
  // producing a wrong missing count. shiftOutcome() currently guarantees one line per order.
  function shortfallLines(outcome) {
    const deliveredByKey = new Map();
    for (const line of outcome.delivered || []) {
      const key = `${line.storeId}:${line.zone}:${line.sku}`;
      deliveredByKey.set(key, (deliveredByKey.get(key) || 0) + line.quantity);
    }
    return (outcome.demand || [])
      .map((line) => {
        const key = `${line.storeId}:${line.zone}:${line.sku}`;
        const missing = line.quantity - (deliveredByKey.get(key) || 0);
        return missing > 0 ? { ...line, quantity: missing } : null;
      })
      .filter(Boolean);
  }

  function reasonsFor(metrics, outcome) {
    if (isPerfect(metrics, outcome)) return ['Смена отработана идеально'];

    const reasons = [];
    const storeNames = outcome.storeNames || {};
    const routeless = outcome.vehiclesWithoutRoute || [];
    if (routeless.length > 0) {
      reasons.push(`Маршрут не построен: ${routeless.join(', ')} — их паллеты не засчитаны.`);
    }
    if ((outcome.spoiledPallets || 0) > 0) {
      reasons.push(...(outcome.spoilageReasons || []).map((entry) => entry.message));
    }
    const onDock = outcome.inboundLeftOnDock || [];
    if (onDock.length > 0) {
      reasons.push(`На приёмке осталось паллет: ${onDock.length} — ${onDock[0].itemName} так и не попал в зону «${onDock[0].zoneName}»`);
    }
    if (metrics.deliveredPercent < 100) {
      const shortfalls = shortfallLines(outcome);
      const missing = shortfalls.reduce((total, line) => total + line.quantity, 0);
      const demanded = (outcome.demand || []).reduce((total, line) => total + line.quantity, 0);
      const first = shortfalls[0];
      const detail = first ? ` — ${first.storeName} не получил: ${first.itemName}` : '';
      reasons.push(`Не доставлено: ${missing} из ${demanded} позиций${detail}`);
    }
    const routed = (outcome.routes || []).filter((route) => route.stops && route.stops.length > 0);
    if (metrics.onTimePercent < 100 && routed.length > 0) {
      const worst = routed.reduce((a, b) => (b.minutes - b.bestMinutes > a.minutes - a.bestMinutes ? b : a));
      const gap = worst.minutes - worst.bestMinutes;
      if (gap > 0) {
        reasons.push(`Маршрут на ${gap} минут длиннее оптимального: короче было ${routeLabel(worst.bestStops, storeNames)}`);
      }
    }
    if (metrics.precisionPercent < 100) {
      reasons.push(`Отправили ${(outcome.loadedWeight || 0) - (outcome.usefulWeight || 0)} кг сверх заявки`);
    }
    return reasons;
  }

  function scoreShift(outcome) {
    const metrics = metricsFor(outcome);
    return {
      metrics,
      stars: starsFor(metrics, outcome),
      profit: profitFor(outcome),
      reasons: reasonsFor(metrics, outcome),
    };
  }

  return { RATES, metricsFor, starsFor, profitFor, reasonsFor, scoreShift };
});

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
    && (outcome.spoiledPallets || 0) === 0;

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

  return { RATES, metricsFor, starsFor, profitFor };
});

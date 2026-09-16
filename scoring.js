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

  return { metricsFor };
});

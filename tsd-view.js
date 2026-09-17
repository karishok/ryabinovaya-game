(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const api = factory(engine, levelData);
  if (isNode) module.exports = api;
  else root.RyabinovayaTsdView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData) {
  const STORE_NAMES = levelData.STORE_NAMES;
  const ZONE_NAMES = levelData.ZONE_NAMES;

  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => !(state.loadedPallets || []).some((pallet) => pallet.storeId === order.storeId)) || active[0] || null;
  };

  const acceptedOrderFor = (state) => (state.orders || [])
    .find((order) => order.id === state.tsd?.acceptedOrderId && !order.cancelled)
    || null;

  function terminalViewFor(state) {
    const reportScreen = Boolean(state.report) || state.phase === 'report';
    const storyScreen = state.story?.kind === 'after' || state.phase === 'story-after';
    const errorScreen = state.feedback?.kind === 'error';
    const briefingScreen = state.phase === 'briefing' || state.tsd?.screen === 'briefing';
    const taskScreen = state.tsd?.screen === 'task';
    const screen = reportScreen
      ? 'report'
      : storyScreen
        ? 'briefing'
        : errorScreen
          ? 'feedback'
          : briefingScreen
            ? 'briefing'
            : taskScreen
              ? 'task'
              : 'current';

    const order = acceptedOrderFor(state) || activeOrderFor(state);
    const item = order ? engine.itemBySku(order.sku) : null;
    const progressText = `${state.pallet?.weight || 0} / ${state.pallet?.capacity || 100} кг`;
    const signal = state.feedback?.kind === 'error' ? 'error' : (state.tsd?.signal || 'idle');
    const titleByScreen = {
      report: 'Итоги смены',
      feedback: 'Ошибка',
      briefing: state.story?.kind === 'after' ? 'Смена завершена' : 'Новая смена',
      task: 'Новое задание',
      current: 'Текущая работа',
    };
    const messageByScreen = {
      report: state.report?.reasons?.[0] || 'Смена завершена.',
      feedback: state.feedback?.message || '',
      briefing: state.story?.text || '',
      task: state.feedback?.message || (order ? 'Проверьте заявку и примите её.' : 'Активных заявок нет.'),
      current: state.feedback?.message || '',
    };
    const reportSummary = state.report
      ? `Доставлено: ${state.report.deliveredPercent ?? 0}% · Вовремя: ${state.report.onTimePercent ?? 0}% · Точность: ${state.report.precisionPercent ?? 0}%`
      : '';
    const mandatoryOpen = ['feedback', 'briefing', 'report'].includes(screen);

    return {
      open: mandatoryOpen || Boolean(state.tsd?.open),
      screen,
      signal,
      title: titleByScreen[screen],
      storeName: order ? STORE_NAMES[order.storeId] || order.storeId : '',
      orderText: order ? `${item?.name || order.sku} · ${order.quantity} шт.` : '',
      zoneName: order ? ZONE_NAMES[order.zone] || order.zone : '',
      progressText,
      message: messageByScreen[screen],
      reportSummary,
      canAccept: screen === 'task' && !state.tsd?.acceptedOrderId && Boolean(order),
    };
  }

  return { terminalViewFor };
});

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

  const loadedQuantityFor = (state, order) => (state.loadedPallets || [])
    .filter((pallet) => pallet.storeId === order.storeId && pallet.zone === order.zone)
    .reduce((total, pallet) => total + (pallet.items || [])
      .filter((item) => item.sku === order.sku)
      .reduce((sum, item) => sum + item.quantity, 0), 0);

  const activeOrderFor = (state) => {
    const active = (state.orders || []).filter((order) => !order.cancelled);
    return active.find((order) => order.quantity - loadedQuantityFor(state, order) > 0) || null;
  };

  const acceptedOrderFor = (state) => (state.orders || [])
    .find((order) => order.id === state.tsd?.acceptedOrderId && !order.cancelled)
    || null;

  const pendingInboundFor = (state) => (state.inbound || [])
    .find((pallet) => pallet.status === 'arrived' || pallet.status === 'received') || null;

  function terminalViewFor(state) {
    const reportScreen = Boolean(state.report) || state.phase === 'report';
    const storyScreen = state.story?.kind === 'after' || state.phase === 'story-after';
    const errorScreen = state.feedback?.kind === 'error';
    const briefingScreen = state.phase === 'briefing' || state.tsd?.screen === 'briefing';
    const taskScreen = state.tsd?.screen === 'task';
    /* Приёмка блокирует склад: пока паллета стоит в воротах, отбирать из
       зоны нечего, поэтому ТСД показывает её раньше заявки на отгрузку. */
    const inbound = state.phase === 'shift' || taskScreen ? pendingInboundFor(state) : null;
    const screen = reportScreen
      ? 'report'
      : storyScreen
        ? 'briefing'
        : errorScreen
          ? 'feedback'
          : briefingScreen
            ? 'briefing'
            : inbound
              ? 'inbound'
              : taskScreen
                ? 'task'
                : 'current';

    const order = acceptedOrderFor(state) || activeOrderFor(state);
    const item = order ? engine.itemBySku(order.sku) : null;
    const inboundItem = inbound ? engine.itemBySku(inbound.sku) : null;
    const inboundZoneName = inbound ? ZONE_NAMES[inbound.zone] || inbound.zone : '';
    const awaitingPlacement = Boolean(inbound && inbound.status === 'received');
    const progressText = `${state.pallet?.weight || 0} / ${state.pallet?.capacity || 100} кг`;
    const signal = state.feedback?.kind === 'error' ? 'error' : (state.tsd?.signal || 'idle');
    // Имя уровня постоянно висит в шапке сцены над фотографией, поэтому
    // заголовок брифинга его не повторяет.
    const titleByScreen = {
      report: 'Итоги смены',
      feedback: 'Ошибка',
      briefing: state.story?.kind === 'after' ? 'Смена завершена' : 'Новая смена',
      inbound: awaitingPlacement ? 'Размещение' : 'Приёмка',
      task: 'Новое задание',
      current: 'Текущая работа',
    };
    const messageByScreen = {
      report: state.report?.reasons?.[0] || 'Смена завершена.',
      feedback: state.feedback?.message || '',
      briefing: state.story?.text || '',
      inbound: awaitingPlacement
        ? `Паллета принята. Нажмите зону «${inboundZoneName}» на схеме склада.`
        : 'Проверьте накладную и примите паллету.',
      task: state.feedback?.message || (order ? 'Проверьте заявку и примите её.' : 'Активных заявок нет.'),
      current: state.feedback?.message || '',
    };
    // Цифры отчёта живут в таблице карточки; строкой в шапке их печатать
    // второй раз незачем.
    const storyKind = state.story?.kind || null;
    const mandatoryOpen = ['feedback', 'briefing', 'report'].includes(screen);
    const accepted = Boolean(state.tsd?.acceptedOrderId);
    const remaining = order ? order.quantity - loadedQuantityFor(state, order) : 0;
    // Закрытый ТСД обязан показывать текущее задание: игрок смотрит на
    // железку, чтобы вспомнить, что собирает, не открывая терминал.
    const compactKicker = screen === 'report'
      ? 'Итоги'
      : inbound ? (awaitingPlacement ? 'Разместить' : 'Приёмка')
        : accepted ? 'В работе' : 'Новое задание';
    const compactTask = inbound
      ? `${inboundItem?.name || inbound.sku} · ${inbound.quantity} шт. → ${inboundZoneName}`
      : order
        ? `${STORE_NAMES[order.storeId] || order.storeId} · ${item?.name || order.sku} · ${remaining} шт.`
        : 'Все заявки собраны';
    const compactMeta = inbound
      ? (awaitingPlacement ? `Нажмите зону «${inboundZoneName}» на схеме` : `Поставщик: ${inbound.supplier}`)
      : order
        ? `${ZONE_NAMES[order.zone] || order.zone} · паллета ${progressText}`
        : 'Проверьте маршруты и завершите смену';

    return {
      open: mandatoryOpen || Boolean(state.tsd?.open),
      /* Затемнение перехватывает нажатия, поэтому ставить его на каждый
         открытый экран нельзя: размещение требует нажать зону на схеме
         склада, а задание — паллету. Блокируют только экраны, из которых
         действительно нет другого выхода. */
      blocking: mandatoryOpen,
      screen,
      signal,
      title: titleByScreen[screen],
      /* Экраны задания и приёмки раскладывают те же строки по подписанным
         карточкам («Куда», «Что собрать», «Зона»), поэтому шапка их не
         повторяет. Остаётся «Текущая работа», где карточек нет. */
      showOrderBlock: screen === 'current',
      storeName: inbound ? `Привоз: ${inbound.supplier}` : order ? STORE_NAMES[order.storeId] || order.storeId : '',
      orderText: inbound
        ? `${inboundItem?.name || inbound.sku} · ${inbound.quantity} шт.`
        : order ? `${item?.name || order.sku} · ${remaining} шт.` : '',
      zoneName: inbound ? inboundZoneName : order ? ZONE_NAMES[order.zone] || order.zone : '',
      progressText: inbound ? '' : progressText,
      message: messageByScreen[screen],
      storyKind,
      canAccept: screen === 'task' && !accepted && Boolean(order),
      canReceive: screen === 'inbound' && !awaitingPlacement,
      awaitingPlacement,
      placementZone: awaitingPlacement ? inbound.zone : null,
      // Брифинг, ошибка и отчёт держат терминал открытым принудительно, поэтому
      // CLOSE_TSD на них не даёт эффекта. Рисовать там крестик — обещать
      // действие, которого не будет: из этих экранов выходят кнопкой внизу.
      canClose: !mandatoryOpen,
      compactKicker,
      compactTask,
      compactMeta,
    };
  }

  return { terminalViewFor };
});

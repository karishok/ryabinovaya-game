(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const appState = isNode ? require('./app-state.js') : root.RyabinovayaAppState;
  const api = factory(engine, levelData, appState);
  if (isNode) module.exports = api;
  else root.RyabinovayaTsdView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData, appState) {
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

  /* Смена без поводыря: терминал выдаёт задания из очереди. Экран собирается
     поверх обычного и меняет только то, что относится к заданию: что
     предложено, что в работе, какие кнопки — «Принять» и
     «Взять срочное». Брифинг, ошибка и отчёт остаются прежними. */
  function queueViewFor(state, base) {
    const queue = appState.taskQueueFor(state);
    const current = queue.find((task) => task.active) || null;
    const offered = queue.find((task) => !task.active && !task.blocked) || null;
    const blocked = queue.filter((task) => task.blocked && !task.active);
    const orderOf = (task) => (state.orders || []).find((order) => order.id === task.orderId);
    const inboundOf = (task) => (state.inbound || []).find((pallet) => pallet.id === task.inboundId);
    const itemName = (sku) => engine.itemBySku(sku)?.name || sku;

    // Строки задания: три подписанные карточки, свои для каждого вида работы.
    const describe = (task) => {
      if (task.kind === 'pick') {
        const order = orderOf(task);
        // В задании — все строки заявки даркстора: они едут одной паллетой.
        const lines = (task.orderIds || [task.orderId]).map((id) => (state.orders || []).find((entry) => entry.id === id)).filter(Boolean);
        return {
          labels: ['Куда', 'Что собрать', 'Зона хранения'],
          values: [
            STORE_NAMES[order.storeId] || order.storeId,
            lines.map((line) => `${itemName(line.sku)} · ${line.quantity - loadedQuantityFor(state, line)} шт.`).join(', '),
            ZONE_NAMES[order.zone] || order.zone,
          ],
          compact: `${STORE_NAMES[order.storeId] || order.storeId} · ${lines.map((line) => itemName(line.sku)).join(', ')}`,
          message: lines.length > 1 ? 'Соберите всё на одну паллету и погрузите её в фургон.' : 'Соберите паллету и погрузите её в фургон.',
        };
      }
      if (task.kind === 'unload') {
        const vehicle = (state.vehicles || []).find((entry) => entry.id === task.vehicleId);
        const goods = (vehicle?.pallets || []).filter((pallet) => pallet.storeId === task.storeId)
          .flatMap((pallet) => pallet.items || []).map((item) => itemName(item.sku));
        return {
          labels: ['Фургон', 'Что снять', 'Причина'],
          values: [appState.vehicleLabel(state, vehicle), `${STORE_NAMES[task.storeId] || task.storeId} · ${[...new Set(goods)].join(', ')}`, 'заявка отменена'],
          compact: `Снять паллету: ${STORE_NAMES[task.storeId] || task.storeId}`,
          message: 'Даркстор отменил заявку. Паллета в кузове лишняя — снимите её.',
        };
      }
      const pallet = inboundOf(task);
      return {
        labels: ['Поставщик', 'В паллете', ''],
        values: [pallet.supplier, `${itemName(pallet.sku)} · ${pallet.quantity} шт.`, ''],
        compact: `Приёмка: ${itemName(pallet.sku)}`,
        message: 'Проверьте накладную и примите паллету.',
      };
    };

    // Срок задания терминал печатает, но очередь по нему не строит — это дело игрока.
    const clockText = (seconds) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
    const deadlineNote = (task) => {
      const deadline = task ? appState.taskDeadlineFor(state, task) : null;
      return typeof deadline === 'number' ? ` Фургон уходит через ${clockText(deadline - (state.elapsedSeconds || 0))}.` : '';
    };
    const placing = current?.kind === 'receive' && inboundOf(current)?.status === 'received';
    const shown = current || offered;
    const details = shown ? describe(shown) : null;
    const offering = !current && Boolean(offered);
    const waitingText = blocked.some((task) => task.blocked === 'no-stock')
      ? 'Ждём поставку: товара для оставшихся заданий ещё нет в зоне.'
      : 'Ждём фургон: оставшееся пока не на чем увезти.';

    const screen = placing ? 'inbound'
      : offering ? (offered.kind === 'receive' ? 'inbound' : 'task')
        : 'current';
    const title = placing ? 'Размещение'
      : offering ? (offered.urgent ? 'Срочное задание' : 'Новое задание')
        : current ? 'Задание в работе'
          : blocked.length ? 'Ждём' : 'Заданий нет';
    const message = state.feedback?.kind === 'info' && ['placing-first'].includes(state.feedback.code)
      ? state.feedback.message
      : placing ? 'Паллета принята. Выберите зону хранения на схеме склада.'
        // У принятого задания карточек на экране нет — что в работе, говорит сама строка.
        /* Предложенное задание называет себя в первой же строке: под кнопками
           стоит очередь, и «что дальше» не должно читаться раньше, чем «что
           сейчас». */
        : offering && offered.kind !== 'unload' ? `${details.values[0]} — ${details.values[1]}${deadlineNote(shown)}`
          : shown ? `${current ? `${details.compact}. ` : ''}${details.message}${deadlineNote(shown)}`
          : blocked.length ? waitingText
            : 'Все задания выполнены. Проверьте маршруты и завершите смену.';
    const canTakeUrgent = Boolean(current && offered?.urgent && !placing);
    /* Что терминал выдаст после предложенного задания и у какого из них
       уходит фургон. Окно ТСД закрывает и доску заявок, и таймер на
       воротах — очередь под кнопкой показывает то же самое, не закрывая. */
    const deadlineOf = (task) => {
      const deadline = appState.taskDeadlineFor(state, task);
      return typeof deadline === 'number' ? deadline - (state.elapsedSeconds || 0) : null;
    };
    const queueAhead = offering
      ? queue.filter((task) => !task.active && !task.blocked && task.id !== offered.id).slice(0, 4).map((task) => {
        const left = deadlineOf(task);
        return {
          text: describe(task).compact,
          urgent: task.urgent,
          deadlineText: left === null ? '' : `фургон ${clockText(left)}`,
          soon: left !== null && left <= 30,
        };
      })
      : [];
    const waitingCount = blocked.length;

    return {
      ...base,
      queue: true,
      screen,
      title,
      message,
      showOrderBlock: false,
      taskLabels: details?.labels || ['', '', ''],
      taskValues: details?.values || ['', '', ''],
      storeName: details?.values[0] || '',
      orderText: details?.values[1] || '',
      zoneName: details?.values[2] || '',
      progressText: '',
      canAccept: offering && offered.kind !== 'receive',
      canReceive: offering && offered.kind === 'receive',
      queueAhead,
      queueNote: offering && waitingCount ? `Ещё ${waitingCount} ждёт поставки или фургона` : '',
      canTakeUrgent,
      urgentLabel: canTakeUrgent ? `Взять срочное: ${describe(offered).compact}` : '',
      awaitingPlacement: placing,
      // Терминал зовёт, когда на нём лежит непринятое задание или срочное поверх начатого.
      attention: !base.open && (offering || canTakeUrgent),
      offeredTaskId: offering ? offered.id : null,
      currentTaskKind: current?.kind || null,
      compactKicker: offering ? (offered.urgent ? 'Срочное задание' : 'Новое задание') : current ? 'В работе' : blocked.length ? 'Ждём' : 'Готово',
      compactTask: shown ? details.compact : blocked.length ? 'товар в пути или фургон в рейсе' : 'Все задания выполнены',
      compactMeta: '',
    };
  }

  function terminalViewFor(state) {
    const reportScreen = Boolean(state.report) || state.phase === 'report';
    const storyScreen = state.story?.kind === 'after' || state.phase === 'story-after';
    const errorScreen = state.feedback?.kind === 'error';
    const briefingScreen = state.phase === 'briefing' || state.tsd?.screen === 'briefing';
    const taskScreen = state.tsd?.screen === 'task';
    /* Приёмка блокирует склад: пока паллета стоит в воротах, отбирать из
       зоны нечего, поэтому ТСД показывает её раньше заявки на отгрузку. */
    const inbound = state.phase === 'shift' || taskScreen ? pendingInboundFor(state) : null;
    const endlessScreen = state.phase === 'endless';
    // Порядок — это приоритет экранов; списком он читается, а семиэтажным
    // тернарником уже нет.
    const screen = [
      [endlessScreen, 'endless'],
      [reportScreen, 'report'],
      [storyScreen, 'briefing'],
      [errorScreen, 'feedback'],
      [briefingScreen, 'briefing'],
      [Boolean(inbound), 'inbound'],
      [taskScreen, 'task'],
    ].find(([when]) => when)?.[1] || 'current';

    const order = acceptedOrderFor(state) || activeOrderFor(state);
    const item = order ? engine.itemBySku(order.sku) : null;
    const inboundItem = inbound ? engine.itemBySku(inbound.sku) : null;
    /* Зону входящей паллеты терминал не называет нигде: какая температура
       нужна товару, решает игрок, и это решение — суть приёмки. */
    const awaitingPlacement = Boolean(inbound && inbound.status === 'received');
    const progressText = `${state.pallet?.weight || 0} / ${state.pallet?.capacity || 100} кг`;
    const signal = state.feedback?.kind === 'error' ? 'error' : (state.tsd?.signal || 'idle');
    // Имя уровня постоянно висит в шапке сцены над фотографией, поэтому
    // заголовок брифинга его не повторяет.
    const titleByScreen = {
      endless: 'Кампания пройдена',
      report: 'Итоги смены',
      feedback: 'Ошибка',
      briefing: state.story?.kind === 'after' ? 'Смена завершена' : 'Новая смена',
      inbound: awaitingPlacement ? 'Размещение' : 'Приёмка',
      task: 'Новое задание',
      current: 'Текущая работа',
    };
    const messageByScreen = {
      endless: 'Все смены кампании закрыты.',
      report: state.report?.reasons?.[0] || 'Смена завершена.',
      feedback: state.feedback?.message || '',
      briefing: state.story?.text || '',
      inbound: awaitingPlacement
        ? 'Паллета принята. Выберите зону хранения на схеме склада.'
        : 'Проверьте накладную и примите паллету.',
      task: state.feedback?.message || (order ? 'Проверьте заявку и примите её.' : 'Активных заявок нет.'),
      current: state.feedback?.message || '',
    };
    // Цифры отчёта живут в таблице карточки; строкой в шапке их печатать
    // второй раз незачем.
    const storyKind = state.story?.kind || null;
    const mandatoryOpen = ['feedback', 'briefing', 'report', 'endless'].includes(screen);
    const accepted = Boolean(state.tsd?.acceptedOrderId);
    const remaining = order ? order.quantity - loadedQuantityFor(state, order) : 0;
    // Закрытый ТСД обязан показывать текущее задание: игрок смотрит на
    // железку, чтобы вспомнить, что собирает, не открывая терминал.
    const compactKicker = screen === 'report'
      ? 'Итоги'
      : inbound ? (awaitingPlacement ? 'Разместить' : 'Приёмка')
        // Без этой ветки плашка писала «Новое задание» над строкой «Все
        // заявки собраны» — подпись противоречила тому, что под ней.
        : !order ? 'Готово'
          : accepted ? 'В работе' : 'Новое задание';
    const compactTask = inbound
      ? `${inboundItem?.name || inbound.sku} · ${inbound.quantity} шт.`
      : order
        ? `${STORE_NAMES[order.storeId] || order.storeId} · ${item?.name || order.sku} · ${remaining} шт.`
        : 'Все заявки собраны';
    /* Куда нажимать, уже написано в строке состояния над схемой, а адрес
       зоны — в строке задания выше. Плашка добавляет то, чего больше нигде
       нет: от кого пришла паллета. */
    const compactMeta = inbound
      ? `Поставщик: ${inbound.supplier}`
      : order
        ? `${ZONE_NAMES[order.zone] || order.zone} · паллета ${progressText}`
        : 'Проверьте маршруты и завершите смену';

    const open = mandatoryOpen || Boolean(state.tsd?.open);
    const canAccept = screen === 'task' && !accepted && Boolean(order);
    const canReceive = screen === 'inbound' && !awaitingPlacement;

    const base = {
      open,
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
      // Без приставки: карточка и так подписана «Поставщик».
      storeName: inbound ? inbound.supplier : order ? STORE_NAMES[order.storeId] || order.storeId : '',
      orderText: inbound
        ? `${inboundItem?.name || inbound.sku} · ${inbound.quantity} шт.`
        : order ? `${item?.name || order.sku} · ${remaining} шт.` : '',
      zoneName: inbound ? '' : order ? ZONE_NAMES[order.zone] || order.zone : '',
      progressText: inbound ? '' : progressText,
      message: messageByScreen[screen],
      storyKind,
      canAccept,
      canReceive,
      /* Прибор в ряду кнопок анимируется, только когда нажатие на него
         действительно что-то делает: взять заявку или принять привезённую
         паллету. На размещении задание висит на схеме склада, и мигать
         терминалом значило бы звать не туда. */
      attention: !open && (canAccept || canReceive),
      canRestart: screen === 'endless',
      awaitingPlacement,
      // Брифинг, ошибка и отчёт держат терминал открытым принудительно, поэтому
      // CLOSE_TSD на них не даёт эффекта. Рисовать там крестик — обещать
      // действие, которого не будет: из этих экранов выходят кнопкой внизу.
      canClose: !mandatoryOpen,
      compactKicker,
      compactTask,
      compactMeta,
    };
    const queueShift = !appState.guidedFor(state) && state.phase === 'shift' && screen !== 'feedback' && screen !== 'report' && screen !== 'briefing';
    return queueShift ? queueViewFor(state, base) : base;
  }

  return { terminalViewFor };
});

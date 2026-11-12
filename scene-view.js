(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const appState = isNode ? require('./app-state.js') : root.RyabinovayaAppState;
  const api = factory(levelData, engine, appState);
  if (isNode) module.exports = api;
  else root.RyabinovayaSceneView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levelData, engine, appState) {
  const { orphanPalletsFor, vehicleLabel, vehicleForPallet, taskQueueFor, taskDeadlineFor } = appState;
  const clockText = (seconds) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;

  /* Фургоны, которые уйдут в рейс по часам, — ближайший первым. Это время
     видно на схеме постоянно: по нему игрок решает, какое задание отложить. */
  const departuresFor = (state) => (state.vehicles || [])
    .filter((vehicle) => typeof vehicle.departsAt === 'number' && !vehicle.departed)
    .sort((left, right) => left.departsAt - right.departsAt)
    .map((vehicle) => ({
      vehicleId: vehicle.id,
      label: vehicleLabel(state, vehicle),
      zone: vehicle.zone,
      zoneMark: ZONE_MARKS[vehicle.zone] || '',
      secondsLeft: Math.max(0, vehicle.departsAt - (state.elapsedSeconds || 0)),
      leftText: clockText(vehicle.departsAt - (state.elapsedSeconds || 0)),
    }));
  const ZONE_NAMES = levelData.ZONE_NAMES;
  const STORE_NAMES = levelData.STORE_NAMES;
  const ZONE_MARKS = levelData.ZONE_MARKS;

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

  /* Цель по сборке обязана быть видна, не открывая ничего: сколько ещё
     штук класть на паллету. Раньше это число висело на полосе закрытого
     ТСД, а когда полосу убрали, единственным постоянным указателем осталась
     заливка паллеты в процентах — вес, а не задание. Считаем от остатка
     заявки за вычетом того, что уже лежит на текущей паллете. */
  /* Заявка, под которую адресована паллета. На смене без поводыря игрок сам
     выбирает заявку с доски, и первая открытая по списку — уже не она. */
  const palletOrderFor = (state) => (state.orders || [])
    .filter((order) => !order.cancelled && order.quantity - loadedQuantityFor(state, order) > 0)
    .find((order) => order.storeId === state.pallet?.storeId && order.zone === state.pallet?.zone)
    || activeOrderFor(state);

  // Открытая заявка, которую можно выполнить сейчас: есть товар и есть фургон.
  const workableOrderFor = (state) => (state.orders || [])
    .filter((order) => !order.cancelled && order.quantity - loadedQuantityFor(state, order) > 0)
    .find((order) => engine.availableStock(state.stock, order.zone, order.sku) > 0
      && Boolean(vehicleForPallet(state, { zone: order.zone, weight: engine.itemBySku(order.sku)?.weightPerUnit || 0 }).vehicle))
    || null;

  const palletGoalFor = (state) => {
    if (pendingInboundFor(state)) return '';
    const order = palletOrderFor(state);
    if (!order) return '';
    const onPallet = (state.pallet?.items || [])
      .filter((item) => item.sku === order.sku)
      .reduce((total, item) => total + item.quantity, 0);
    const left = Math.max(0, order.quantity - loadedQuantityFor(state, order) - onPallet);
    // Ноль — это не «нечего делать», а «пора грузить», и так и написано.
    return left ? `ещё ${left} шт.` : 'готова';
  };

  const capacityTargetFor = (state) => {
    const message = String(state.feedback?.message || '');
    if (/паллета/i.test(message)) return 'pallet';
    if (/машин/i.test(message)) return 'truck';
    return 'truck';
  };

  /* Ровно один ответ на вопрос «что сейчас делать». Раньше подсветка на
     схеме включалась по уже сделанному действию: паллета загоралась, когда на
     ней появлялся вес, ворота — на секунду после погрузки. В стартовом
     состоянии, где игрок как раз не знает, куда нажать, не горело ничего.
     Здесь шаг считается от задачи, а не от прошлого жеста, и у него всегда
     есть кнопка, которая его выполняет — даже если объект на схеме не нашли. */
  function nextStepFor(state) {
    if (state.phase !== 'shift') return null;
    const inbound = pendingInboundFor(state);
    if (inbound) {
      const item = engine.itemBySku(inbound.sku);
      const goods = `${item?.name || inbound.sku} · ${inbound.quantity} шт.`;
      if (inbound.status === 'arrived') {
        return {
          key: 'receive',
          title: 'Примите поставку',
          detail: `${inbound.supplier}: ${goods}`,
          actionLabel: 'Открыть накладную',
          action: 'OPEN_TSD',
          focus: 'dock',
        };
      }
      /* Шаг называет, что сделать, но не куда: у него нет кнопки, и ни одна
         вывеска не выделена. Что воде место в сухаче, а мороженому в
         заморозке, игрок решает сам — в этом и состоит приёмка. */
      return {
        key: 'place',
        title: `Разместите паллету: ${item?.name || inbound.sku}`,
        detail: 'Выберите зону на схеме сами. Чужая температура испортит товар',
        actionLabel: '',
        action: null,
        focus: 'zones',
      };
    }
    /* Отменённая заявка, чья паллета уже в кузове, важнее следующей сборки:
       пока её не сняли, она тянет вниз точность и удлиняет рейс. */
    const [orphan] = orphanPalletsFor(state);
    if (orphan) {
      const vehicle = (state.vehicles || []).find((entry) => entry.id === orphan.vehicleId);
      return {
        key: 'unload',
        title: `Заявку «${STORE_NAMES[orphan.pallet.storeId] || orphan.pallet.storeId}» отменили — снимите паллету`,
        detail: `${orphan.pallet.weight} кг едут зря в кузове «${vehicleLabel(state, vehicle)}». Откройте фургон и нажмите «Снять»`,
        actionLabel: 'Открыть фургон',
        action: 'OPEN_VEHICLES',
        vehicleId: orphan.vehicleId,
        focus: 'truck',
      };
    }
    /* Заявка шага — та, что уже на паллете, а иначе первая, которую можно
       выполнить прямо сейчас: товар есть в зоне и есть готовый фургон с
       местом. Заявку, чья фура ещё в пути или чей фургон в рейсе, шаг
       пропускает, а не упирается в неё. */
    const building = (state.pallet?.weight || 0) > 0;
    const order = building ? palletOrderFor(state) : workableOrderFor(state);
    if (!order && !building && activeOrderFor(state)) {
      return {
        key: 'wait',
        title: 'Ждём: товар в пути или фургон в рейсе',
        detail: 'Оставшиеся заявки пока нечем собрать или не на чем увезти',
        actionLabel: '',
        action: null,
        focus: '',
      };
    }
    if (order) {
      const item = engine.itemBySku(order.sku);
      const storeName = STORE_NAMES[order.storeId] || order.storeId;
      const zoneName = ZONE_NAMES[order.zone] || order.zone;
      const onPallet = (state.pallet?.items || [])
        .filter((entry) => entry.sku === order.sku)
        .reduce((total, entry) => total + entry.quantity, 0);
      const left = Math.max(0, order.quantity - loadedQuantityFor(state, order) - onPallet);
      /* Заявка тяжелее паллеты: когда следующая упаковка уже не влезает,
         шаг — грузить то, что собрано, а не «добрать ещё две». */
      const palletFull = (state.pallet?.weight || 0) > 0
        && (state.pallet.weight + (item?.weightPerUnit || 0)) > (state.pallet.capacity || 100);
      if (left > 0 && palletFull) {
        return {
          key: 'load',
          orderId: order.id,
          title: 'Паллета полная — погрузите её',
          detail: `${state.pallet.weight} кг из ${state.pallet.capacity || 100}. Остаток заявки (${left} шт.) пойдёт следующей паллетой`,
          actionLabel: 'Погрузить в фургон',
          action: 'LOAD_PALLET',
          focus: 'pallet',
        };
      }
      if (left > 0) {
        return {
          key: 'collect',
          orderId: order.id,
          title: onPallet ? `Доберите паллету: ${storeName}` : `Соберите паллету: ${storeName}`,
          detail: `${item?.name || order.sku} · ещё ${left} шт. · зона «${zoneName}»`,
          actionLabel: onPallet ? 'Продолжить сборку' : 'Собрать паллету',
          action: 'OPEN_BUILDER',
          focus: 'pallet',
        };
      }
      return {
        key: 'load',
        orderId: order.id,
        title: 'Паллета готова — погрузите её',
        detail: `${state.pallet?.weight || 0} кг → фургон зоны «${zoneName}», адрес ${storeName}`,
        actionLabel: 'Погрузить в фургон',
        action: 'LOAD_PALLET',
        focus: 'pallet',
      };
    }
    if ((state.pallet?.weight || 0) > 0) {
      return {
        key: 'load',
        title: 'Паллета готова — погрузите её',
        detail: `${state.pallet.weight} кг → фургон зоны «${ZONE_NAMES[state.pallet.zone] || state.pallet.zone}»`,
        actionLabel: 'Погрузить в фургон',
        action: 'LOAD_PALLET',
        focus: 'pallet',
      };
    }
    if (routeCanBeShortened(state)) {
      return {
        key: 'route',
        title: 'Маршрут можно сократить',
        detail: 'Переставьте остановки так, чтобы рейс стал короче',
        actionLabel: 'Открыть маршрут',
        action: 'OPEN_VEHICLES',
        focus: 'truck',
      };
    }
    return {
      key: 'finish',
      title: 'Все заявки собраны',
      detail: 'Фургоны уедут по окончании смены — можно закрыть её сейчас',
      actionLabel: 'Завершить смену',
      action: 'END_SHIFT',
      focus: 'finish',
    };
  }

  const guidedFor = (state) => levelData.LEVELS.find((level) => level.id === state.levelId)?.guided !== false;

  /* Доска заявок для смен без поводыря. Она показывает состояние, а не шаг:
     что заказано, сколько уже в кузове, чего нет на складе, что отменено.
     Какую заявку брать и что делать с отменённой, решает игрок. */
  /* «Нет на складе» не отвечало на главный вопрос: ждать или это тупик.
     Доска говорит, где товар на самом деле — едет, стоит у ворот или погиб. */
  function missingStockNote(state, sku) {
    const inbound = (state.inbound || []).filter((pallet) => pallet.sku === sku);
    if (inbound.some((pallet) => pallet.status === 'arrived' || pallet.status === 'received')) return 'стоит на приёмке';
    const onTheWay = (state.scheduledEvents || []).some((event, index) => event.type === 'pallet-arrived'
      && event.pallet?.sku === sku && !(state.appliedEventIndexes || []).includes(index));
    if (onTheWay) return 'фура в пути';
    if (inbound.some((pallet) => pallet.status === 'spoiled')) return 'поставка испорчена';
    return 'нет на складе';
  }

  function orderBoardFor(state) {
    if (state.phase !== 'shift') return null;
    /* Доска — табло, а не меню: заявку с неё не выбирают, задания выдаёт
       ТСД. Она показывает, что в работе и что терминал предложит следующим. */
    const queue = taskQueueFor(state);
    const offered = queue.find((task) => !task.active && !task.blocked);
    return (state.orders || []).map((order) => {
      const task = queue.find((entry) => entry.kind === 'pick' && entry.orderId === order.id) || null;
      const deadline = task ? taskDeadlineFor(state, task) : null;
      const item = engine.itemBySku(order.sku);
      const loaded = loadedQuantityFor(state, order);
      // Открытая заявка без задания — та, чей фургон уже ушёл: её не выполнить.
      const lost = !order.cancelled && loaded < order.quantity && !task
        && !(state.vehicles || []).some((vehicle) => vehicle.zone === order.zone && !vehicle.departed);
      const status = order.cancelled ? 'cancelled' : loaded >= order.quantity ? 'done' : lost ? 'lost' : 'open';
      const noStock = status === 'open' && engine.availableStock(state.stock, order.zone, order.sku) === 0;
      const note = status === 'cancelled'
        ? (loaded > 0 ? `отменена · в кузове ${loaded} шт.` : 'отменена')
        : status === 'lost' ? 'сорвана: фургон ушёл'
          : noStock ? missingStockNote(state, order.sku) : '';
      return {
        orderId: order.id,
        storeName: STORE_NAMES[order.storeId] || order.storeId,
        itemName: item?.name || order.sku,
        /* Пока товара нет в зоне, доска не показывает его температуру:
           иначе она подсказывала бы, куда ставить паллету с приёмки. */
        zone: noStock ? '' : order.zone,
        zoneMark: noStock ? '' : ZONE_MARKS[order.zone] || '',
        loaded,
        quantity: order.quantity,
        status,
        // Лишний груз отменённой заявки — единственное, что на доске тревожит.
        alert: status === 'cancelled' && loaded > 0,
        note,
        // Сколько осталось до ухода фургона, который ещё может увезти заявку.
        deadlineText: status === 'open' && typeof deadline === 'number' ? clockText(deadline - (state.elapsedSeconds || 0)) : '',
        deadlineSoon: status === 'open' && typeof deadline === 'number' && deadline - (state.elapsedSeconds || 0) <= 20,
        active: Boolean(task?.active),
        next: Boolean(task && offered && task.id === offered.id),
        urgent: Boolean(task?.urgent),
      };
    });
  }

  function warehouseViewFor(state) {
    const order = activeOrderFor(state);
    const guidedShift = guidedFor(state);
    /* На смене с очередью ТСД паллета у ворот — ещё не работа, пока её
       задание не принято: схема показывает приёмку, только когда игрок уже
       взял паллету. */
    const activeTask = guidedShift ? null : taskQueueFor(state).find((task) => task.active) || null;
    const inbound = guidedShift
      ? pendingInboundFor(state)
      : activeTask?.kind === 'receive' ? (state.inbound || []).find((pallet) => pallet.id === activeTask.inboundId) || null : null;
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
      placing: 'Паллета принята — выберите для неё зону хранения.',
      collecting: 'Тележка готовит текущую паллету.',
      'to-dispatch': state.feedback?.message || 'Тележка везёт паллету к воротам.',
      // Не «готова к отправке»: отправлять её вручную не нужно и нечем.
      'route-ready': 'Маршрут построен — машина уедет по окончании смены.',
      spoiled: state.feedback?.message || 'Паллета испорчена из-за неверной зоны.',
      blocked: state.feedback?.message || 'Не хватает свободного места.',
    };

    const guided = guidedShift;
    const nextStep = guided ? nextStepFor(state) : null;

    return {
      guided,
      departures: departuresFor(state),
      nextStep,
      orderBoard: guided ? null : orderBoardFor(state),
      focus: nextStep?.focus || '',
      /* Вывески во время размещения — кнопки, но какая из них верная, схема
         не показывает: ни на смене с поводырём, ни без него. */
      awaitingPlacement,
      inboundCount: (state.inbound || []).filter((pallet) => pallet.status === 'arrived' || pallet.status === 'received').length,
      /* Подсветка зоны остаётся только для отбора на смене с поводырём, и
         только там, где есть из чего выбирать: зона заявки написана в задании.
         На размещении и на сменах без поводыря не подсвечиваем ничего. */
      // Пока на приёмке стоит паллета, подсвеченная зона заявки читалась бы
      // как «ставь сюда» — и была бы чужой.
      activeZone: !guided || inbound
        ? null
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
      // Цель на паллете — по принятому заданию: пока его нет, считать нечего.
      palletGoalText: guided ? palletGoalFor(state) : activeTask?.kind === 'pick' ? palletGoalFor({ ...state, inbound: [] }) : '',
      loadedPalletCount: (state.loadedPallets || []).length,
      routeReady,
      routeCanBeShortened: guided && routeCanBeShortened(state),
      eventCode: ['demand-increase', 'vehicle-ready', 'store-reception-change', 'order-cancelled'].includes(code) ? code : '',
      statusText: statusByMode[mode],
      operatorName: ['spoiled', 'blocked'].includes(mode) ? 'Лера' : 'Миша',
    };
  }

  return { warehouseViewFor, nextStepFor, orderBoardFor, departuresFor };
});

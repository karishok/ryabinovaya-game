(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const flow = isNode ? require('./flow-engine.js') : root.RyabinovayaFlowEngine;
  const api = factory(engine, levelData, flow);
  if (isNode) module.exports = api;
  else root.RyabinovayaFlowView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData, flow) {
  const { ZONE_NAMES, ZONE_MARKS, STORE_NAMES } = levelData;
  const { STATIONS } = flow;

  const STATION_NAMES = Object.freeze({
    [STATIONS.RECEIVING]: 'Приёмка',
    [STATIONS.PUTAWAY]: 'Размещение',
    [STATIONS.PICKING]: 'Отбор',
    [STATIONS.LOADING]: 'Погрузка',
  });

  const BUSY_LABELS = Object.freeze({
    walk: 'Иду',
    unload: 'Разгружаю',
    putaway: 'Везу в зону',
    pick: 'Везу к воротам отгрузки',
    load: 'Гружу в фургон',
  });

  const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const goodsText = (item) => `${engine.itemBySku(item.sku)?.name || item.sku} · ${item.quantity} шт.`;

  /* «1 фур ждёт» — не по-русски, а число здесь меняется каждую секунду,
     поэтому склонение приходится считать, а не обходить формулировкой. */
  function plural(count, one, few, many) {
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = count % 10;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /* Скоропорт становится срочным, когда прошла половина срока: ровно та
     граница, за которой пропадает бонус за быструю обработку. Так игрок
     видит не абстрактную шкалу, а момент, когда он начинает терять. */
  const urgencyOf = (pallet) => {
    if (pallet.shelf === null) return 'calm';
    const left = pallet.shelf / pallet.shelfMax;
    if (left <= 0.25) return 'critical';
    if (left <= 0.5) return 'warning';
    return 'calm';
  };

  function gatesFor(state) {
    const atReceiving = state.station === STATIONS.RECEIVING;
    const roomLeft = state.settings.bufferSlots - state.buffer.length;
    return state.gates.map((gate) => {
      if (!gate.truck) {
        return { id: gate.id, occupied: false, title: 'Гейт свободен', canUnload: false, blockedBy: null };
      }
      const busyHere = state.busy?.kind === 'unload' && state.busy.gateId === gate.id;
      const blockedBy = !atReceiving ? 'station'
        : state.busy ? 'busy'
          : roomLeft <= 0 ? 'buffer' : null;
      return {
        id: gate.id,
        occupied: true,
        title: gate.truck.supplier,
        goods: goodsText(gate.truck),
        /* Зону фуры и паллеты экран не называет: какому товару какая
           температура, игрок решает сам на размещении — как и в кампании. */
        perishable: flow.isPerishable(gate.truck.zone),
        waitedText: `ждёт ${gate.truck.waitedSeconds} с`,
        unloading: busyHere,
        canUnload: !blockedBy,
        blockedBy,
      };
    });
  }

  function bufferFor(state, selectedPalletId) {
    const atPutaway = state.station === STATIONS.PUTAWAY;
    return {
      used: state.buffer.length,
      slots: state.settings.bufferSlots,
      /* Свободные слоты — главный ресурс игрока: пока они есть, приёмка
         работает, кончились — встала. Поэтому их показываем числом, а не
         оставляем вычитать из двух чисел в уме. */
      free: state.settings.bufferSlots - state.buffer.length,
      full: state.buffer.length >= state.settings.bufferSlots,
      pallets: state.buffer.map((pallet) => ({
        id: pallet.id,
        goods: goodsText(pallet),
        supplier: pallet.supplier,
        perishable: pallet.shelf !== null,
        shelfText: pallet.shelf === null ? 'не портится' : `${pallet.shelf} с`,
        shelfPercent: pallet.shelf === null ? 100 : Math.round((pallet.shelf / pallet.shelfMax) * 100),
        urgency: urgencyOf(pallet),
        selected: pallet.id === selectedPalletId,
        moving: state.busy?.kind === 'putaway' && state.busy.palletId === pallet.id,
        canTake: atPutaway && !state.busy,
      })),
    };
  }

  /* Фургон срочен, когда до его ухода остаётся меньше, чем нужно на полный
     проход «отобрать — дойти — погрузить» с запасом на решение. */
  const vanUrgencyOf = (state, van) => {
    const left = van.dueAt - state.elapsed;
    if (left <= 10) return 'critical';
    if (left <= 20) return 'warning';
    return 'calm';
  };

  const itemName = (sku) => engine.itemBySku(sku)?.name || sku;

  /* Один список фургонов на две станции: на отборе его строка достаёт
     паллету из зоны, на погрузке — ставит её в кузов. Строка сама говорит,
     почему действие недоступно: «нет в зоне», «ещё не собрана», «вы не
     здесь» — мёртвая кнопка без причины оставляла игрока гадать. */
  function vansFor(state) {
    const atPicking = state.station === STATIONS.PICKING;
    const atLoading = state.station === STATIONS.LOADING;
    const stagingFull = state.staging.length >= state.settings.stagingSlots;
    // Паллеты зоны отгрузки раздаём фургонам по порядку ухода: первому — первая.
    const stagedLeft = new Map();
    for (const pallet of state.staging) stagedLeft.set(pallet.sku, (stagedLeft.get(pallet.sku) || 0) + 1);
    const stockLeft = new Map();
    for (const pallet of state.stock) stockLeft.set(pallet.sku, (stockLeft.get(pallet.sku) || 0) + 1);

    return [...state.vans].sort((left, right) => left.dueAt - right.dueAt).map((van) => {
      const staged = (stagedLeft.get(van.sku) || 0) > 0;
      if (staged) stagedLeft.set(van.sku, stagedLeft.get(van.sku) - 1);
      const inStock = !staged && (stockLeft.get(van.sku) || 0) > 0;
      if (inStock) stockLeft.set(van.sku, stockLeft.get(van.sku) - 1);
      const picking = state.busy?.kind === 'pick' && state.busy.vanId === van.id;
      const loading = state.busy?.kind === 'load' && state.busy.vanId === van.id;
      const pickBlockedBy = staged ? 'staged'
        : !inStock ? 'no-stock'
          : !atPicking ? 'station'
            : state.busy ? 'busy'
              : stagingFull ? 'staging-full' : null;
      const loadBlockedBy = !staged ? 'not-picked'
        : !atLoading ? 'station'
          : state.busy ? 'busy' : null;
      const secondsLeft = Math.max(0, van.dueAt - state.elapsed);
      return {
        id: van.id,
        storeName: STORE_NAMES[van.storeId] || van.storeId,
        goods: itemName(van.sku),
        secondsLeft,
        leftText: `уйдёт через ${secondsLeft} с`,
        urgency: vanUrgencyOf(state, van),
        status: staged ? 'staged' : inStock ? 'in-stock' : 'no-stock',
        picking,
        loading,
        canPick: !pickBlockedBy,
        pickBlockedBy,
        canLoad: !loadBlockedBy,
        loadBlockedBy,
      };
    });
  }

  function stagingFor(state) {
    return {
      used: state.staging.length,
      slots: state.settings.stagingSlots,
      free: state.settings.stagingSlots - state.staging.length,
      full: state.staging.length >= state.settings.stagingSlots,
      pallets: state.staging.map((pallet) => ({
        id: pallet.id,
        goods: itemName(pallet.sku),
        perishable: pallet.shelf !== null,
        shelfText: pallet.shelf === null ? 'не портится' : `${pallet.shelf} с`,
        shelfPercent: pallet.shelf === null ? 100 : Math.round((pallet.shelf / pallet.shelfMax) * 100),
        urgency: urgencyOf(pallet),
        loading: state.busy?.kind === 'load' && state.busy.palletId === pallet.id,
      })),
    };
  }

  // Что стоит в зонах: по товару, без зон — зона товара уже не решение.
  function stockFor(state) {
    const counts = new Map();
    for (const pallet of state.stock) counts.set(pallet.sku, (counts.get(pallet.sku) || 0) + 1);
    return [...counts].map(([sku, count]) => ({ sku, name: itemName(sku), count }));
  }

  /* Полоса станций — это периферийное зрение игрока: она обязана показывать
     давление на станции, где он сейчас не стоит, иначе переключаться он
     будет вслепую. */
  function stationsFor(state) {
    const waitingTrucks = state.gates.filter((gate) => gate.truck).length + state.queue.length;
    const urgent = state.buffer.filter((pallet) => urgencyOf(pallet) !== 'calm').length;
    const vans = vansFor(state);
    const toPick = vans.filter((van) => van.status === 'in-stock');
    const toLoad = vans.filter((van) => van.status === 'staged');
    const stagedUrgent = state.staging.some((pallet) => urgencyOf(pallet) !== 'calm');
    return [
      {
        id: STATIONS.RECEIVING,
        name: STATION_NAMES[STATIONS.RECEIVING],
        here: state.station === STATIONS.RECEIVING,
        pressure: waitingTrucks
          ? `${waitingTrucks} ${plural(waitingTrucks, 'фура', 'фуры', 'фур')} ${plural(waitingTrucks, 'ждёт', 'ждут', 'ждут')}`
          : 'пусто',
        // Забитый буфер останавливает приёмку целиком — это и есть тревога.
        alert: waitingTrucks > 0 && state.buffer.length >= state.settings.bufferSlots,
      },
      {
        id: STATIONS.PUTAWAY,
        name: STATION_NAMES[STATIONS.PUTAWAY],
        here: state.station === STATIONS.PUTAWAY,
        pressure: `${state.buffer.length}/${state.settings.bufferSlots} в буфере`,
        alert: urgent > 0,
      },
      {
        id: STATIONS.PICKING,
        name: STATION_NAMES[STATIONS.PICKING],
        here: state.station === STATIONS.PICKING,
        pressure: toPick.length
          ? `${toPick.length} ${plural(toPick.length, 'фургон', 'фургона', 'фургонов')} ${plural(toPick.length, 'ждёт', 'ждут', 'ждут')}`
          : vans.length ? 'товара нет в зонах' : 'пусто',
        // Фургон вот-вот уйдёт, а его товар стоит в зоне и не отобран.
        alert: toPick.some((van) => van.urgency !== 'calm'),
      },
      {
        id: STATIONS.LOADING,
        name: STATION_NAMES[STATIONS.LOADING],
        here: state.station === STATIONS.LOADING,
        pressure: toLoad.length
          ? `${toLoad.length} ${plural(toLoad.length, 'паллета', 'паллеты', 'паллет')} к погрузке`
          : 'пусто',
        // Отобранный скоропорт тухнет у ворот, или фургон с готовой паллетой уходит.
        alert: stagedUrgent || toLoad.some((van) => van.urgency !== 'calm'),
      },
    ];
  }

  function busyFor(state) {
    if (!state.busy) return null;
    const total = state.busy.endsAt - state.busy.startedAt;
    const done = state.elapsed - state.busy.startedAt;
    const label = state.busy.kind === 'walk'
      ? `${BUSY_LABELS.walk} на «${STATION_NAMES[state.busy.to]}»`
      : BUSY_LABELS[state.busy.kind];
    return {
      kind: state.busy.kind,
      label,
      percent: Math.min(100, Math.round((done / total) * 100)),
      secondsLeft: Math.max(0, state.busy.endsAt - state.elapsed),
    };
  }

  function flowViewFor(state, selectedPalletId = null) {
    const goals = state.report ? state.report.goals : flow.goalsFor(state);
    return {
      running: state.phase === 'running',
      clock: clockText(state.secondsRemaining),
      station: state.station,
      stationName: STATION_NAMES[state.station],
      busy: busyFor(state),
      gates: gatesFor(state),
      queueText: state.queue.length
        ? `За воротами ${plural(state.queue.length, 'ждёт', 'ждут', 'ждут')} ещё ${state.queue.length}`
        : '',
      buffer: bufferFor(state, selectedPalletId),
      vans: vansFor(state),
      staging: stagingFor(state),
      stock: stockFor(state),
      zones: Object.keys(ZONE_NAMES).map((zone) => ({
        id: zone,
        name: ZONE_NAMES[zone],
        mark: ZONE_MARKS[zone],
      })),
      stations: stationsFor(state),
      goals: goals.map((goal) => ({ ...goal, text: goal.text })),
      message: state.feedback?.message || '',
      messageKind: state.feedback?.kind || null,
      report: state.report,
    };
  }

  return { flowViewFor, STATION_NAMES, urgencyOf, vanUrgencyOf, plural };
});

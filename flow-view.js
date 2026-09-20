(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const levelData = isNode ? require('./levels.js') : root.RyabinovayaLevels;
  const flow = isNode ? require('./flow-engine.js') : root.RyabinovayaFlowEngine;
  const api = factory(engine, levelData, flow);
  if (isNode) module.exports = api;
  else root.RyabinovayaFlowView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, levelData, flow) {
  const { ZONE_NAMES, ZONE_MARKS } = levelData;
  const { STATIONS } = flow;

  const STATION_NAMES = Object.freeze({
    [STATIONS.RECEIVING]: 'Приёмка',
    [STATIONS.PUTAWAY]: 'Размещение',
  });

  const BUSY_LABELS = Object.freeze({
    walk: 'Иду',
    unload: 'Разгружаю',
    putaway: 'Везу в зону',
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
        zone: gate.truck.zone,
        zoneMark: ZONE_MARKS[gate.truck.zone] || '',
        zoneName: ZONE_NAMES[gate.truck.zone] || gate.truck.zone,
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
        zone: pallet.zone,
        zoneMark: ZONE_MARKS[pallet.zone] || '',
        zoneName: ZONE_NAMES[pallet.zone] || pallet.zone,
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

  /* Полоса станций — это периферийное зрение игрока: она обязана показывать
     давление на станции, где он сейчас не стоит, иначе переключаться он
     будет вслепую. */
  function stationsFor(state) {
    const waitingTrucks = state.gates.filter((gate) => gate.truck).length + state.queue.length;
    const urgent = state.buffer.filter((pallet) => urgencyOf(pallet) !== 'calm').length;
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

  return { flowViewFor, STATION_NAMES, urgencyOf, plural };
});

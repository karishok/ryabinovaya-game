(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const engine = isNode ? require('./game-engine.js') : root.RyabinovayaEngine;
  const api = factory(engine);
  if (isNode) module.exports = api;
  else root.RyabinovayaFlowEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  /* Смена-поток отличается от кампании одним: склад работает сам. В кампании
     TICK только уменьшает таймер, а фуры приезжают по сценарию, прописанному
     в уровне руками. Здесь фуры приходят по расписанию, буфер приёмки
     наполняется, скоропорт тухнет — и всё это идёт, пока игрок занят другой
     станцией. Без этого переключение между станциями было бы меню. */

  const STATIONS = Object.freeze({ RECEIVING: 'receiving', PUTAWAY: 'putaway' });

  /* Часы свежести идут, только пока паллета вне своей температуры — то есть
     в буфере приёмки и на тележке. Встала в зону — часы встали, а на гейте
     ещё не пошли: время начинает течь с разгрузки, и потому «не разгружай
     то, что не успеешь развезти» — это решение игрока, а не невезение.
     Сроки подобраны так, что развоз батча из четырёх (20 с) заморозку уже
     не спасает, а из двух (10 с) — спасает: отсюда и выбор, сколько брать
     за один заход. Сухач не портится вовсе и потому соблазняет — возить его
     безопасно, а время он съедает то же самое. */
  const SHELF_SECONDS = Object.freeze({ dry: null, chilled: 20, frozen: 14 });

  const DURATIONS = Object.freeze({ walk: 2, unload: 3, putaway: 5 });

  const SUPPLIERS = Object.freeze(['Аквалайн', 'Молочный дом', 'Фрутлайн', 'Хлебзавод №3', 'Полюс']);

  const DEFAULTS = Object.freeze({
    seconds: 180,
    gates: 3,
    bufferSlots: 4,
    firstArrivalAt: 2,
    /* Темп прибытия — это и есть сложность смены: на симуляции он решает
       цель по бэклогу почти в одиночку, тогда как умение игрока меряется
       скоропортом. При 7–11 с бэклог достижим и перестаёт быть глухой
       стеной, а порча остаётся на совести игрока. */
    minGap: 7,
    maxGap: 11,
    backlogLimit: 4,
  });

  /* Линейный конгруэнтный генератор: расписание смены должно быть
     воспроизводимым, иначе тест на выигрываемость проверяет случайность. */
  function rngFrom(seed) {
    let value = (seed >>> 0) || 1;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

  const shelfFor = (zone) => SHELF_SECONDS[zone] ?? null;

  const isPerishable = (zone) => shelfFor(zone) !== null;

  function buildSchedule(rand, options) {
    const items = Object.values(engine.ITEMS);
    const schedule = [];
    let at = options.firstArrivalAt;
    let number = 0;
    /* Последние секунды смены фуру не присылаем: разгрузить и разместить её
       уже не успеть, и это была бы не сложность, а обман. */
    const lastArrival = options.seconds - (DURATIONS.unload + DURATIONS.putaway + DURATIONS.walk);
    while (at <= lastArrival) {
      const item = pick(rand, items);
      number += 1;
      schedule.push({
        id: `truck-${number}`,
        at,
        supplier: pick(rand, SUPPLIERS),
        sku: item.sku,
        zone: item.zone,
        quantity: 2 + Math.floor(rand() * 4),
      });
      at += options.minGap + Math.floor(rand() * (options.maxGap - options.minGap + 1));
    }
    return schedule;
  }

  function createFlowShift(options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const rand = rngFrom(settings.seed ?? 20260920);
    return {
      phase: 'running',
      settings,
      secondsRemaining: settings.seconds,
      elapsed: 0,
      station: STATIONS.RECEIVING,
      busy: null,
      gates: Array.from({ length: settings.gates }, (_, index) => ({ id: `gate-${index + 1}`, truck: null })),
      queue: [],
      buffer: [],
      schedule: buildSchedule(rand, settings),
      stored: [],
      spoiled: [],
      bonusFresh: 0,
      report: null,
      feedback: null,
    };
  }

  const bufferHasRoom = (state) => state.buffer.length < state.settings.bufferSlots;

  /* Незакрытая работа смены: фуры на гейтах, фуры в очереди и паллеты,
     которые лежат в буфере вместо стеллажа. */
  const backlogOf = (state) => state.gates.filter((gate) => gate.truck).length
    + state.queue.length
    + state.buffer.length;

  function admitArrivals(state) {
    const due = state.schedule.filter((truck) => truck.at <= state.elapsed);
    if (!due.length) return state;
    let gates = state.gates;
    let queue = [...state.queue, ...due.map((truck) => ({ ...truck, waitedSeconds: 0 }))];
    const schedule = state.schedule.filter((truck) => truck.at > state.elapsed);
    // Свободный гейт занимает та фура, что ждёт дольше всех.
    while (queue.length && gates.some((gate) => !gate.truck)) {
      const [next, ...rest] = queue;
      queue = rest;
      let placed = false;
      gates = gates.map((gate) => {
        if (placed || gate.truck) return gate;
        placed = true;
        return { ...gate, truck: next };
      });
    }
    return { ...state, gates, queue, schedule };
  }

  function ageWaiting(state, seconds) {
    const queue = state.queue.map((truck) => ({ ...truck, waitedSeconds: truck.waitedSeconds + seconds }));
    const gates = state.gates.map((gate) => (gate.truck
      ? { ...gate, truck: { ...gate.truck, waitedSeconds: gate.truck.waitedSeconds + seconds } }
      : gate));
    return { ...state, gates, queue };
  }

  function ageBuffer(state, seconds) {
    const spoiled = [];
    const buffer = [];
    for (const pallet of state.buffer) {
      /* Ни на секунде приезда, ни на секунде размещения паллета не стареет:
         обе спорные секунды отдаём игроку, иначе срок начинает течь ещё до
         того, как паллету вообще можно взять. */
      if (pallet.shelf === null || pallet.enteredAt === state.elapsed) {
        buffer.push(pallet);
        continue;
      }
      const shelf = pallet.shelf - seconds;
      if (shelf > 0) {
        buffer.push({ ...pallet, shelf });
        continue;
      }
      spoiled.push({ ...pallet, shelf: 0, reason: 'shelf' });
    }
    if (!spoiled.length) return { ...state, buffer };
    /* Паллета, которая тухнет прямо на тележке, забирает с собой и действие:
       довезти уже нечего. */
    const carrying = state.busy?.kind === 'putaway' && spoiled.some((pallet) => pallet.id === state.busy.palletId);
    return {
      ...state,
      buffer,
      busy: carrying ? null : state.busy,
      spoiled: [...state.spoiled, ...spoiled],
      feedback: { kind: 'error', code: 'spoiled', message: `${nameOf(spoiled[0])} испортился в буфере.` },
    };
  }

  const nameOf = (pallet) => engine.itemBySku(pallet.sku)?.name || pallet.sku;

  function completeBusy(state) {
    const busy = state.busy;
    if (!busy || state.elapsed < busy.endsAt) return state;
    if (busy.kind === 'walk') return { ...state, station: busy.to, busy: null };
    if (busy.kind === 'unload') return completeUnload({ ...state, busy: null }, busy);
    if (busy.kind === 'putaway') return completePutaway({ ...state, busy: null }, busy);
    return { ...state, busy: null };
  }

  function completeUnload(state, busy) {
    const gate = state.gates.find((item) => item.id === busy.gateId);
    if (!gate?.truck) return state;
    const shelf = shelfFor(gate.truck.zone);
    const pallet = {
      id: `pallet-${gate.truck.id}`,
      sku: gate.truck.sku,
      zone: gate.truck.zone,
      quantity: gate.truck.quantity,
      supplier: gate.truck.supplier,
      shelf,
      shelfMax: shelf,
      enteredAt: state.elapsed,
    };
    return {
      ...state,
      gates: state.gates.map((item) => (item.id === busy.gateId ? { ...item, truck: null } : item)),
      buffer: [...state.buffer, pallet],
      feedback: { kind: 'info', code: 'unloaded', message: `${nameOf(pallet)} в буфере.` },
    };
  }

  function completePutaway(state, busy) {
    const pallet = state.buffer.find((item) => item.id === busy.palletId);
    if (!pallet) return state;
    const buffer = state.buffer.filter((item) => item.id !== busy.palletId);
    if (busy.zone !== pallet.zone) {
      return {
        ...state,
        buffer,
        spoiled: [...state.spoiled, { ...pallet, reason: 'wrong-zone' }],
        feedback: { kind: 'error', code: 'wrong-zone', message: `${nameOf(pallet)} простоял в чужой температуре — списан.` },
      };
    }
    /* Бонус за скорость: скоропорт, доставленный до половины срока, — это и
       есть «быстрая обработка», за которую хочется давать очки. */
    const fast = pallet.shelfMax !== null && pallet.shelf > pallet.shelfMax / 2;
    return {
      ...state,
      buffer,
      stored: [...state.stored, { ...pallet, fast }],
      bonusFresh: state.bonusFresh + (fast ? 1 : 0),
      feedback: { kind: 'success', code: 'stored', message: `${nameOf(pallet)} на месте.` },
    };
  }

  function goalsFor(state) {
    const backlog = backlogOf(state);
    const perished = state.spoiled.filter((pallet) => isPerishable(pallet.zone));
    return [
      {
        id: 'backlog',
        text: `Бэклог к концу смены — не больше ${state.settings.backlogLimit} паллет`,
        value: backlog,
        limit: state.settings.backlogLimit,
        ok: backlog <= state.settings.backlogLimit,
      },
      {
        id: 'perishables',
        text: 'Ни одной списанной паллеты со скоропортом',
        value: perished.length,
        limit: 0,
        ok: perished.length === 0,
      },
    ];
  }

  function finish(state) {
    const goals = goalsFor(state);
    return {
      ...state,
      phase: 'report',
      busy: null,
      report: {
        stored: state.stored.length,
        spoiled: state.spoiled.length,
        backlog: backlogOf(state),
        bonusFresh: state.bonusFresh,
        goals,
        success: goals.every((goal) => goal.ok),
      },
    };
  }

  function tick(state, seconds = 1) {
    if (state.phase !== 'running') return state;
    let next = { ...state, elapsed: state.elapsed + seconds, secondsRemaining: Math.max(0, state.secondsRemaining - seconds), feedback: null };
    next = admitArrivals(next);
    /* Действие завершается раньше, чем стареет буфер: паллета, размещённая
       на той же секунде, на которой истекал её срок, считается спасённой.
       Спорные секунды — в пользу игрока. */
    next = completeBusy(next);
    next = ageBuffer(next, seconds);
    next = ageWaiting(next, seconds);
    if (next.secondsRemaining === 0) next = finish(next);
    return next;
  }

  const refuse = (state, code, message) => ({ ...state, feedback: { kind: 'error', code, message } });

  function goTo(state, station) {
    if (state.phase !== 'running') return state;
    if (state.busy) return refuse(state, 'busy', 'Сначала закончите текущее действие.');
    if (state.station === station) return state;
    return { ...state, busy: { kind: 'walk', to: station, startedAt: state.elapsed, endsAt: state.elapsed + DURATIONS.walk } };
  }

  function unload(state, gateId) {
    if (state.phase !== 'running') return state;
    if (state.busy) return refuse(state, 'busy', 'Сначала закончите текущее действие.');
    if (state.station !== STATIONS.RECEIVING) return refuse(state, 'wrong-station', 'Разгрузить можно только на приёмке.');
    const gate = state.gates.find((item) => item.id === gateId);
    if (!gate?.truck) return refuse(state, 'empty-gate', 'На этом гейте никого нет.');
    /* Буфер может заполниться только другой разгрузкой, а одновременно
       игрок делает одно действие — поэтому проверки на старте достаточно. */
    if (!bufferHasRoom(state)) return refuse(state, 'buffer-full', 'Буфер приёмки забит — сначала разместите паллеты.');
    return { ...state, busy: { kind: 'unload', gateId, startedAt: state.elapsed, endsAt: state.elapsed + DURATIONS.unload } };
  }

  function putaway(state, palletId, zone) {
    if (state.phase !== 'running') return state;
    if (state.busy) return refuse(state, 'busy', 'Сначала закончите текущее действие.');
    if (state.station !== STATIONS.PUTAWAY) return refuse(state, 'wrong-station', 'Размещать можно только на размещении.');
    const pallet = state.buffer.find((item) => item.id === palletId);
    if (!pallet) return refuse(state, 'unknown-pallet', 'Этой паллеты уже нет в буфере.');
    return { ...state, busy: { kind: 'putaway', palletId, zone, startedAt: state.elapsed, endsAt: state.elapsed + DURATIONS.putaway } };
  }

  return {
    STATIONS,
    SHELF_SECONDS,
    DURATIONS,
    DEFAULTS,
    createFlowShift,
    tick,
    goTo,
    unload,
    putaway,
    goalsFor,
    backlogOf,
    isPerishable,
    shelfFor,
    nameOf,
  };
});

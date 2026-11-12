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
     наполняется, скоропорт тухнет, фургоны дарксторов ждут и уезжают — и всё
     это идёт, пока игрок занят другой станцией. Без этого переключение
     между станциями было бы меню.

     Станций четыре, и это полный путь паллеты через склад:
       приёмка    — разгрузить фуру в буфер;
       размещение — отвезти паллету из буфера в зону (выбрать зону самому);
       отбор      — достать паллету из зоны под фургон даркстора;
       погрузка   — поставить её в фургон, пока тот не ушёл.
     Первый срез режима состоял только из первых двух: товар принимали, и на
     этом он пропадал. Теперь то, что не принято и не размещено, нечем
     отгрузить — половины склада держатся друг за друга. */

  const STATIONS = Object.freeze({ RECEIVING: 'receiving', PUTAWAY: 'putaway', PICKING: 'picking', LOADING: 'loading' });

  /* Часы свежести идут, только пока паллета вне своей температуры — то есть
     в буфере приёмки и на тележке. Встала в зону — часы встали, а на гейте
     ещё не пошли: время начинает течь с разгрузки, и потому «не разгружай
     то, что не успеешь развезти» — это решение игрока, а не невезение.
     Сроки подобраны так, что развоз батча из четырёх (20 с) заморозку уже
     не спасает, а из двух (10 с) — спасает: отсюда и выбор, сколько брать
     за один заход. Сухач не портится вовсе и потому соблазняет — возить его
     безопасно, а время он съедает то же самое. */
  const SHELF_SECONDS = Object.freeze({ dry: null, chilled: 20, frozen: 14 });

  /* Отобранная паллета снова вне своей температуры — в зоне отгрузки часы
     свежести идут заново с полного срока. Поэтому дилемма батча повторяется
     на выходе: собрать две паллеты за заход выгоднее по ходьбе, но вторая
     заморозка погрузки может не дождаться. */
  const DURATIONS = Object.freeze({ walk: 2, unload: 3, putaway: 5, pick: 4, load: 3 });

  // Куда едут фургоны. Имена дарксторов экран берёт из данных кампании.
  const STORE_IDS = Object.freeze(['north', 'central', 'west', 'east']);

  const SUPPLIERS = Object.freeze(['Аквалайн', 'Молочный дом', 'Фрутлайн', 'Хлебзавод №3', 'Полюс']);

  const DEFAULTS = Object.freeze({
    seconds: 240,
    gates: 3,
    bufferSlots: 4,
    stagingSlots: 3,
    firstArrivalAt: 2,
    /* Темп прибытия — это и есть сложность смены. Числа подобраны перебором
       на двухстах сменах для двух игроков, см. tests/flow-balance.test.js.
       Мерили не бота, который жмёт мгновенно, а игрока с секундой и двумя
       на каждое решение: умелый проходит 92% и 75% смен, небрежный — 13% и
       4%. При ровном потоке без волн такого зазора не получалось вовсе. */
    minGap: 48,
    maxGap: 60,
    // Сколько фур может прийти одной волной и с каким шагом внутри неё.
    waveMax: 3,
    waveSpacing: 2,
    /* Стартовый запас: без него первые полминуты на отборе и погрузке
       делать было бы нечего, и две станции из четырёх стояли бы пустыми. */
    initialStock: 3,
    /* Фургон за товаром приезжает через orderDelay после фуры, которая этот
       товар привезла, и ждёт patience секунд. Так заявка всегда выполнима,
       если фуру вовремя приняли и разместили. */
    orderDelayMin: 30,
    orderDelayMax: 42,
    patience: 60,
    missedLimit: 2,
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

  /* Фуры приходят волнами: одна-три почти разом, потом пауза. Ровный поток
     давал выбор только между «смена на пределе бота» и «человек не успевает
     вовсе»: симуляция с секундой на реакцию проваливала любую смену, где
     бот проходил вплотную. Волна оставляет запас по среднему темпу и при
     этом ставит вопрос, ради которого режим существует: что спасать первым,
     когда всё пришло одновременно. */
  function buildSchedule(rand, options) {
    const items = Object.values(engine.ITEMS);
    const schedule = [];
    let at = options.firstArrivalAt;
    let number = 0;
    /* Последние секунды смены фуру не присылаем: разгрузить и разместить её
       уже не успеть, и это была бы не сложность, а обман. */
    const lastArrival = options.seconds - (DURATIONS.unload + DURATIONS.putaway + DURATIONS.walk);
    while (at <= lastArrival) {
      const size = 1 + Math.floor(rand() * options.waveMax);
      for (let index = 0; index < size && at + index * options.waveSpacing <= lastArrival; index += 1) {
        const item = pick(rand, items);
        number += 1;
        schedule.push({
          id: `truck-${number}`,
          at: at + index * options.waveSpacing,
          supplier: pick(rand, SUPPLIERS),
          sku: item.sku,
          zone: item.zone,
          quantity: 2 + Math.floor(rand() * 4),
        });
      }
      at += options.minGap + Math.floor(rand() * (options.maxGap - options.minGap + 1));
    }
    return schedule;
  }

  /* Стартовый запас и расписание фургонов. Каждый фургон — заявка на одну
     паллету конкретного товара: либо из стартового запаса, либо того, что
     привезла фура. Лишнего спроса нет — склад в равновесии, и сорванная
     заявка всегда значит, что её товар не довели до зоны или до кузова. */
  function buildOutbound(rand, options, schedule) {
    const items = Object.values(engine.ITEMS);
    const stock = [];
    const orders = [];
    const lastOrderAt = options.seconds - (DURATIONS.walk * 2 + DURATIONS.pick + DURATIONS.load + 6);
    const push = (at, item) => {
      if (at > lastOrderAt) return;
      orders.push({
        id: `van-${orders.length + 1}`,
        at,
        storeId: pick(rand, STORE_IDS),
        sku: item.sku,
        zone: item.zone,
      });
    };
    for (let index = 0; index < options.initialStock; index += 1) {
      const item = pick(rand, items);
      stock.push({ id: `stock-${index + 1}`, sku: item.sku, zone: item.zone, quantity: 2 + Math.floor(rand() * 4), supplier: 'Запас' });
      push(6 + index * 9 + Math.floor(rand() * 4), item);
    }
    for (const truck of schedule) {
      const delay = options.orderDelayMin + Math.floor(rand() * (options.orderDelayMax - options.orderDelayMin + 1));
      push(truck.at + delay, { sku: truck.sku, zone: truck.zone });
    }
    orders.sort((left, right) => left.at - right.at);
    return { stock, orders };
  }

  function createFlowShift(options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const rand = rngFrom(settings.seed ?? 20260920);
    const schedule = buildSchedule(rand, settings);
    const outbound = buildOutbound(rand, settings, schedule);
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
      schedule,
      // Паллеты, которые стоят в своих зонах и доступны для отбора.
      stock: outbound.stock,
      // Зона отгрузки: отобранные паллеты, ещё не погруженные.
      staging: [],
      // Фургоны дарксторов у ворот отгрузки: каждый ждёт одну паллету.
      vans: [],
      orderSchedule: outbound.orders,
      shipped: [],
      missed: [],
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

  const stagedOf = (state, sku) => state.staging.filter((pallet) => pallet.sku === sku).length;
  const wantedOf = (state, sku) => state.vans.filter((van) => van.sku === sku).length;
  const stagingHasRoom = (state) => state.staging.length < state.settings.stagingSlots;

  function admitVans(state) {
    const due = state.orderSchedule.filter((order) => order.at <= state.elapsed);
    if (!due.length) return state;
    return {
      ...state,
      vans: [...state.vans, ...due.map((order) => ({ ...order, arrivedAt: state.elapsed, dueAt: state.elapsed + state.settings.patience }))],
      orderSchedule: state.orderSchedule.filter((order) => order.at > state.elapsed),
    };
  }

  /* Отобранная паллета без фургона возвращается в зону сама. Иначе сухая
     паллета, чей фургон ушёл, занимала бы слот зоны отгрузки до конца
     смены, и исправить это было бы нечем. */
  function returnSurplus(state) {
    let stock = state.stock;
    const staging = [];
    const kept = new Map();
    for (const pallet of state.staging) {
      const keep = (kept.get(pallet.sku) || 0) < wantedOf(state, pallet.sku);
      const loading = state.busy?.kind === 'load' && state.busy.palletId === pallet.id;
      if (keep || loading) {
        kept.set(pallet.sku, (kept.get(pallet.sku) || 0) + 1);
        staging.push(pallet);
      } else stock = [...stock, { id: pallet.id, sku: pallet.sku, zone: pallet.zone, quantity: pallet.quantity, supplier: pallet.supplier }];
    }
    return staging.length === state.staging.length ? state : { ...state, stock, staging };
  }

  /* Фургон ждёт до своего срока и уезжает пустым. Тот, в который прямо
     сейчас грузят, не уезжает: спорная секунда — в пользу игрока. */
  function expireVans(state) {
    const loadingVan = state.busy?.kind === 'load' ? state.busy.vanId : null;
    const gone = state.vans.filter((van) => van.dueAt <= state.elapsed && van.id !== loadingVan);
    if (!gone.length) return state;
    const goneIds = new Set(gone.map((van) => van.id));
    return returnSurplus({
      ...state,
      vans: state.vans.filter((van) => !goneIds.has(van.id)),
      missed: [...state.missed, ...gone],
      feedback: { kind: 'error', code: 'van-left', message: `Фургон ушёл без паллеты: ${nameOf(gone[0])}.` },
    });
  }

  // Зона отгрузки — тоже вне температуры: скоропорт в ней тухнет, как в буфере.
  function ageStaging(state, seconds) {
    const spoiled = [];
    const staging = [];
    for (const pallet of state.staging) {
      if (pallet.shelf === null || pallet.enteredAt === state.elapsed) {
        staging.push(pallet);
        continue;
      }
      const shelf = pallet.shelf - seconds;
      if (shelf > 0) staging.push({ ...pallet, shelf });
      else spoiled.push({ ...pallet, shelf: 0, reason: 'staging' });
    }
    if (!spoiled.length) return { ...state, staging };
    const carrying = state.busy?.kind === 'load' && spoiled.some((pallet) => pallet.id === state.busy.palletId);
    return {
      ...state,
      staging,
      busy: carrying ? null : state.busy,
      spoiled: [...state.spoiled, ...spoiled],
      feedback: { kind: 'error', code: 'spoiled', message: `${nameOf(spoiled[0])} испортился в зоне отгрузки.` },
    };
  }

  const nameOf = (pallet) => engine.itemBySku(pallet.sku)?.name || pallet.sku;

  function completeBusy(state) {
    const busy = state.busy;
    if (!busy || state.elapsed < busy.endsAt) return state;
    if (busy.kind === 'walk') return { ...state, station: busy.to, busy: null };
    if (busy.kind === 'unload') return completeUnload({ ...state, busy: null }, busy);
    if (busy.kind === 'putaway') return completePutaway({ ...state, busy: null }, busy);
    if (busy.kind === 'pick') return completePick({ ...state, busy: null }, busy);
    if (busy.kind === 'load') return completeLoad({ ...state, busy: null }, busy);
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
      // С этой секунды паллету можно отобрать под фургон.
      stock: [...state.stock, { id: pallet.id, sku: pallet.sku, zone: pallet.zone, quantity: pallet.quantity, supplier: pallet.supplier }],
      bonusFresh: state.bonusFresh + (fast ? 1 : 0),
      feedback: { kind: 'success', code: 'stored', message: `${nameOf(pallet)} на месте.` },
    };
  }

  function completePick(state, busy) {
    const pallet = state.stock.find((item) => item.id === busy.palletId);
    if (!pallet) return state;
    const shelf = shelfFor(pallet.zone);
    const staged = { ...pallet, shelf, shelfMax: shelf, enteredAt: state.elapsed };
    /* Фургон мог уйти, пока паллету везли. Тогда она возвращается в зону
       тем же правилом, что и любая отобранная паллета без фургона. */
    return returnSurplus({
      ...state,
      stock: state.stock.filter((item) => item.id !== busy.palletId),
      staging: [...state.staging, staged],
      feedback: { kind: 'info', code: 'picked', message: `${nameOf(pallet)} в зоне отгрузки.` },
    });
  }

  function completeLoad(state, busy) {
    const pallet = state.staging.find((item) => item.id === busy.palletId);
    const van = state.vans.find((item) => item.id === busy.vanId);
    if (!pallet || !van) return state;
    return {
      ...state,
      staging: state.staging.filter((item) => item.id !== busy.palletId),
      vans: state.vans.filter((item) => item.id !== busy.vanId),
      shipped: [...state.shipped, { ...van, shippedAt: state.elapsed }],
      feedback: { kind: 'success', code: 'shipped', message: `${nameOf(pallet)} уехал в даркстор.` },
    };
  }

  function goalsFor(state) {
    const perished = state.spoiled.filter((pallet) => isPerishable(pallet.zone));
    return [
      {
        id: 'missed',
        text: `Сорвано заявок — не больше ${state.settings.missedLimit}`,
        value: state.missed.length,
        limit: state.settings.missedLimit,
        ok: state.missed.length <= state.settings.missedLimit,
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
        shipped: state.shipped.length,
        missed: state.missed.length,
        // Фургоны, которые ещё ждали в момент конца смены: не отгружены, но и не сорваны.
        waiting: state.vans.length,
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
    next = admitVans(next);
    /* Действие завершается раньше, чем стареет буфер и уходят фургоны:
       паллета, размещённая или погруженная на той же секунде, на которой
       истекал срок, считается спасённой. Спорные секунды — в пользу игрока. */
    next = completeBusy(next);
    next = ageBuffer(next, seconds);
    next = ageStaging(next, seconds);
    next = expireVans(next);
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

  function pickFor(state, vanId) {
    if (state.phase !== 'running') return state;
    if (state.busy) return refuse(state, 'busy', 'Сначала закончите текущее действие.');
    if (state.station !== STATIONS.PICKING) return refuse(state, 'wrong-station', 'Отбирать можно только на отборе.');
    const van = state.vans.find((item) => item.id === vanId);
    if (!van) return refuse(state, 'van-gone', 'Этот фургон уже ушёл.');
    // Одна паллета на фургон: вторую под ту же заявку отбирать незачем.
    if (stagedOf(state, van.sku) >= wantedOf(state, van.sku)) return refuse(state, 'already-picked', 'Паллета под эту заявку уже в зоне отгрузки.');
    const pallet = state.stock.find((item) => item.sku === van.sku);
    if (!pallet) return refuse(state, 'no-stock', `${nameOf(van)}: в зоне этого товара нет — сначала примите и разместите.`);
    if (!stagingHasRoom(state)) return refuse(state, 'staging-full', 'Зона отгрузки забита — сначала погрузите паллеты.');
    return { ...state, busy: { kind: 'pick', vanId, palletId: pallet.id, startedAt: state.elapsed, endsAt: state.elapsed + DURATIONS.pick } };
  }

  function load(state, vanId) {
    if (state.phase !== 'running') return state;
    if (state.busy) return refuse(state, 'busy', 'Сначала закончите текущее действие.');
    if (state.station !== STATIONS.LOADING) return refuse(state, 'wrong-station', 'Грузить можно только на погрузке.');
    const van = state.vans.find((item) => item.id === vanId);
    if (!van) return refuse(state, 'van-gone', 'Этот фургон уже ушёл.');
    // Самая срочная из подходящих паллет: она ближе всех к порче.
    const pallet = state.staging
      .filter((item) => item.sku === van.sku)
      .sort((left, right) => (left.shelf ?? Infinity) - (right.shelf ?? Infinity))[0];
    if (!pallet) return refuse(state, 'not-picked', `${nameOf(van)}: паллета ещё не отобрана.`);
    return { ...state, busy: { kind: 'load', vanId, palletId: pallet.id, startedAt: state.elapsed, endsAt: state.elapsed + DURATIONS.load } };
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
    pick: pickFor,
    load,
    goalsFor,
    stagedOf,
    wantedOf,
    STORE_IDS,
    backlogOf,
    isPerishable,
    shelfFor,
    nameOf,
  };
});

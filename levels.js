(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RyabinovayaLevels = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const dry = 'dry';
  const frozen = 'frozen';
  const chilled = 'chilled';

  const order = (id, storeId, zone, sku, quantity) => ({ id, storeId, zone, sku, quantity });
  const vehicle = (id, zone, capacity = 100) => ({ id, zone, capacity });
  const store = (id, zone) => ({ id, zone, acceptsFromSecond: 0 });
  const arrival = (id, zone, sku, quantity, supplier) => ({ id, zone, sku, quantity, supplier });

  /* Идентификаторы остаются географическими: по ним движок берёт координаты
     дарксторов для расчёта рейса. Меняются только вывески для игрока. */
  const STORE_NAMES = Object.freeze({
    north: 'Тушино',
    central: 'Косинская',
    west: 'Саларьево',
    east: 'Беломорская',
  });

  const ZONE_NAMES = Object.freeze({
    dry: 'Сухач',
    chilled: 'Охлаждёнка',
    frozen: 'Заморозка',
  });

  /* Зона на складе помечается температурой, а не словом: так её и подписывают
     на стеллажах, и такой значок читается на схеме без надписи. */
  const ZONE_MARKS = Object.freeze({
    dry: '+18°',
    chilled: '+4°',
    frozen: '−18°',
  });

  /* Шесть смен: четыре знакомят с правилами, две проверяют их на живом
     складе. Раньше правил было по одному на смену, и знакомство растягивалось
     на девять раундов, первые из которых проходились за пятнадцать секунд.
     Теперь обучающая смена несёт два родственных правила:
     отгрузка → приёмка и адреса → зоны на отборе и на размещении →
     маршрут и вместимость. Дальше правила не добавляются — меняется план:
     фура опаздывает, заявка растёт, заявку отменяют, и уже погруженное
     приходится снимать.
     newMechanic — имя смены для кода; teaches — правила, которые она вводит. */
  const LEVELS = [
    {
      id: 1,
      title: 'Первая заявка',
      newMechanic: 'one-order',
      teaches: ['one-order'],
      durationSeconds: 180,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry)],
      stores: [store('north', dry)],
      initialOrders: [order('order-north', 'north', dry, 'water', 2)],
      events: [],
      goal: 'Соберите паллету, погрузите её в фургон и закройте смену.',
      storyBefore: 'Добро пожаловать в центр «Рябиновая». Начнём с одной заявки.',
      storyAfter: 'Первая заявка закрыта. Теперь посмотрим, откуда на складе товар.',
    },
    {
      id: 2,
      title: 'Приёмка и два адреса',
      newMechanic: 'inbound-receive',
      teaches: ['inbound-receive', 'two-stores'],
      durationSeconds: 210,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry)],
      stores: [store('north', dry), store('west', dry)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 4),
        order('order-west', 'west', dry, 'bread', 3),
      ],
      inbound: [arrival('in-water', dry, 'water', 4, 'Аквалайн')],
      stock: { dry: { water: 0 } },
      events: [],
      goal: 'Примите воду с фуры, затем соберите две паллеты: одна паллета — один даркстор.',
      storyBefore: 'На приёмке стоит фура с водой, а на складе её нет. Сначала приёмка — потом отгрузка. И дарксторов теперь два.',
      storyAfter: 'Товар принят, оба адреса закрыты. Открываем холодные зоны.',
    },
    {
      id: 3,
      title: 'Три зоны',
      newMechanic: 'three-zones',
      teaches: ['three-zones', 'inbound-sorting'],
      durationSeconds: 270,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', frozen), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-central', 'central', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      inbound: [
        arrival('in-milk', chilled, 'milk', 2, 'Молочный дом'),
        arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат'),
        arrival('in-water', dry, 'water', 2, 'Аквалайн'),
      ],
      stock: { dry: { water: 0 }, chilled: { milk: 0 }, frozen: { 'ice-cream': 0 } },
      events: [],
      goal: 'Разместите каждую поставку в её зоне и отправьте каждую заявку своим фургоном.',
      storyBefore: 'Склад растёт: сухач, охлаждёнка и заморозка. Три фуры на приёмке — смотрите на зону в накладной: чужая температура портит товар.',
      storyAfter: 'Три зоны работают без потерь. Дальше — дорога.',
    },
    {
      id: 4,
      title: 'Маршрут и кузов',
      newMechanic: 'route-capacity',
      teaches: ['route', 'capacity'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', dry), store('east', chilled)],
      /* Вода не влезает ни в паллету, ни в одну машину: 96 кг уходят первым
         фургоном, остаток — вторым, и туда же попадают ещё два адреса.
         Так вторая машина собирает три остановки в порядке погрузки, а он
         длиннее лучшего, — оба правила смены встречаются в одном кузове. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 10),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west', 'west', dry, 'bread', 3),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [],
      goal: '120 кг воды не влезут в одну паллету — разделите заявку. Потом сократите рейс второго фургона.',
      storyBefore: 'Тушино заказало десять упаковок воды: паллета держит 100 кг, фургон — тоже. А второй фургон объедет три адреса, и порядок остановок решает, успеет ли он вовремя.',
      storyAfter: 'Заявка разошлась по двум машинам, рейс сокращён. Правила вы знаете — теперь план начнёт меняться.',
    },
    {
      id: 5,
      title: 'План меняется',
      newMechanic: 'dynamic-demand',
      teaches: ['dynamic-demand', 'late-delivery', 'cancellation'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('east', chilled), store('central', frozen)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-west', 'west', dry, 'bread', 2),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-central', 'central', frozen, 'ice-cream', 2),
      ],
      stock: { frozen: { 'ice-cream': 0 } },
      /* События привязаны к прогрессу, а не к секундам: смену можно закрыть
         за минуту, и расписание по таймеру никогда не срабатывало.
         Мороженого на складе нет — фура с ним опаздывает; заявка Саларьево
         вырастает; Тушино отменяет заявку, когда её паллета уже в кузове,
         и её приходится снять. */
      events: [
        { type: 'pallet-arrived', afterLoadedPallets: 1, pallet: arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат') },
        { type: 'demand-increase', orderId: 'order-west', quantity: 2, afterLoadedPallets: 2 },
        { type: 'order-cancelled', orderId: 'order-north', afterLoadedPallets: 3 },
      ],
      goal: 'Следите за ТСД: фура опоздает, одна заявка вырастет, другую отменят. Отменённое снимите с фургона.',
      storyBefore: 'Диспетчер предупреждает: фура с мороженым в пути, а дарксторы сегодня меняют заявки на ходу. Лишний груз в кузове — это деньги и точность.',
      storyAfter: 'Вы перестроили план на ходу и не повезли лишнего. Осталась смена в час пик.',
    },
    {
      id: 6,
      title: 'Час пик',
      newMechanic: 'exam',
      teaches: ['exam'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', frozen), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 10),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west-bread', 'west', dry, 'bread', 3),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-east-banana', 'east', chilled, 'banana', 3),
        order('order-west', 'west', frozen, 'ice-cream', 2),
      ],
      inbound: [arrival('in-banana', chilled, 'banana', 3, 'Фрутлайн')],
      stock: { chilled: { banana: 0 }, frozen: { 'ice-cream': 0 } },
      events: [
        { type: 'pallet-arrived', afterLoadedPallets: 2, pallet: arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат') },
        { type: 'demand-increase', orderId: 'order-central', quantity: 2, afterLoadedPallets: 3 },
        { type: 'order-cancelled', orderId: 'order-east', afterLoadedPallets: 6 },
      ],
      goal: 'Закройте все заявки: приёмка, зоны, вместимость, маршрут и перемены плана действуют сразу.',
      storyBefore: 'Час пик: бананы на приёмке, мороженое в пути, вода не влезает в кузов, а дарксторы меняют заявки. Всё, что вы умеете, — одновременно.',
      storyAfter: 'Час пик пройден. Центр «Рябиновая» готов к потоку.',
    },
  ];

  return { LEVELS, STORE_NAMES, ZONE_NAMES, ZONE_MARKS };
});

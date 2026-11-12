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

  /* Десять смен: две вводные и восемь рабочих. Вводные ведёт карточка
     «Сейчас»: первая показывает сборку и погрузку, вторая — всё остальное
     разом: приёмку, зоны, адреса и порядок остановок. Раньше знакомство
     занимало девять, потом четыре раунда, и первые проходились за
     пятнадцать секунд. С третьей смены подсказок нет, и у каждой свой
     поворот: кузов не вмещает заявку, фура опаздывает, заявки растут,
     заявки отменяют, фургон ещё в рейсе, рейсы длинные — и под конец всё
     это вместе.
     newMechanic — имя смены для кода; teaches — что она вводит.
     guided: false — смена без поводыря: карточка «Сейчас» молчит, объекты
     не подсвечиваются, вместо них под схемой лежит доска заявок.
     События привязаны к прогрессу (afterLoadedPallets), а не к секундам:
     смену можно закрыть за минуту, и расписание по таймеру не наступало.
     У приездов есть запасной срок (orAtSecond) — для того, кто ждёт.
     departures — когда фургон уходит в рейс, в секундах от начала смены.
     Задания на сменах без поводыря выдаёт ТСД в порядке списка заявок, и
     про уход фургонов он не знает: заявка уходящего фургона нарочно стоит
     за длинными, чтобы до неё приходилось добираться отложениями. Времена
     подобраны на двух игроках, см. tests/task-queue.test.js. */
  const late = (afterLoadedPallets, orAtSecond, pallet) => ({ type: 'pallet-arrived', afterLoadedPallets, orAtSecond, pallet });
  const more = (afterLoadedPallets, orderId, quantity) => ({ type: 'demand-increase', orderId, quantity, afterLoadedPallets });
  const cancel = (afterLoadedPallets, orderId) => ({ type: 'order-cancelled', orderId, afterLoadedPallets });

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
      storyAfter: 'Первая заявка закрыта. Следующая смена — уже настоящая: приёмка, три зоны и дорога.',
    },
    {
      id: 2,
      title: 'Три зоны и маршрут',
      newMechanic: 'inbound-receive',
      teaches: ['inbound-receive', 'two-stores', 'three-zones', 'inbound-sorting', 'route'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('central', dry), store('east', chilled)],
      /* Одна большая вводная вместо четырёх. Три фуры на приёмке — три
         решения о зоне, которые никто не подскажет. Сухой фургон собирает
         три адреса в порядке погрузки, а он длиннее лучшего. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 4),
        order('order-west', 'west', dry, 'bread', 3),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-central-ice', 'central', frozen, 'ice-cream', 2),
      ],
      inbound: [
        arrival('in-water', dry, 'water', 4, 'Аквалайн'),
        arrival('in-milk', chilled, 'milk', 2, 'Молочный дом'),
        arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат'),
      ],
      stock: { dry: { water: 0 }, chilled: { milk: 0 }, frozen: { 'ice-cream': 0 } },
      events: [],
      goal: 'Примите три фуры и сами решите, что в какую зону. Потом соберите заявки и сократите рейс сухого фургона.',
      storyBefore: 'На приёмке три фуры, а на складе этого товара нет: сначала приёмка, потом отгрузка. Какому товару какая температура — решайте сами, чужая зона портит паллету. Одна паллета — один даркстор.',
      storyAfter: 'Правила вы знаете. Дальше подсказок не будет: заявки — на доске под схемой, а у каждой смены свой поворот.',
    },
    {
      id: 3,
      title: 'Полный кузов',
      guided: false,
      newMechanic: 'capacity',
      teaches: ['capacity'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', dry), store('east', chilled)],
      /* Вода не влезает ни в паллету, ни в одну машину: 96 кг уходят первым
         фургоном, остаток — вторым, и туда же попадают ещё два адреса. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 10),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west', 'west', dry, 'bread', 3),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [],
      // Молоко — последнее в очереди, а его фургон уходит первым.
      departures: { 'chilled-1': 55 },
      goal: 'Задания приходят на ТСД по одному. Фургон охлаждёнки уходит через 55 секунд — терминал об этом не знает.',
      storyBefore: 'Дальше работу выдаёт ТСД: задание можно принять или отложить, но отложений на смену три. Тушино заказало 120 кг воды — паллета и фургон держат по 100, заявку придётся делить. А фургон охлаждёнки уходит в рейс через 55 секунд, и молоко терминал поставил последним.',
      storyAfter: 'Заявка разошлась по двум машинам. Дальше товар будет приезжать не к началу смены.',
    },
    {
      id: 4,
      title: 'Фура в пути',
      guided: false,
      newMechanic: 'late-delivery',
      teaches: ['late-delivery'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('east', chilled), store('central', frozen)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-west', 'west', dry, 'bread', 2),
        order('order-east-banana', 'east', chilled, 'banana', 3),
        order('order-central', 'central', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      inbound: [arrival('in-banana', chilled, 'banana', 3, 'Фрутлайн')],
      stock: { chilled: { banana: 0, milk: 0 }, frozen: { 'ice-cream': 0 } },
      events: [
        late(1, 30, arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат')),
        late(3, 60, arrival('in-milk', chilled, 'milk', 2, 'Молочный дом')),
      ],
      goal: 'Бананы уже на приёмке, мороженое и молоко ещё едут. Приехавшая фура приходит на ТСД срочным заданием.',
      storyBefore: 'Сегодня товар приезжает по ходу смены: бананы стоят у ворот, а фуры с мороженым и молоком в пути. Доска заявок скажет, чего ещё нет на складе.',
      storyAfter: 'Фуры приняты, заявки закрыты. Теперь меняться начнут сами заявки.',
    },
    {
      id: 5,
      title: 'Дозаказ',
      guided: false,
      newMechanic: 'dynamic-demand',
      teaches: ['dynamic-demand'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('chilled-1', chilled), vehicle('frozen-1', frozen)],
      stores: [store('north', dry), store('west', dry), store('central', dry), store('east', chilled)],
      /* Первый дозаказ делает воду тяжелее паллеты: добор уходит вторым
         фургоном, и за ним туда же встают остальные сухие адреса.
         Мороженое стоит в очереди последним, а каждый дозаказ терминал
         считает срочным и ставит перед ним — пока фургон заморозки уходит. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 6),
        order('order-west', 'west', dry, 'bread', 2),
        order('order-central', 'central', dry, 'bread', 3),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-central-ice', 'central', frozen, 'ice-cream', 2),
      ],
      events: [
        more(1, 'order-north', 4),
        more(4, 'order-west', 2),
        more(6, 'order-east', 3),
      ],
      departures: { 'frozen-1': 85 },
      goal: 'Каждый дозаказ терминал считает срочным и ставит первым. А фургон заморозки уходит через 1:25.',
      storyBefore: 'Дарксторы сегодня дозаказывают прямо во время смены, и каждый дозаказ приходит на ТСД срочным — впереди всего остального. Мороженое в очереди последнее, а его фургон уходит через минуту двадцать пять.',
      storyAfter: 'Все дозаказы уехали. А теперь заявки начнут не расти, а исчезать.',
    },
    {
      id: 6,
      title: 'Отмена',
      guided: false,
      newMechanic: 'cancellation',
      teaches: ['cancellation'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', dry), store('east', chilled)],
      /* Отменяют то, что уже погружено: первую заявку смены и молоко. Груз
         отменённой заявки едет мёртвым весом, пока его не снимут. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 3),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west', 'west', dry, 'bread', 3),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-east-ice', 'east', frozen, 'ice-cream', 2),
      ],
      events: [
        cancel(3, 'order-north'),
        // Четыре, а не пять: снятая паллета уменьшает счёт погруженных.
        cancel(4, 'order-east'),
      ],
      departures: { 'frozen-1': 65 },
      goal: 'Отмена приходит срочным заданием «снять паллету». Фургон заморозки уходит через 1:05 — что важнее, решать вам.',
      storyBefore: 'Сегодня дарксторы отменяют заявки. Паллета отменённой заявки в кузове едет зря, и терминал срочно требует её снять. Но снять можно и позже — а фургон заморозки уходит через минуту пять и ждать не будет.',
      storyAfter: 'Лишнего вы не повезли. Следующая смена — без одного фургона.',
    },
    {
      id: 7,
      title: 'Фургон в рейсе',
      guided: false,
      newMechanic: 'late-vehicle',
      teaches: ['late-vehicle'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('central', dry), store('east', chilled)],
      /* Сухого груза на 150 кг, а готов один фургон на 100. Вода забирает
         его почти целиком, хлеб ждёт второй — тот вернётся из рейса после
         трёх погрузок или через сорок секунд. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 8),
        order('order-west', 'west', dry, 'bread', 5),
        order('order-central', 'central', dry, 'bread', 4),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-north-ice', 'north', frozen, 'ice-cream', 2),
      ],
      events: [{ type: 'vehicle-ready', vehicleId: 'dry-2', afterLoadedPallets: 3, orAtSecond: 40 }],
      goal: 'Второй сухой фургон ещё в рейсе. Загрузите то, что можно увезти сейчас, остальное — когда он вернётся.',
      storyBefore: 'Сухого груза сегодня на полтора фургона, а у ворот стоит один: второй вернётся из рейса позже. Не всё, что собрано, получится погрузить сразу.',
      storyAfter: 'Оба фургона ушли полными. Дальше — длинные рейсы.',
    },
    {
      id: 8,
      title: 'Большой развоз',
      guided: false,
      newMechanic: 'long-routes',
      teaches: ['long-routes'],
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('chilled-1', chilled), vehicle('frozen-1', frozen)],
      stores: [store('north', dry), store('east', dry), store('west', dry), store('central', dry)],
      /* Восемь мелких заявок: сухой фургон объезжает все четыре адреса,
         охлаждёнка — три. Порядок погрузки у обоих далёк от лучшего. */
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-east', 'east', dry, 'bread', 2),
        order('order-west', 'west', dry, 'bread', 2),
        order('order-central', 'central', dry, 'water', 2),
        order('order-north-banana', 'north', chilled, 'banana', 2),
        order('order-west-milk', 'west', chilled, 'milk', 2),
        order('order-east-milk', 'east', chilled, 'milk', 2),
        order('order-central-ice', 'central', frozen, 'ice-cream', 2),
      ],
      events: [],
      // Уехавшему фургону порядок остановок уже не поменять.
      departures: { 'chilled-1': 95 },
      goal: 'Восемь заявок, до четырёх остановок в рейсе. Фургон охлаждёнки уходит через 1:35 — после этого его маршрут не поправить.',
      storyBefore: 'Много мелких заявок по всему городу. Фургон едет по адресам в том порядке, в каком вы грузили, и это почти никогда не лучший порядок. Охлаждёнка уходит через полторы минуты: к этому времени её надо и загрузить, и выстроить ей маршрут.',
      storyAfter: 'Рейсы сокращены. Осталось сложить всё вместе.',
    },
    {
      id: 9,
      title: 'План меняется',
      guided: false,
      newMechanic: 'mixed-plan',
      teaches: ['mixed-plan'],
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
      events: [
        late(1, 30, arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат')),
        more(2, 'order-west', 2),
        cancel(3, 'order-north'),
      ],
      departures: { 'frozen-1': 60 },
      goal: 'Фура с мороженым опоздает, а фургон заморозки уйдёт через минуту. Дозаказ и отмена придут срочными.',
      storyBefore: 'Сегодня всё сразу: фура с мороженым в пути, дарксторы дозаказывают и отменяют на ходу. Фургон заморозки уходит через минуту — мороженое надо успеть и принять, и собрать.',
      storyAfter: 'Вы перестроили план на ходу и не повезли лишнего. Осталась смена в час пик.',
    },
    {
      id: 10,
      title: 'Час пик',
      guided: false,
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
        order('order-west', 'west', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
        order('order-east-banana', 'east', chilled, 'banana', 3),
      ],
      inbound: [arrival('in-banana', chilled, 'banana', 3, 'Фрутлайн')],
      stock: { chilled: { banana: 0 }, frozen: { 'ice-cream': 0 } },
      events: [
        late(2, 45, arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат')),
        more(3, 'order-central', 2),
        cancel(7, 'order-east'),
      ],
      departures: { 'frozen-1': 85 },
      goal: 'Всё сразу — и фургон заморозки уходит через 1:25. Три отложения на всю смену.',
      storyBefore: 'Час пик: бананы на приёмке, мороженое в пути, вода не влезает в кузов, а дарксторы меняют заявки. Всё, что вы умеете, — одновременно.',
      storyAfter: 'Час пик пройден. Центр «Рябиновая» готов к потоку.',
    },
  ];

  return { LEVELS, STORE_NAMES, ZONE_NAMES, ZONE_MARKS };
});

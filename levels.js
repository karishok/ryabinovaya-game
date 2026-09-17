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

  const STORE_NAMES = Object.freeze({
    north: 'Северный',
    central: 'Центральный',
    west: 'Западный',
    east: 'Восточный',
  });

  const ZONE_NAMES = Object.freeze({
    dry: 'Сухач',
    chilled: 'Охлаждёнка',
    frozen: 'Заморозка',
  });

  /* Порядок уровней — это порядок правил, а не порядок цифр. Каждая смена
     добавляет ровно одно правило и держит остальные включёнными:
     отгрузка → приёмка → адреса → зоны → размещение по зонам → маршрут →
     вместимость → изменение заявки → всё сразу.
     Приёмка стоит второй, потому что без неё непонятно, откуда на складе
     берётся товар; размещение по зонам (5) повторяет правило зон (4) на
     входящем потоке, где ошибка уже стоит испорченной паллеты. */
  const LEVELS = [
    {
      id: 1,
      title: 'Один заказ',
      newMechanic: 'one-order',
      durationSeconds: 180,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry)],
      stores: [store('north', dry)],
      initialOrders: [order('order-north', 'north', dry, 'water', 2)],
      events: [],
      goal: 'Соберите и отправьте одну паллету в даркстор.',
      storyBefore: 'Добро пожаловать в центр «Рябиновая». Начнём с одной заявки.',
      storyAfter: 'Первая заявка закрыта. Теперь посмотрим, откуда на складе товар.',
    },
    {
      id: 2,
      title: 'Приёмка',
      newMechanic: 'inbound-receive',
      durationSeconds: 210,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry)],
      stores: [store('north', dry)],
      initialOrders: [order('order-north', 'north', dry, 'water', 4)],
      inbound: [arrival('in-water', dry, 'water', 4, 'Аквалайн')],
      stock: { dry: { water: 0 } },
      events: [],
      goal: 'Примите привоз, разместите паллету в зоне хранения и закройте заявку.',
      storyBefore: 'На приёмке стоит фура с водой, а на складе её нет. Сначала привоз — потом отгрузка.',
      storyAfter: 'Товар на месте. Теперь заявок будет две.',
    },
    {
      id: 3,
      title: 'Два адреса',
      newMechanic: 'two-stores',
      durationSeconds: 210,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry)],
      stores: [store('north', dry), store('west', dry)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-west', 'west', dry, 'bread', 3),
      ],
      events: [],
      goal: 'Распределите две заявки по двум паллетам: одна паллета — один даркстор.',
      storyBefore: 'К нам подключили второй даркстор. Следите за адресами.',
      storyAfter: 'Два адреса — справились. Открываем холодные зоны.',
    },
    {
      id: 4,
      title: 'Три зоны',
      newMechanic: 'three-zones',
      durationSeconds: 270,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', frozen), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-central', 'central', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [],
      goal: 'Соберите заявки по зонам и отправьте каждую своим фургоном.',
      storyBefore: 'Склад растёт: теперь у нас сухач, заморозка и охлаждёнка.',
      storyAfter: 'Три зоны работают. Проверим их на приёмке.',
    },
    {
      id: 5,
      title: 'Размещение по зонам',
      newMechanic: 'inbound-sorting',
      durationSeconds: 300,
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
      goal: 'Разместите каждую входящую паллету в её зоне: ошибка портит товар.',
      storyBefore: 'Три машины на приёмке сразу. Смотрите на зону в накладной, а не на порядок.',
      storyAfter: 'Приёмка разобрана без потерь. Дальше — дорога.',
    },
    {
      id: 6,
      title: 'Маршрут',
      newMechanic: 'route',
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', dry), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west', 'west', dry, 'water', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [],
      goal: 'Одна машина обходит три адреса — выберите порядок остановок короче.',
      storyBefore: 'Одна машина может посетить несколько дарксторов. Порядок решает всё.',
      storyAfter: 'Маршрут построен. Теперь заявка, которая не влезает в одну машину.',
    },
    {
      id: 7,
      title: 'Полный кузов',
      newMechanic: 'capacity',
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 10),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [],
      goal: '120 кг воды не влезут ни в одну паллету, ни в одну машину — разделите заявку.',
      storyBefore: 'Северный заказал десять паллетомест воды. Паллета держит 100 кг, машина — тоже.',
      storyAfter: 'Заявка разошлась по двум машинам. Осталось научиться менять план на ходу.',
    },
    {
      id: 8,
      title: 'План меняется',
      newMechanic: 'dynamic-demand',
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-west', 'west', dry, 'bread', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      /* Событие привязано к прогрессу, а не к секундам: смену можно закрыть
         за пятнадцать секунд, и расписание по таймеру никогда не срабатывало. */
      events: [{ type: 'demand-increase', orderId: 'order-west', quantity: 2, afterLoadedPallets: 2 }],
      goal: 'Заявка вырастет в середине смены — доберите остаток второй паллетой.',
      storyBefore: 'Диспетчер предупреждает: один даркстор меняет заявку в середине смены.',
      storyAfter: 'Вы перестроили план на ходу. Осталась контрольная смена.',
    },
    {
      id: 9,
      title: 'Контрольная смена',
      newMechanic: 'exam',
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('central', dry), store('west', frozen), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 2),
        order('order-central', 'central', dry, 'bread', 2),
        order('order-west', 'west', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      inbound: [arrival('in-ice', frozen, 'ice-cream', 2, 'Хладокомбинат')],
      stock: { frozen: { 'ice-cream': 0 } },
      events: [{ type: 'demand-increase', orderId: 'order-central', quantity: 2, afterLoadedPallets: 3 }],
      goal: 'Закройте все заявки: приёмка, зоны, маршрут и вместимость действуют сразу.',
      storyBefore: 'Финальная проверка: все изученные правила действуют одновременно.',
      storyAfter: 'Контрольная смена завершена. Центр «Рябиновая» готов к новым маршрутам.',
    },
  ];

  return { LEVELS, STORE_NAMES, ZONE_NAMES };
});

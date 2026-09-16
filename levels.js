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

  const STORE_NAMES = Object.freeze({
    north: 'Северный',
    central: 'Центральный',
    west: 'Западный',
    east: 'Восточный',
  });

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
      storyAfter: 'Первая заявка закрыта. Теперь подключим второй адрес.',
    },
    {
      id: 2,
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
      goal: 'Распределите две заявки по двум паллетам.',
      storyBefore: 'К нам подключили второй даркстор. Следите за адресами.',
      storyAfter: 'Два адреса — справились. Пора учиться загружать машину.',
    },
    {
      id: 3,
      title: 'Полный кузов',
      newMechanic: 'multi-pallet',
      durationSeconds: 240,
      unlockedZones: [dry],
      vehicles: [vehicle('dry-1', dry, 100)],
      stores: [store('north', dry), store('west', dry)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 4),
        order('order-west', 'west', dry, 'bread', 5),
      ],
      events: [],
      goal: 'Загрузите несколько паллет в одну машину, не превысив вместимость.',
      storyBefore: 'Сегодня кузов больше одной паллеты. Используйте его полностью.',
      storyAfter: 'Машина выдержала полную загрузку. Откроем остальные зоны.',
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
      goal: 'Соберите заявки по зонам и отправьте совместимый транспорт.',
      storyBefore: 'Склад растёт: теперь у нас сухач, заморозка и охлаждёнка.',
      storyAfter: 'Три зоны работают. Следующая смена — с несколькими машинами.',
    },
    {
      id: 5,
      title: 'Парк машин',
      newMechanic: 'multi-vehicle',
      durationSeconds: 300,
      unlockedZones: [dry, frozen, chilled],
      vehicles: [vehicle('dry-1', dry), vehicle('dry-2', dry), vehicle('frozen-1', frozen), vehicle('chilled-1', chilled)],
      stores: [store('north', dry), store('west', dry), store('central', frozen), store('east', chilled)],
      initialOrders: [
        order('order-north', 'north', dry, 'water', 3),
        order('order-west', 'west', dry, 'bread', 3),
        order('order-central', 'central', frozen, 'ice-cream', 2),
        order('order-east', 'east', chilled, 'milk', 2),
      ],
      events: [{ type: 'vehicle-ready', vehicleId: 'dry-2', atSecond: 90 }],
      goal: 'Распределите заявки между несколькими машинами.',
      storyBefore: 'Водители уже на линии. Выберите, какую машину загрузить первой.',
      storyAfter: 'Парк освоен. Теперь важен порядок остановок.',
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
      goal: 'Постройте маршрут с несколькими остановками.',
      storyBefore: 'Одна машина может посетить несколько дарксторов. Порядок решает всё.',
      storyAfter: 'Маршрут построен. Но план ещё может измениться.',
    },
    {
      id: 7,
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
      events: [{ type: 'demand-increase', orderId: 'order-west', quantity: 2, atSecond: 120 }],
      goal: 'Пересоберите паллету после изменения заявки.',
      storyBefore: 'Диспетчер предупреждает: один даркстор меняет заявку в середине смены.',
      storyAfter: 'Вы перестроили план на ходу. Осталась контрольная смена.',
    },
    {
      id: 8,
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
      events: [
        { type: 'vehicle-ready', vehicleId: 'dry-2', atSecond: 90 },
        { type: 'demand-increase', orderId: 'order-central', quantity: 2, atSecond: 180 },
      ],
      goal: 'Закройте все заявки, соблюдая зоны, вместимость и маршрут.',
      storyBefore: 'Финальная проверка: все изученные правила действуют одновременно.',
      storyAfter: 'Контрольная смена завершена. Центр «Рябиновая» готов к новым маршрутам.',
    },
  ];

  return { LEVELS, STORE_NAMES };
});

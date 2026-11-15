(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const appState = isNode ? require('./app-state.js') : root.RyabinovayaAppState;
  const sceneView = isNode ? require('./scene-view.js') : root.RyabinovayaSceneView;
  const api = factory(appState, sceneView);
  if (isNode) module.exports = api;
  else root.RyabinovayaFpView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (appState, sceneView) {
  const { guidedFor, currentTaskFor } = appState;
  const { sceneInboundFor } = sceneView;

  /* Игрок смотрит глазами кладовщика на электротележке и видит одно место
     склада за раз. Мест шесть, у каждого свой кадр. */
  const FRAMES = {
    hub: 'assets/fp/hub-zones.webp',
    receiving: 'assets/fp/receiving.webp',
    'shelf:dry': 'assets/fp/shelf-dry.webp',
    'shelf:chilled': 'assets/fp/shelf-chilled.webp',
    'shelf:frozen': 'assets/fp/shelf-frozen.webp',
    shipping: 'assets/fp/shipping.webp',
  };
  const LOCATIONS = Object.keys(FRAMES);
  const shelf = (zone) => `shelf:${zone}`;
  const at = (location, via = null) => ({ location, via });
  const frameFor = (location) => (FRAMES[location]
    ? { key: location, src: FRAMES[location] }
    : { key: 'hub', src: FRAMES.hub });

  /* Ехать к полке есть смысл, только когда есть что собирать: во вводной
     смене — когда у ворот ничего не ждёт, на смене с очередью — когда
     принято задание на сборку. */
  const canPick = (state) => state.phase === 'shift'
    && (guidedFor(state) ? !sceneInboundFor(state) : currentTaskFor(state)?.kind === 'pick');

  /* Где кладовщик окажется после действия. Правило одно: игра везёт сама
     туда, где выбирать нечего, а зону и ворота выбирает игрок. Место живёт
     в экране, а не в состоянии игры: правила про кадры не знают. */
  function locationAfter(location, before, after, action = {}) {
    if (after.phase !== 'shift') return at('hub');
    /* Часы и погасший тост никого не возят: иначе полка, у которой игрок
       только что поставил паллету, исчезала бы в случайную долю секунды. */
    if (action.type === 'TICK' || action.type === 'DISMISS_FEEDBACK') return at(location);
    /* Размещение показывает полку той зоны, которую нажал игрок, — и при
       удаче, и при порче. Стоит раньше приёмки: следующая фура подождёт,
       пока он увидит, что получилось. */
    if (action.type === 'PLACE_PALLET' && ['pallet-placed', 'wrong-placement'].includes(after.feedback?.code)) {
      return at(shelf(action.zone));
    }
    const inbound = sceneInboundFor(after);
    if (inbound?.status === 'arrived') return at('receiving');
    if (inbound?.status === 'received') {
      const was = sceneInboundFor(before);
      const justReceived = !(was && was.id === inbound.id && was.status === 'received');
      // Паллету сняли с фуры: если кладовщик был не у ворот, он проезжает мимо них.
      return at('hub', justReceived && location !== 'receiving' ? 'receiving' : null);
    }
    if (action.type === 'GO_HUB') return at('hub');
    if (action.type === 'GO_SHELF') return at(shelf(action.zone));
    if (action.type === 'GO_SHIPPING') return at('shipping');
    /* Принятое задание важнее открытой сборки: app.js её закрывает, а игра
       везёт туда, где выбирать нечего (на сборку — на проезд, на снятие
       паллеты — к отгрузке). */
    if ((action.type === 'ACCEPT_TASK' || action.type === 'TAKE_URGENT') && !guidedFor(after)) {
      const task = currentTaskFor(after);
      if (task?.kind === 'pick') return at('hub');
      if (task?.kind === 'unload') return at('shipping');
    }
    // Открытая сборка — это и есть «стою у полки зоны паллеты».
    if (after.builderOpen) return at(shelf(after.pallet.zone));
    if (after.vehicleDrawerOpen && !before.vehicleDrawerOpen) return at('shipping');
    if (action.type === 'LOAD_PALLET' && after.feedback?.code === 'pallet-loaded') {
      /* Заявка тяжелее паллеты: задание ещё в работе, и за остатком кладовщик
         едет на проезд, а не сразу в сборку. Каждая паллета начинается с
         проезда — иначе непонятно, как он вдруг оказался у полки. */
      const stillPicking = !guidedFor(after) && currentTaskFor(after)?.kind === 'pick';
      return at(stillPicking ? 'hub' : 'shipping');
    }
    if (action.type === 'START_LEVEL' || action.type === 'CONTINUE_STORY') return at('hub');
    // У ворот приёмки делать больше нечего.
    if (location === 'receiving') return at('hub');
    return at(location);
  }

  return { FRAMES, LOCATIONS, frameFor, canPick, locationAfter };
});

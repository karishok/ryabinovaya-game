/* Контроллер режима «Поток». Живёт отдельно от app.js и слушает только
   data-flow-action: у кампании свой делегат на data-action, и смешивать их
   в одном обработчике значило бы ловить чужие нажатия. */
(function () {
  const flow = window.RyabinovayaFlowEngine;
  const { flowViewFor } = window.RyabinovayaFlowView;

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]
  ));

  let state = null;
  let selectedPalletId = null;
  let timer = null;

  const campaignScreen = document.querySelector('[data-screen="warehouse"]');
  const flowScreen = document.querySelector('[data-screen="flow"]');

  /* Терминал кампании нарисован фиксированно поверх страницы и на экране
     конца кампании держится открытым принудительно — на «Потоке» он лёг бы
     поверх смены. Кампания его hidden не трогает, поэтому убрать можно
     прямо здесь и вернуть на выходе. */
  const campaignOverlay = [document.getElementById('tsdDevice'), document.getElementById('tsdBackdrop')];
  const showCampaignOverlay = (visible) => campaignOverlay.forEach((node) => { if (node) node.hidden = !visible; });

  function renderGoals(target, goals, final) {
    target.innerHTML = goals.map((goal) => `
      <li class="flow-goal${goal.ok ? ' is-ok' : ' is-off'}">
        <span class="flow-goal-mark" aria-hidden="true">${goal.ok ? '✓' : '·'}</span>
        <span class="flow-goal-text">${escapeHtml(final ? goal.text : shortGoal(goal))}</span>
        <strong class="flow-goal-value">${goal.value}${goal.id === 'missed' ? `/${goal.limit}` : ''}</strong>
      </li>`).join('');
  }

  // В шапке места на полную формулировку нет, а в отчёте — есть.
  const shortGoal = (goal) => (goal.id === 'missed' ? 'Сорвано' : 'Списано');

  function gateMarkup(gate) {
    if (!gate.occupied) return '<div class="flow-gate is-empty"><span>Гейт свободен</span></div>';
    const blocked = {
      station: 'Вы не на приёмке',
      busy: 'Заняты',
      buffer: 'Буфер забит',
    }[gate.blockedBy] || '';
    return `
      <button class="flow-gate${gate.unloading ? ' is-working' : ''}${gate.perishable ? ' is-perishable' : ''}"
        type="button" data-flow-action="UNLOAD" data-gate="${gate.id}" ${gate.canUnload ? '' : 'disabled'}>
        <span class="flow-gate-body">
          <strong>${escapeHtml(gate.title)}</strong>
          <span class="flow-gate-goods">${escapeHtml(gate.goods)}</span>
          <span class="flow-gate-meta">${escapeHtml(gate.unloading ? 'разгружаю…' : blocked || gate.waitedText)}</span>
        </span>
      </button>`;
  }

  function palletMarkup(pallet) {
    return `
      <button class="flow-pallet is-${pallet.urgency}${pallet.selected ? ' is-selected' : ''}${pallet.moving ? ' is-working' : ''}"
        type="button" data-flow-action="SELECT_PALLET" data-pallet="${pallet.id}" ${pallet.canTake ? '' : 'disabled'}>
        <span class="flow-pallet-body">
          <strong>${escapeHtml(pallet.goods)}</strong>
          <span class="flow-pallet-meta">${escapeHtml(pallet.moving ? 'везу…' : pallet.shelfText)}</span>
          <span class="flow-shelf"><i style="width:${pallet.shelfPercent}%"></i></span>
        </span>
      </button>`;
  }

  /* Строка фургона одна на две станции. Кнопкой она становится только там,
     где действие возможно, а в остальных случаях говорит, чего не хватает. */
  function vanMarkup(van, mode) {
    const picking = mode === 'picking';
    const can = picking ? van.canPick : van.canLoad;
    const blockedBy = picking ? van.pickBlockedBy : van.loadBlockedBy;
    const reason = {
      staged: 'уже у ворот — можно грузить',
      'no-stock': 'товара нет в зонах',
      station: 'вы не здесь',
      busy: 'заняты',
      'staging-full': 'зона отгрузки забита',
      'not-picked': van.status === 'no-stock' ? 'товара нет в зонах' : 'ещё не отобрана',
    }[blockedBy] || '';
    const working = (picking && van.picking) || (!picking && van.loading);
    const action = working ? (picking ? 'везу…' : 'гружу…') : can ? (picking ? 'Отобрать' : 'Погрузить') : reason;
    return `
      <button class="flow-van is-${van.urgency}${working ? ' is-working' : ''}${can ? ' is-ready' : ''}" data-status="${van.status}"
        type="button" data-flow-action="${picking ? 'PICK' : 'LOAD'}" data-van="${van.id}" ${can ? '' : 'disabled'}>
        <span class="flow-van-body">
          <strong>${escapeHtml(van.storeName)} · ${escapeHtml(van.goods)}</strong>
          <span class="flow-van-meta">${escapeHtml(van.leftText)}</span>
        </span>
        <span class="flow-van-action">${escapeHtml(action)}</span>
      </button>`;
  }

  function stagedMarkup(pallet) {
    return `
      <div class="flow-pallet flow-staged is-${pallet.urgency}${pallet.loading ? ' is-working' : ''}">
        <span class="flow-pallet-body">
          <strong>${escapeHtml(pallet.goods)}</strong>
          <span class="flow-pallet-meta">${escapeHtml(pallet.loading ? 'гружу…' : pallet.shelfText)}</span>
          <span class="flow-shelf"><i style="width:${pallet.shelfPercent}%"></i></span>
        </span>
      </div>`;
  }

  function render() {
    if (!state) return;
    const view = flowViewFor(state, selectedPalletId);

    byId('flowClock').textContent = view.clock;
    renderGoals(byId('flowGoals'), view.goals, false);
    byId('flowStationName').textContent = view.stationName;

    const atReceiving = view.station === flow.STATIONS.RECEIVING;
    const atPutaway = view.station === flow.STATIONS.PUTAWAY;
    const atPicking = view.station === flow.STATIONS.PICKING;
    const atOutbound = atPicking || view.station === flow.STATIONS.LOADING;
    byId('flowGates').hidden = !atReceiving;
    byId('flowQueue').hidden = !atReceiving || !view.queueText;
    byId('flowQueue').textContent = view.queueText;
    byId('flowPutaway').hidden = !atPutaway;
    byId('flowOutbound').hidden = !atOutbound;

    if (atOutbound) {
      /* На отборе важно, что стоит в зонах; на погрузке — что уже у ворот и
         сколько ему осталось. Слоты зоны отгрузки видны на обеих станциях:
         это общий ресурс, как буфер у приёмки и размещения. */
      byId('flowStock').textContent = view.stock.length
        ? `В зонах: ${view.stock.map((item) => `${item.name} ×${item.count}`).join(', ')}`
        : 'В зонах пусто — отбирать нечего, пока паллеты не размещены.';
      byId('flowStock').hidden = !atPicking;
      const slots = view.staging.pallets.map(stagedMarkup)
        .concat(Array.from({ length: view.staging.free }, () => '<div class="flow-pallet is-free"><span>У ворот свободно</span></div>'));
      byId('flowStaging').innerHTML = slots.join('');
      byId('flowVans').innerHTML = view.vans.length
        ? view.vans.map((van) => vanMarkup(van, atPicking ? 'picking' : 'loading')).join('')
        : '<p class="flow-empty">Фургонов у ворот отгрузки пока нет.</p>';
    }

    if (atReceiving) byId('flowGates').innerHTML = view.gates.map(gateMarkup).join('');
    else if (atPutaway) {
      byId('flowBufferCount').textContent = view.buffer.free
        ? `Буфер ${view.buffer.used} из ${view.buffer.slots}`
        : 'Буфер забит — приёмка встала';
      /* Пустые слоты рисуем наравне с занятыми: свободное место в буфере —
         это то, ради чего игрок сюда и пришёл, и считать его вычитанием
         двух чисел он не должен. */
      const slots = view.buffer.pallets.map(palletMarkup)
        .concat(Array.from({ length: view.buffer.free }, () => '<div class="flow-pallet is-free"><span>Свободный слот</span></div>'));
      byId('flowPallets').innerHTML = slots.join('');
      const selected = view.buffer.pallets.find((pallet) => pallet.selected);
      byId('flowZoneHint').textContent = selected
        ? `Куда везти «${selected.goods}»?`
        : 'Выберите паллету, потом зону.';
      byId('flowZones').innerHTML = view.zones.map((zone) => `
        <button class="flow-zone" type="button" data-flow-action="PUTAWAY" data-zone="${zone.id}" ${selected ? '' : 'disabled'}>
          <span class="flow-zone-mark" data-zone="${zone.id}">${escapeHtml(zone.mark)}</span>
          <span>${escapeHtml(zone.name)}</span>
        </button>`).join('');
    }

    const message = byId('flowMessage');
    message.hidden = !view.message;
    message.textContent = view.message;
    message.dataset.kind = view.messageKind || '';

    const busy = byId('flowBusy');
    busy.hidden = !view.busy;
    if (view.busy) {
      byId('flowBusyLabel').textContent = `${view.busy.label} · ${view.busy.secondsLeft} с`;
      byId('flowBusyFill').style.width = `${view.busy.percent}%`;
    }

    byId('flowStrip').innerHTML = view.stations.map((station) => `
      <button class="flow-station-tab${station.here ? ' is-here' : ''}${station.alert ? ' is-alert' : ''}"
        type="button" data-flow-action="GO_TO" data-station="${station.id}" aria-current="${station.here}">
        <strong>${escapeHtml(station.name)}</strong>
        <span>${escapeHtml(station.pressure)}</span>
      </button>`).join('');

    /* Отчёт забирает экран целиком. Оставлять под ним живую смену нельзя:
       шапка печатала бы те же цели короткой строкой, крестик дублировал бы
       «Вернуться к кампании», а полоса станций звала бы туда, где смены
       уже нет. */
    byId('flowHead').hidden = !view.running;
    byId('flowStation').hidden = !view.running;
    byId('flowStrip').hidden = !view.running;
    if (!view.running) {
      byId('flowMessage').hidden = true;
      byId('flowBusy').hidden = true;
    }
    byId('flowReport').hidden = view.running;
    if (!view.running && view.report) {
      byId('flowReportVerdict').textContent = view.report.success
        ? 'Смена закрыта по всем целям.'
        : 'Цели смены не закрыты.';
      byId('flowReportGrid').innerHTML = [
        ['Отгружено', view.report.shipped],
        ['Сорвано', view.report.missed],
        ['Списано', view.report.spoiled],
        ['Размещено', view.report.stored],
      ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
      renderGoals(byId('flowReportGoals'), view.report.goals, true);
    }
  }

  function apply(next) {
    state = next;
    // Паллета могла уехать в зону или протухнуть, пока была выбрана.
    if (selectedPalletId && !state.buffer.some((pallet) => pallet.id === selectedPalletId)) selectedPalletId = null;
    render();
  }

  function startShift() {
    stopClock();
    selectedPalletId = null;
    state = flow.createFlowShift({ seed: Date.now() % 100000 });
    campaignScreen.classList.remove('active');
    flowScreen.classList.add('active');
    showCampaignOverlay(false);
    render();
    timer = window.setInterval(() => {
      apply(flow.tick(state));
      if (state.phase !== 'running') stopClock();
    }, 1000);
  }

  function stopClock() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  function leave() {
    stopClock();
    state = null;
    flowScreen.classList.remove('active');
    campaignScreen.classList.add('active');
    showCampaignOverlay(true);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-flow-action]');
    if (!button || button.disabled) return;
    const { flowAction } = button.dataset;
    if (flowAction === 'START_FLOW' || flowAction === 'RESTART_FLOW') return startShift();
    if (flowAction === 'LEAVE') return leave();
    if (!state) return;
    if (flowAction === 'GO_TO') return apply(flow.goTo(state, button.dataset.station));
    if (flowAction === 'UNLOAD') return apply(flow.unload(state, button.dataset.gate));
    if (flowAction === 'PICK') return apply(flow.pick(state, button.dataset.van));
    if (flowAction === 'LOAD') return apply(flow.load(state, button.dataset.van));
    if (flowAction === 'SELECT_PALLET') {
      selectedPalletId = selectedPalletId === button.dataset.pallet ? null : button.dataset.pallet;
      return render();
    }
    if (flowAction === 'PUTAWAY') {
      if (!selectedPalletId) return;
      return apply(flow.putaway(state, selectedPalletId, button.dataset.zone));
    }
  });
})();

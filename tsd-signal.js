(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyabinovayaTsdSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function signalTsd(signal, capabilities = {}) {
    if (signal === 'idle') return;
    const pattern = signal === 'error' ? [80, 40, 80] : 80;
    capabilities.vibrate?.(pattern);
    capabilities.beep?.(signal);
  }

  return { signalTsd };
});

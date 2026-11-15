const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

/* В браузере у window есть неизменяемые свойства — location, top, window,
   document. Объявить одноимённую переменную на верхнем уровне обычного
   скрипта нельзя: браузер отвергает весь файл, и в игре ничего не
   нажимается. Тесты гоняют app.js в vm, где этих свойств нет, поэтому
   проверяем отдельно. */
const RESERVED = ['location', 'top', 'window', 'document', 'self', 'parent', 'frames', 'history', 'navigator', 'name', 'status', 'origin', 'length', 'closed', 'opener'];

for (const file of ['app.js', 'flow-app.js', 'fp-view.js', 'scene-view.js', 'tsd-view.js', 'app-state.js', 'levels.js', 'game-engine.js', 'scoring.js', 'tsd-signal.js', 'flow-engine.js', 'flow-view.js']) {
  test(`${file} declares no top-level name that a browser reserves`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const script = new vm.Script(source, { filename: file });
    const context = vm.createContext({});
    for (const name of RESERVED) {
      Object.defineProperty(context, name, { value: {}, writable: false, enumerable: true, configurable: false });
    }
    assert.doesNotThrow(() => {
      try { script.runInContext(context); } catch (error) {
        if (error instanceof SyntaxError || /already been declared/.test(String(error && error.message))) throw error;
        // Остальные ошибки — от отсутствующего DOM — здесь не важны.
      }
    });
  });
}

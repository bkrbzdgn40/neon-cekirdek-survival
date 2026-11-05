// Shared VM harness: runs the real classic game script in a Node sandbox.
// Used by tests/smoke.test.cjs and scripts/sim-dps.cjs (Odak 3.3).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The browser uses separate static sources. Reconstruct the former inline view for
// existing markup/CSS/source assertions while executing the identical game script.
const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const gameCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.css'), 'utf8');
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const html = pageHtml
  .replace('<link rel="stylesheet" href="./src/game.css">', `<style>\n${gameCss}</style>`)
  .replace('<script src="./src/game.js"></script>', `<script>\n${gameCode}</script>`);

function setup(stored = {}, options = {}) {
  const nodes = new Map();
  const noop = () => {};
  const windowListeners = new Map();
  const documentListeners = new Map();
  const on = (map, type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const emit = (map, type, event = {}) => {
    for (const fn of map.get(type) || []) fn({ preventDefault: noop, ...event });
  };
  function element() {
    const elementListeners = new Map();
    return {
      classList: { add: noop, remove: noop, toggle: noop },
      style: {}, dataset: {}, textContent: '', innerHTML: '',
      addEventListener(type, fn) { on(elementListeners, type, fn); },
      dispatch(type, event = {}) { emit(elementListeners, type, event); },
      click() { emit(elementListeners, 'click', { target: this }); },
      appendChild: noop,
       _attrs: {}, setAttribute(key, value) { this._attrs[key] = value; },
      getContext: () => options.canvasContext || new Proxy({}, { get: () => noop }),
      querySelector: () => element(),
      getAttribute(key) { return this._attrs[key] || ''; },
    };
  }
  const document = {
    documentElement: { clientWidth: options.width || 1280, clientHeight: options.height || 720, dataset: {} },
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelectorAll: () => [],
    createElement: element,
    addEventListener(type, fn) { on(documentListeners, type, fn); },
  };
  const window = { innerWidth: options.width || 1280, innerHeight: options.height || 720, devicePixelRatio: 1,
    location: { search: options.locationSearch || '' },
    addEventListener(type, fn) { on(windowListeners, type, fn); } };
  const storage = {
    getItem: (key) => stored[key] ?? null,
    setItem: (key, value) => { stored[key] = value; },
    removeItem: (key) => { delete stored[key]; },
  };
  const sandbox = {
    window, document, localStorage: storage, console: { warn: noop, log: console.log },
    Math: Object.create(Math), Set, Date, performance: { now: () => 0 },
    requestAnimationFrame: noop, setTimeout: noop,
  };
  // Odak 1.2: existing tests exercise every system; locked tests pass unlockAll:false.
  if (options.unlockAll !== false) sandbox.window.NEON_UNLOCK_ALL = true;
  // Odak 4.2: one-time guides pause the run; only guide tests turn them on.
  if (options.guides !== true) sandbox.window.NEON_GUIDES = false;
  vm.createContext(sandbox);
  vm.runInContext(gameCode, sandbox, { timeout: options.timeout || 4000 });
  sandbox.window.onload();
  const run = (script) => vm.runInContext(script, sandbox, { timeout: options.timeout || 4000 });
  return {
    run, stored,
    windowEvent: (type, event) => emit(windowListeners, type, event),
    documentEvent: (type, event) => emit(documentListeners, type, event),
    canvasEvent: (type, event) => nodes.get('gameCanvas').dispatch(type, event),
  };
}

module.exports = { setup, html, pageHtml, gameCss, gameCode };

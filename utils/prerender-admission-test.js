'use strict';
// Actual provider/isolated relay with an inert browser scheduler. Native
// document/prerender coverage remains in document-binding-browser-test.js.
// No wallet, signing key, storage, node or publication is involved.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto').webcrypto;
const vm = require('node:vm');
const babel = require('@babel/core');
const root = path.join(__dirname, '..');
const compiled = new Map();
const fixture = (section = 'Content') => {
  let now = 1000000, timerId = 0, background;
  const timers = new Map(), pageHandlers = new Map(), documentHandlers = new Map(), observers = [];
  const posted = [], sent = [];
  const add = (handlers, name, fn) => {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
  };
  const emit = (handlers, name, event = {}) => {
    for (const fn of [...(handlers.get(name) || [])]) fn({ type: name, ...event });
  };
  const document = { documentElement: { nodeType: 1 }, prerendering: true,
    addEventListener: (name, fn) => add(documentHandlers, name, fn),
    removeEventListener: (name, fn) => documentHandlers.get(name)?.delete(fn) };
  const window = { location: { origin: 'https://fixture.invalid' },
    addEventListener: (name, fn) => add(pageHandlers, name, fn),
    dispatchEvent: event => emit(pageHandlers, event.type, event),
    postMessage: message => { posted.push(structuredClone(message)); } };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observers.push(this); }
    observe() {}
    takeRecords() { const records = this.records; this.records = []; return records; }
  }
  class Clock extends Date { static now() { return now; } }
  const environment = { window, document, MutationObserver, Date: Clock, crypto, Event,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    chrome: { runtime: { id: 'fixture',
      onMessage: { addListener: fn => { background = fn; } },
      sendMessage: (message, callback) => { sent.push(structuredClone(message)); callback({ accepted: true }); } } } };
  const cache = new Map();
  const load = file => {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, babel.transformFileSync(filename, {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]], configFile: false, babelrc: false,
    }).code);
    new Function('module', 'exports', 'require', ...Object.keys(environment), compiled.get(filename))(
      module, module.exports, id => {
        const next = path.resolve(path.dirname(filename), id);
        return load(path.extname(next) ? next : next + '.js');
      }, ...Object.values(environment));
    return module.exports;
  };
  const { limits } = load('src/services/utils/approvalLimits.js');
  load(`src/sections/${section}/index.js`);
  return { window, document, limits, timers, sent, posted,
    requests: () => sent.filter(message => message.kind === 'request'),
    listeners: () => documentHandlers.get('prerenderingchange')?.size || 0,
    page: data => emit(pageHandlers, 'message', { source: window, data }),
    activate: () => { document.prerendering = false; emit(documentHandlers, 'prerenderingchange'); },
    fakeActivation: () => emit(documentHandlers, 'prerenderingchange'),
    hide: () => emit(pageHandlers, 'pagehide', { persisted: true }),
    show: () => emit(pageHandlers, 'pageshow', { persisted: true }),
    rewrite: (notify = true, reinsert = false) => {
      const old = document.documentElement; pageHandlers.clear(); documentHandlers.clear();
      if (!reinsert) document.documentElement = { nodeType: 1 };
      for (const observer of observers) {
        observer.records.push({ target: document, removedNodes: [old] });
        if (notify) observer.callback(observer.takeRecords());
      }
    },
    advance: (ms, fire = true) => {
      now += ms;
      if (fire) for (const [id, timer] of [...timers]) if (timer.at <= now) {
        timers.delete(id); timer.fn();
      }
    },
    answer: (request, result) => background({ channel: 'znn', kind: 'response',
      activation: request.activation, requestToken: request.requestToken, result }, { id: 'fixture' }, () => {}),
  };
};
const message = (id, method = 'znn_accounts', params = {}) => ({ target: 'znn-contentscript', kind: 'request', id, method, params });
(async () => {
  // Direct page messages bypass the public provider, so the isolated relay
  // itself admits at most the existing cap and validates before retaining.
  {
    const f = fixture();
    f.page(message('oversized', 'znn_sign', { message: 'x'.repeat(f.limits.bytes) }));
    f.page(message('bad-method', null));
    f.page(message('x'.repeat(129)));
    f.page({ method: 'znn.sendTransactionToSigning', params: { oversized: 'x'.repeat(f.limits.bytes) } });
    assert.equal(f.timers.size, 0);
    assert.equal(f.posted.length, 3); assert.equal(f.posted[0].error.code, -32602);
    assert.equal(f.posted[2].method, 'znn.deniedSignTransaction');
    for (let i = 0; i < f.limits.activeHandlers + 8; i++) f.page(message(`direct-${i}`));
    assert.equal(f.timers.size, f.limits.activeHandlers);
    assert.equal(f.posted.filter(entry => entry.error?.code === -32005).length, 8);
    assert.equal(f.listeners(), 1);
    for (let i = 0; i < 100; i++) f.fakeActivation();
    assert.equal(f.requests().length, 0); assert.equal(f.sent.length, 0); assert.equal(f.listeners(), 1);
    f.activate();
    assert.equal(f.listeners(), 0); assert.equal(f.requests().length, f.limits.activeHandlers);
    assert.equal(f.sent.filter(entry => entry.kind === 'hello').length, 1);
    assert.equal(new Set(f.requests().map(entry => entry.requestToken)).size, f.limits.activeHandlers);
    for (const request of f.requests()) f.answer(request, []);
    assert.equal(f.timers.size, 0);
    f.page(message('capacity-restored')); assert.equal(f.requests().length, f.limits.activeHandlers + 1);
  }
  // Existing read and approval transport budgets retire unopened entries. An
  // activation task that beats an overdue timer still cannot dispatch them.
  for (const [method, timeout] of [['znn_accounts', 30000], ['znn_sign', 31 * 60 * 1000]]) {
    for (const fire of [true, false]) {
      const f = fixture(); f.page(message('expired', method)); f.advance(timeout, fire); f.activate();
      assert.equal(f.requests().length, 0); assert.equal(f.timers.size, 0);
      assert.equal(f.posted.at(-1).error.code, 4900);
      assert.match(f.posted.at(-1).error.message, /not activated in time/);
      f.page(message('fresh', method)); assert.equal(f.requests().length, 1);
    }
  }
  // Page departure or document.open discards every deferred request and the
  // activation callback. Returning admits only a freshly tokenized request.
  for (const reset of ['hide', 'rewrite']) {
    const f = fixture(); f.page(message('old', 'znn_sign')); f[reset]();
    assert.equal(f.timers.size, 0);
    if (reset === 'hide') { assert.equal(f.listeners(), 0); f.show(); }
    f.page(message('fresh', 'znn_sign')); f.activate();
    assert.deepEqual(f.requests().map(entry => entry.id), ['fresh']);
  }
  // The actual public provider uses the same admission cap and JSON limits,
  // one callback, finite budgets and page-lifetime retirement.
  {
    const f = fixture('Inpage'), nested = [];
    const outer = f.window.zenon.request({ method: 'znn_accounts', params: { get value() {
      for (let i = 0; i < f.limits.activeHandlers; i++) nested.push(f.window.zenon.getAccounts());
      return 'inert';
    } } });
    const rejected = assert.rejects(outer, error => error.code === -32005);
    assert.equal(f.timers.size, f.limits.activeHandlers); assert.equal(f.listeners(), 1); assert.equal(f.posted.length, 0);
    await rejected;
    const retired = Promise.all(nested.map(promise => assert.rejects(promise, error => error.code === 4900)));
    f.hide(); await retired;
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0);
  }
  for (const reset of ['hide', 'rewrite', 'queued-rewrite', 'queued-reinsert', 'return']) {
    const f = fixture('Inpage');
    const outer = f.window.zenon.request({ method: 'znn_accounts', params: { get value() {
      if (reset === 'return') { f.hide(); f.show(); }
      else if (reset.startsWith('queued-')) f.rewrite(false, reset === 'queued-reinsert');
      else f[reset]();
      return 'inert';
    } } });
    const rejected = assert.rejects(outer, error => error.code === 4900);
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0); assert.equal(f.posted.length, 0);
    await rejected;
    if (reset === 'hide') f.show();
    const fresh = f.window.zenon.getAccounts(); f.activate();
    assert.equal(f.posted.length, 1);
    f.page({ target: 'znn-inpage', kind: 'response', id: f.posted[0].id, result: [] });
    assert.deepEqual(await fresh, []);
  }
  {
    const f = fixture('Inpage');
    const crossRealm = vm.runInNewContext('({ nested: { amount: "1" }, list: [{ value: "inert" }] })');
    class DataOnly { constructor() { this.nested = vm.runInNewContext('({ amount: "2" })'); this.label = 'inert'; } }
    const params = { foreign: crossRealm, instance: new DataOnly() };
    const response = f.window.zenon.request({ method: 'znn_accounts', params });
    // Admission owns a normalized snapshot; later caller edits cannot enlarge
    // or replace the parameters retained by an unopened prerender.
    crossRealm.nested.amount = 'changed'; params.instance.label = 'changed';
    assert.equal(f.timers.size, 1); assert.equal(f.listeners(), 1); f.activate();
    const request = f.posted.at(-1);
    assert.deepEqual(request.params, { foreign: { nested: { amount: '1' }, list: [{ value: 'inert' }] },
      instance: { nested: { amount: '2' }, label: 'inert' } });
    f.page({ target: 'znn-inpage', kind: 'response', id: request.id, result: [] });
    assert.deepEqual(await response, []);
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0);
  }
  {
    const f = fixture('Inpage');
    for (const params of [{ callback() {} }, new Proxy({}, {}), { get value() { throw Error('private input marker'); } }]) {
      await assert.rejects(f.window.zenon.request({ method: 'znn_accounts', params }), error =>
        error.code === -32602 && error.message === 'Wallet request parameters could not be copied safely.');
    }
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0); assert.equal(f.posted.length, 0);
  }
  {
    const f = fixture('Inpage');
    await assert.rejects(f.window.zenon.request({ method: 'znn_sign', params: { message: 'x'.repeat(f.limits.bytes) } }), error => error.code === -32602);
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0);
    const pending = Array.from({ length: f.limits.activeHandlers }, () => f.window.zenon.getAccounts());
    const results = Promise.all(pending.map(promise => assert.rejects(promise, error => error.code === 4900)));
    await assert.rejects(f.window.zenon.getAccounts(), error => error.code === -32005);
    assert.equal(f.listeners(), 1); assert.equal(f.timers.size, f.limits.activeHandlers);
    for (let i = 0; i < 100; i++) f.fakeActivation();
    assert.equal(f.posted.length, 0); assert.equal(f.listeners(), 1);
    f.advance(30000); await results;
    assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
    const fresh = f.window.zenon.getAccounts(); f.activate();
    const request = f.posted.at(-1); assert.equal(request.method, 'znn_accounts');
    f.page({ target: 'znn-inpage', kind: 'response', id: request.id, result: [] });
    assert.deepEqual(await fresh, []); assert.equal(f.timers.size, 0);
  }
  for (const reset of ['hide', 'rewrite']) {
    const f = fixture('Inpage'); const old = f.window.zenon.signMessage('inert');
    const retired = assert.rejects(old, error => error.code === 4900); f[reset](); await retired;
    assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0);
    if (reset === 'hide') f.show();
    const fresh = f.window.zenon.getAccounts(); f.activate();
    assert.equal(f.posted.length, 1);
    f.page({ target: 'znn-inpage', kind: 'response', id: f.posted[0].id, result: [] });
    assert.deepEqual(await fresh, []);
  }
  console.log('prerender admission: actual relay/provider invalid envelopes, direct-message capacity, synthetic activation, deadlines, page departure, document rewrite and fresh activation passed');
})().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });

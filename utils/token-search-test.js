'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

// Exercise the actual search coordinator with inert workers. No SDK, vault,
// browser, signing or network operation is used by these lifecycle checks.
const fixture = ({ constructFailure, postFailure, randomFailure, alreadyAborted = false } = {}) => {
  const workers = [];
  const listeners = new Set();
  let attempts = 0;
  let highWord = 0;
  const signal = {
    aborted: alreadyAborted,
    addEventListener: (type, listener) => { assert.equal(type, 'abort'); listeners.add(listener); },
    removeEventListener: (type, listener) => { assert.equal(type, 'abort'); listeners.delete(listener); },
    abort() { this.aborted = true; [...listeners].forEach(listener => listener()); },
  };
  class Worker {
    constructor(url) {
      assert.equal(url, 'chrome-extension://fixture/zts-search-worker.js');
      attempts += 1;
      if (attempts === constructFailure) throw Error('Worker construction failed');
      this.messages = [];
      this.terminations = 0;
      workers.push(this);
    }
    postMessage(message) {
      if (postFailure) throw Error('Worker initialization failed');
      this.messages.push(message);
    }
    terminate() { this.terminations += 1; }
    message(data) { this.onmessage({ data }); }
  }
  const cache = new Map();
  const load = file => {
    const filename = path.resolve(__dirname, '..', file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const { code } = babel.transformFileSync(filename, {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      babelrc: false, configFile: false,
    });
    const resolve = id => {
      if (id === 'znn-ts-sdk') return { utils: {}, Zenon: {}, Primitives: {} };
      if (id === '../wallet/vault') return {};
      if (id.startsWith('.')) {
        const target = path.resolve(path.dirname(filename), id);
        return load(target.endsWith('.js') ? target : target + '.js');
      }
      return require(id);
    };
    new Function('module', 'exports', 'require', 'Worker', 'navigator', 'crypto', 'chrome', code)(
      module, module.exports, resolve, Worker, { hardwareConcurrency: 3 },
      { getRandomValues: values => {
        if (randomFailure) throw Error('Worker initialization randomness unavailable');
        values[0] = ++highWord; return values;
      } },
      { runtime: { getURL: name => `chrome-extension://fixture/${name}` } }
    );
    return module.exports;
  };
  const api = load('src/services/token/vanity.js');
  const progress = [];
  const promise = api.search({ head: '00', prefix: 'q', suffix: '', signal,
    onProgress: (tried, expected) => progress.push({ tried, expected }) });
  const cleaned = () => {
    assert.equal(listeners.size, 0);
    assert(workers.every(worker => worker.terminations === 1));
  };
  return { workers, signal, listeners, progress, promise, cleaned, attempts: () => attempts };
};

(async () => {
  let cases = 0;
  {
    const f = fixture({ constructFailure: 2 });
    await assert.rejects(f.promise, error => error.errorId === 413);
    assert.equal(f.attempts(), 2);
    assert.equal(f.workers.length, 1);
    f.cleaned();
    f.workers[0].message({ ready: true });
    assert.equal(f.workers[0].messages.length, 0);
    cases += 1;
  }
  {
    const f = fixture({ randomFailure: true });
    await assert.rejects(f.promise, error => error.errorId === 413);
    assert.equal(f.attempts(), 0);
    f.cleaned();
    cases += 1;
  }
  {
    const f = fixture({ postFailure: true });
    f.workers[0].message({ ready: true });
    await assert.rejects(f.promise, error => error.errorId === 413);
    f.cleaned();
    cases += 1;
  }
  {
    const f = fixture({ alreadyAborted: true });
    await assert.rejects(f.promise, error => error.errorId === 412);
    assert.equal(f.attempts(), 0);
    f.cleaned();
    cases += 1;
  }
  {
    const f = fixture();
    f.signal.abort();
    await assert.rejects(f.promise, error => error.errorId === 412);
    f.cleaned();
    f.workers[0].message({ tried: 10 });
    assert.equal(f.progress.length, 0);
    cases += 1;
  }
  {
    const f = fixture();
    f.workers[1].onerror();
    await assert.rejects(f.promise, error => error.errorId === 413);
    f.cleaned();
    cases += 1;
  }
  {
    const f = fixture();
    f.workers[0].message({ ready: true });
    assert.deepEqual(f.workers[0].messages, [{ head: '00', prefix: 'q', suffix: '', hi: 1, chunk: 20000 }]);
    f.workers[1].message({ tried: 9 });
    assert.deepEqual(f.progress, [{ tried: 9, expected: 32 }]);
    f.workers[0].message({ found: true, nonce: '0000000100000002', zts: 'synthetic-token-id', tried: 3 });
    assert.deepEqual(await f.promise, { nonce: '0000000100000002', zts: 'synthetic-token-id', tried: 12 });
    f.cleaned();
    f.workers[1].message({ ready: true });
    f.workers[1].message({ tried: 20 });
    assert.equal(f.workers[1].messages.length, 0);
    assert.equal(f.progress.length, 1);
    f.signal.abort();
    f.cleaned();
    cases += 1;
  }
  {
    const f = fixture();
    f.workers[0].message({ found: true, nonce: 'invalid', zts: 'synthetic-token-id' });
    await assert.rejects(f.promise, error => error.errorId === 413);
    f.cleaned();
    cases += 1;
  }
  console.log(`Token search worker lifecycle: ${cases} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });

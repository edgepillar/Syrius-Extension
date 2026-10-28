'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.join(__dirname, '..');
const compile = file => babel.transformFileSync(path.join(root, file), { presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]], babelrc: false, configFile: false }).code;
const source = compile('src/services/wallet/bootstrap.js');

const fixture = ({ ready = true, answers = true, connects = true, changing = false } = {}) => {
  const calls = [];
  const dispatched = [];
  const makeRpc = (isReady) => ({ ready: isReady, queue: {}, closed: false, autoReconnect: true,
    setAutoReconnect(value) { this.autoReconnect = value; }, close() { this.closed = true; } });
  const zenon = {
    wsClient: { _wsRpc2Client: makeRpc(ready) },
    ledger: { getFrontierMomentum: () => {
      calls.push('probe');
      if (answers === 'hang') {
        const rpc = zenon.wsClient._wsRpc2Client;
        return new Promise((resolve, reject) => { rpc.queue[Object.keys(rpc.queue).length + 1] = { promise: [resolve, reject] }; });
      }
      return answers ? Promise.resolve({}) : Promise.reject(new Error('refused'));
    } },
    clearSocketConnection() { calls.push('clear'); this.wsClient = undefined; },
    async initialize(url) {
      calls.push(`initialize ${url}`);
      this.wsClient = { _wsRpc2Client: makeRpc(false) };
      if (!connects) throw new Error('Timeout');
      this.wsClient._wsRpc2Client.ready = true;
    },
  };
  const stubs = {
    'znn-ts-sdk': { Zenon: { getSingleton: () => zenon, getChainIdentifier: () => 1 } },
    '../redux/connectionParametersSlice': {
      storeChainIdentifier: v => ({ type: 'chain', v }), storeIsConnected: v => ({ type: 'connected', v }), storeNodeUrl: v => ({ type: 'url', v }),
    },
    '../redux/walletSlice': { walletUnlocked: v => ({ type: 'unlocked', v }) },
    '../utils/storage': { defaultNodeUrl: 'wss://default.invalid', getAddressInfo: () => ({}), getCurrentNodeUrl: () => 'wss://node.invalid',
      setCurrentNodeUrl: () => {}, setLastWalletName: () => {} },
    './announce': { announceUnlock: async () => {} },
    './vault': { __esModule: true, default: {} },
    './readContext': { beginReadContextChange: () => () => {}, readContextChanging: () => changing },
    '../utils/popupState': { load: async () => {} },
    '../utils/errors': { fail: id => Object.assign(new Error(id === 108 ? 'The node connection was lost.' : `fail ${id}`), { errorId: id }) },
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', source)(mod, mod.exports, name => {
    if (!(name in stubs)) throw new Error(`unexpected require ${name}`);
    return stubs[name];
  });
  const dispatch = action => dispatched.push(action);
  return { zenon, calls, dispatched, dispatch, checkNode: mod.exports.checkNode,
    setChanging(value) { changing = value; },
    connected: () => dispatched.filter(a => a.type === 'connected').map(a => a.v) };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

(async () => {
  {
    const f = fixture();
    assert.equal(await f.checkNode(f.dispatch), true);
    assert.deepEqual(f.calls, ['probe']);
    assert.deepEqual(f.connected(), [true]);
  }
  {
    const f = fixture({ answers: 'hang' });
    const old = f.zenon.wsClient._wsRpc2Client;
    const started = Date.now();
    const hung = f.zenon.ledger.getFrontierMomentum();
    f.calls.length = 0;
    const result = f.checkNode(f.dispatch);
    await assert.rejects(hung, error => error.errorId === 108 && error.code === undefined);
    assert.equal(await result, true);
    assert(Date.now() - started < 4000, 'a half-open socket is replaced within the probe window');
    assert.equal(old.closed, true); assert.equal(old.autoReconnect, false); assert.deepEqual(old.queue, {});
    assert.deepEqual(f.calls.filter(c => c !== 'probe'), ['clear', 'initialize wss://node.invalid']);
    assert.deepEqual(f.connected(), [false, true]);
  }
  {
    const f = fixture({ ready: false });
    assert.equal(await f.checkNode(f.dispatch), true);
    assert.deepEqual(f.calls, ['clear', 'initialize wss://node.invalid']);
  }
  {
    const f = fixture({ ready: true });
    assert.equal(await f.checkNode(f.dispatch, () => true, { probe: false }), true);
    assert.deepEqual(f.calls, []);
  }
  {
    const f = fixture({ ready: false, connects: false });
    assert.equal(await f.checkNode(f.dispatch), false);
    assert.deepEqual(f.connected(), [false, false]);
  }
  {
    const f = fixture({ ready: false, changing: true });
    assert.equal(await f.checkNode(f.dispatch), null);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.dispatched, []);
  }
  {
    const f = fixture({ ready: false });
    assert.equal(await f.checkNode(f.dispatch, () => false), null);
    assert.deepEqual(f.calls, []);
  }
  {
    const f = fixture({ ready: false });
    const [a, b] = [f.checkNode(f.dispatch), f.checkNode(f.dispatch)];
    assert.equal(a, b);
    await a;
    assert.equal(f.calls.filter(c => c.startsWith('initialize')).length, 1);
  }
  {
    const f = fixture();
    const started = deferred();
    const reply = deferred();
    f.zenon.ledger.getFrontierMomentum = () => {
      started.resolve();
      return reply.promise;
    };
    const checking = f.checkNode(f.dispatch);
    await started.promise;
    const replacement = { ready: false, queue: {} };
    f.zenon.wsClient = { _wsRpc2Client: replacement };
    reply.resolve({});
    assert.equal(await checking, null);
    assert.deepEqual(f.connected(), [], 'a superseded probe cannot mark the replacement connected');
    assert.equal(f.zenon.wsClient._wsRpc2Client, replacement);
  }
  {
    const f = fixture();
    const started = deferred();
    const reply = deferred();
    f.zenon.ledger.getFrontierMomentum = () => {
      started.resolve();
      return reply.promise;
    };
    const checking = f.checkNode(f.dispatch);
    await started.promise;
    f.setChanging(true);
    reply.resolve({});
    assert.equal(await checking, null);
    assert.deepEqual(f.connected(), [], 'a probe cannot publish while another node change is open');
  }
  for (const succeeds of [true, false]) {
    const f = fixture({ ready: false });
    const started = deferred();
    const completed = deferred();
    f.zenon.initialize = () => {
      const reconnecting = { ready: false, queue: {} };
      f.zenon.wsClient = { _wsRpc2Client: reconnecting };
      started.resolve();
      return completed.promise.then(() => { reconnecting.ready = true; });
    };
    const checking = f.checkNode(f.dispatch);
    await started.promise;
    const replacement = { ready: !succeeds, queue: {} };
    f.zenon.wsClient = { _wsRpc2Client: replacement };
    if (!succeeds) f.dispatch({ type: 'connected', v: true });
    if (succeeds) completed.resolve();
    else completed.reject(new Error('superseded connection failed'));
    assert.equal(await checking, null);
    assert.deepEqual(f.connected(), succeeds ? [false] : [false, true],
      'a superseded reconnection cannot overwrite the replacement connection state');
    assert.equal(f.zenon.wsClient._wsRpc2Client, replacement);
  }
  console.log(JSON.stringify({ node_watch: true, cases: 12, passed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });

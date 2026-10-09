// Real read hooks and connection callbacks with queued React-style updates,
// inert RPC, synthetic account labels and lifecycle events. No wallet material,
// browser storage, real sockets, transactions or dependency changes.
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const React = require('react');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const compiled = new Map();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const sameDependencies = (left, right) => left && right && left.length === right.length &&
  left.every((value, index) => Object.is(value, right[index]));
const hookRuntime = () => {
  const states = [], refs = [], memo = [], effects = [], updates = [];
  let stateIndex, refIndex, memoIndex, effectIndex, nextEffects;
  const react = { ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => updates.push(() => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      })];
    },
    useRef: initial => refs[refIndex++] ??= { current: initial },
    useMemo(callback, dependencies) {
      const index = memoIndex++;
      if (!memo[index] || !sameDependencies(memo[index].dependencies, dependencies)) {
        memo[index] = { dependencies, value: callback() };
      }
      return memo[index].value;
    },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect: (callback, dependencies) => { nextEffects[effectIndex++] = { callback, dependencies }; },
    useContext: () => ({ showSpinner() {}, hideSpinner() {} }),
  };
  return { react, render(callback) {
    updates.splice(0).forEach(update => update());
    stateIndex = refIndex = memoIndex = effectIndex = 0;
    nextEffects = [];
    const result = callback();
    nextEffects.forEach((effect, index) => {
      if (sameDependencies(effects[index]?.dependencies, effect.dependencies)) return;
      effects[index]?.cleanup?.();
      effects[index] = { ...effect, cleanup: effect.callback() };
    });
    return result;
  }, cleanup: () => effects.forEach(effect => effect.cleanup?.()) };
};
const loader = (override, environment) => {
  const cache = new Map();
  const load = file => {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (!compiled.has(filename)) compiled.set(filename, babel.transformFileSync(filename, {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-react'],
      configFile: false, babelrc: false,
    }).code);
    const module = { exports: {} }; cache.set(filename, module);
    const requireModule = name => {
      const replaced = override(name);
      if (replaced !== undefined) return replaced;
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(path.extname(target) ? target : target + '.js');
    };
    // Execute only repository-owned Babel output inside this inert fixture.
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', ...Object.keys(environment), compiled.get(filename))(
      module, module.exports, requireModule, ...Object.values(environment));
    return module.exports;
  };
  return load;
};
const result = label => ({ balanceMap: { synthetic: label }, balances: [label] });
const block = (label, account = 'synthetic-account-a', extra = {}) => {
  const json = { hash: label.repeat(64), address: account, toAddress: 'synthetic-counterparty',
    blockType: 2, amount: '1', ...extra };
  return { ...json, toJson: () => ({ ...json }) };
};
const fixture = () => {
  const state = { chain: 69, node: 'wss://node-a.invalid', generation: 1,
    wallet: { walletName: 'synthetic-wallet-a', address: 'synthetic-account-a', selectedAddressIndex: 0 } };
  const makeSocket = (url = state.node) => {
    const rpc = new EventEmitter(); rpc.ready = true; rpc.socket = {}; rpc.address = url;
    return { url, _wsRpc2Client: rpc, sendRequest: async () => ({ chainIdentifier: state.chain }) };
  };
  const initial = makeSocket();
  const zenon = { wsClient: initial, ledger: { client: initial,
    getBlocksByPage: async () => ({ list: [] }), getAccountInfoByAddress: async () => result('initial') } };
  let singleton = zenon;
  zenon.clearSocketConnection = () => { zenon.wsClient = undefined; };
  zenon.initialize = async url => {
    initial.url = initial._wsRpc2Client.address = url;
    zenon.wsClient = initial; zenon.ledger.client = initial;
  };
  const sdk = { Zenon: { getSingleton: () => singleton, getChainIdentifier: () => state.chain,
    setChainIdentifier: value => { state.chain = value; } }, Constants: { defaultChainId: 69 } };
  const accountRuntime = hookRuntime(), historyRuntime = hookRuntime(), nodeRuntime = hookRuntime(), chainRuntime = hookRuntime();
  const runtimes = [accountRuntime, historyRuntime, nodeRuntime, chainRuntime];
  let activeRuntime = accountRuntime;
  const react = { ...React };
  ['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect', 'useContext'].forEach(method => {
    react[method] = (...args) => activeRuntime.react[method](...args);
  });
  const storageEvents = new EventEmitter();
  const load = loader(name => {
    if (name === 'react') return react;
    if (name === 'react-redux') return { useSelector: select => select({ wallet: state.wallet }), useDispatch: () => () => {} };
    if (name === 'znn-ts-sdk') return sdk;
    if (name.endsWith('/utils/storage')) return { getCurrentNodeUrl: () => {
      if (state.failRead) throw Error('Synthetic context read failure');
      return state.node;
    }, setCurrentNodeUrl: url => { state.node = url; }, getNodeList: () => [state.node], setNodeList() {},
      defaultNodeUrl: state.node, getAddressInfo: () => ({ selectedAddressIndex: 0 }) };
    if (name.endsWith('/wallet/vault')) return { isUnlocked: () => true,
      capture: () => ({ generation: state.generation }), isCurrent: scope => scope.generation === state.generation,
      getAddressObject: async () => state.derivedAddress ?? state.wallet.address };
    if (name.endsWith('/wallet/account')) return { fetchBalances: (client, address) => client.ledger.getAccountInfoByAddress(address) };
    if (name.endsWith('/wallet/announce')) return { announceNode: async () => {
      if (state.failAnnounce) throw Error('Synthetic node announcement failure');
    }, announceChain: async () => {}, captureLifetime: () => ({}) };
    if (name.endsWith('/utils/notify')) return { notify: { success() {}, error() {} } };
    if (name.endsWith('/spinner/spinnerContext')) return { SpinnerContext: {} };
    if (name.endsWith('/utils/contracts')) return { embeddedContractName: () => null };
    if (name.endsWith('/utils/contractCalls')) return { decodeCall: () => null, describeCall: () => '', contractDisplayName: () => '' };
    if (name.endsWith('/utils/outgoingBlock')) return { iconForContract: {} };
    if (name.includes('/components/')) return () => null;
  }, { window: { addEventListener: (event, callback) => storageEvents.on(event, callback) },
    setTimeout: () => 1, clearTimeout() {} });
  const useAccount = load('src/services/hooks/useAccount.js').default;
  const useTransactions = load('src/services/hooks/useTransactions.js').default;
  const render = (runtime, callback) => { activeRuntime = runtime; return runtime.render(callback); };
  const account = () => render(accountRuntime, () => useAccount({ balances: false }));
  const newAccount = () => {
    const runtime = hookRuntime(); runtimes.push(runtime);
    return render(runtime, () => useAccount({ balances: false }));
  };
  const history = () => render(historyRuntime, () => useTransactions(state.addressObject ?? state.wallet.address, state.wallet.address));
  const node = () => render(nodeRuntime, () => load('src/services/hooks/useNodeList.js').default());
  const chain = () => render(chainRuntime, () => load('src/pages/settings/change-node/change-node.js').default());
  const find = (tree, test) => {
    if (!tree || typeof tree !== 'object') return undefined;
    if (test(tree)) return tree;
    const children = tree.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const match = find(child, test); if (match) return match;
    }
  };
  const writeChain = async value => {
    const input = find(chain(), tree => tree.type === 'input');
    input.props.onChange({ target: { value: String(value) } });
    const form = find(chain(), tree => tree.type === 'form');
    form.props.onSubmit({ preventDefault() {} });
    await flush();
  };
  const move = async transition => {
    if (transition === 'address') state.wallet.address = 'synthetic-account-b';
    if (transition === 'wallet') state.wallet.walletName = 'synthetic-wallet-b';
    if (transition === 'index') state.wallet.selectedAddressIndex = 1;
    if (transition === 'chain') state.chain = 70;
    if (transition === 'node') state.node = 'wss://node-b.invalid';
    if (transition === 'endpoint') zenon.wsClient.url = 'wss://node-b.invalid';
    if (transition === 'rpc-endpoint') zenon.wsClient._wsRpc2Client.address = 'wss://node-b.invalid';
    if (transition === 'client') { const next = makeSocket(); zenon.wsClient = next; zenon.ledger.client = next; }
    if (transition === 'rpc') zenon.wsClient._wsRpc2Client = makeSocket()._wsRpc2Client;
    if (transition === 'transport') zenon.wsClient._wsRpc2Client.socket = {};
    if (transition === 'same-endpoint-reconnect') {
      const rpc = zenon.wsClient._wsRpc2Client, transport = rpc.socket;
      rpc.ready = false; rpc.emit('close'); rpc.ready = true; rpc.socket = transport; rpc.emit('open');
    }
    if (transition === 'explicit-reconnect') await node().select(state.node);
    if (transition === 'chain-aba') { await writeChain(70); await writeChain(69); }
    if (transition === 'storage-aba') { storageEvents.emit('storage', { key: 'currentNodeUrl' }); }
    if (transition === 'singleton') singleton = { ...zenon };
    if (transition === 'context-read') state.failRead = true;
    if (transition === 'vault') state.generation += 1;
    account(); history();
  };
  account(); history();
  return { state, zenon, load, account, newAccount, history, node, move,
    cleanup: () => runtimes.forEach(runtime => runtime.cleanup()) };
};

(async () => {
  const transitions = ['address', 'chain', 'node', 'endpoint', 'rpc-endpoint', 'client', 'rpc', 'transport', 'same-endpoint-reconnect',
    'explicit-reconnect', 'chain-aba', 'storage-aba', 'singleton', 'context-read'];
  // Balance success and failure cannot cross a context, wallet/account or vault
  // lifetime. New mounts must not recover the rejected response from the cache.
  for (const transition of [...transitions, 'wallet', 'index', 'vault', 'invalidate', 'unmount']) {
    for (const completion of ['success', 'failure']) {
      const f = fixture(), gate = deferred();
      f.zenon.ledger.getAccountInfoByAddress = () => gate.promise;
      const pending = f.account().refresh(); await flush();
      if (transition === 'invalidate') f.load('src/services/hooks/useAccount.js').invalidateAccountCache();
      else if (transition === 'unmount') f.cleanup();
      else await f.move(transition);
      if (completion === 'success') gate.resolve(result('stale'));
      else gate.reject(Error('Synthetic old balance failure'));
      assert.equal(await pending, null, transition + ' released stale balance data');
      const view = f.account();
      assert.deepEqual(view.balances, [], transition + ' showed stale balance data');
      assert.equal(view.error, null, transition + ' showed stale balance failure');
      f.cleanup();
    }
  }
  // Queued setters must still commit a valid result after request cleanup.
  {
    const f = fixture();
    f.zenon.ledger.getAccountInfoByAddress = async () => result('current');
    await f.account().refresh();
    assert.deepEqual(f.account().balances, ['current']);
    f.zenon.ledger.getBlocksByPage = async () => ({ list: [block('a')] });
    await f.history().loadMore();
    assert.equal(f.history().items[0].hash, 'a'.repeat(64));
    assert.equal(f.history().isLoading, false);
    f.cleanup();
  }
  // Same-address reads after reconnect do not reuse a previously warm cache.
  {
    const f = fixture();
    await f.account().refresh(); assert.deepEqual(f.account().balances, ['initial']);
    assert.deepEqual(f.newAccount().balances, ['initial']);
    await f.move('same-endpoint-reconnect');
    assert.deepEqual(f.account().balances, []);
    assert.deepEqual(f.newAccount().balances, []);
    f.zenon.ledger.getAccountInfoByAddress = async () => result('reconnected');
    await f.account().refresh(); assert.deepEqual(f.account().balances, ['reconnected']);
    f.cleanup();
  }
  // Cache invalidation fences a retained callback even before React applies
  // the subscription update. Current results retain all SDK display metadata.
  {
    const f = fixture(); let reads = 0;
    const current = { balances: [{ symbol: 'SYN', decimals: 8, opaqueMetadata: { label: 'synthetic' } }],
      balanceMap: { synthetic: { units: '123', label: 'synthetic' } } };
    f.zenon.ledger.getAccountInfoByAddress = async () => { reads++; return current; };
    const staleRefresh = f.account().refresh;
    f.load('src/services/hooks/useAccount.js').invalidateAccountCache();
    assert.equal(await staleRefresh(), null); assert.equal(reads, 0);
    assert.equal(await f.account().refresh(), current);
    const warm = f.newAccount();
    assert.equal(warm.balances, current.balances);
    assert.equal(warm.balanceMap, current.balanceMap);
    f.cleanup();
  }
  // Pagination: stale empty/success/error/finally callbacks neither append rows
  // nor change the new account's error, continuation or loading ownership.
  for (const transition of [...transitions, 'reset', 'unmount']) {
    for (const completion of ['success', 'empty', 'failure']) {
      const f = fixture(), old = deferred(), next = deferred();
      f.zenon.ledger.getBlocksByPage = () => old.promise;
      const pending = f.history().loadMore();
      if (transition === 'reset') f.history().reset();
      else if (transition === 'unmount') f.cleanup();
      else await f.move(transition);
      f.zenon.ledger.getBlocksByPage = () => next.promise;
      const current = f.history().loadMore();
      const loading = f.history().isLoading;
      if (completion === 'failure') old.reject(Error('Synthetic old page failure'));
      else old.resolve({ list: completion === 'empty' ? [] : [block('a')] });
      await pending;
      const view = f.history();
      assert.equal(view.items.length, 0, transition + ' appended old page');
      assert.equal(view.error, null, transition + ' installed old page error');
      assert.equal(view.hasMore, true, transition + ' disabled new pagination');
      assert.equal(view.isLoading, loading, transition + ' released another request loading');
      next.resolve({ list: [block('b', f.state.wallet.address)] }); await current;
      if (loading) assert.equal(f.history().items[0].hash, 'b'.repeat(64), transition + ' blocked current page');
      f.cleanup();
    }
  }
  // A transition while resolving a receive's referenced send retires the page.
  {
    const f = fixture(), gate = deferred();
    f.zenon.ledger.getBlocksByPage = async () => ({ list: [block('a', undefined, { blockType: 3, fromBlockHash: 'c'.repeat(64) })] });
    f.zenon.ledger.getBlockByHash = () => gate.promise;
    const pending = f.history().loadMore(); await flush();
    await f.move('same-endpoint-reconnect'); gate.resolve(block('c'));
    await pending; assert.equal(f.history().items.length, 0); f.cleanup();
  }
  // The real dashboard can render the new Redux account before its asynchronous
  // address-object effect resolves. That lagging pair must not issue a read.
  {
    const f = fixture(), gate = deferred(); let reads = 0;
    f.zenon.ledger.getBlocksByPage = () => { reads++; return gate.promise; };
    const pending = f.history().loadMore();
    f.state.addressObject = f.state.wallet.address;
    await f.move('address');
    assert.equal(await f.history().loadMore(), undefined);
    assert.equal(reads, 1, 'a lagging address object issued a page under another account');
    gate.resolve({ list: [block('a')] }); await pending;
    assert.equal(f.history().items.length, 0);
    f.state.addressObject = f.state.wallet.address;
    f.zenon.ledger.getBlocksByPage = async () => ({ list: [block('b', f.state.wallet.address)] });
    await f.history().loadMore();
    assert.equal(f.history().items[0].hash, 'b'.repeat(64));
    f.cleanup();
  }
  {
    const f = fixture(); let reads = 0;
    f.state.derivedAddress = 'synthetic-account-b';
    f.zenon.ledger.getAccountInfoByAddress = async () => { reads++; return result('wrong-account'); };
    assert.equal(await f.account().refresh(), null);
    assert.equal(reads, 0, 'an address derivation mismatch issued a balance read');
    const view = f.account();
    assert.equal(view.isLoading, false, 'a current derivation mismatch left loading active');
    assert.match(view.error.message, /selected account changed/);
    assert.deepEqual(view.balances, []);
    f.cleanup();
  }
  // Newest-history observations also cannot regain authority after same-object
  // close/open or an explicit same-endpoint reconnect.
  for (const transition of ['same-endpoint-reconnect', 'explicit-reconnect', 'chain-aba']) {
    const f = fixture(), gate = deferred();
    f.zenon.ledger.getBlocksByPage = () => gate.promise;
    const pending = f.history().refreshNewest();
    await f.move(transition); gate.resolve({ list: [block('a')] });
    assert.equal(await pending, undefined); assert.equal(f.history().items.length, 0); f.cleanup();
  }
  // The actual node-selection callback suspends reads until initialization ends.
  {
    const f = fixture(), gate = deferred();
    let reads = 0;
    f.zenon.ledger.getAccountInfoByAddress = async () => { reads++; return result('connected'); };
    f.zenon.initialize = () => gate.promise;
    const pending = f.node().select(f.state.node);
    assert.equal(await f.account().refresh(), null); assert.equal(reads, 0);
    f.zenon.wsClient = f.zenon.ledger.client;
    gate.resolve(); await pending;
    await f.account().refresh(); assert.deepEqual(f.account().balances, ['connected']);
    f.cleanup();
  }
  // A shared URL update cannot relabel an old document's physical connection.
  // An announcement failure after persistence can also restore the previous
  // socket while leaving the stored URL changed: both stay unavailable.
  for (const transition of ['shared-url', 'fallback-after-persist']) {
    const f = fixture(); let reads = 0;
    f.zenon.ledger.getAccountInfoByAddress = async () => { reads++; return result('old-node'); };
    if (transition === 'shared-url') {
      await f.move('node'); await f.move('storage-aba');
    } else {
      f.state.failAnnounce = true;
      assert.equal(await f.node().select('wss://node-b.invalid'), false);
    }
    assert.equal(await f.account().refresh(), null);
    assert.equal(await f.history().loadMore(), undefined);
    assert.equal(reads, 0, transition + ' read the old socket under the new URL');
    assert.deepEqual(f.account().balances, []);
    f.state.failAnnounce = false;
    assert.equal(await f.node().select(f.state.node), true);
    await f.account().refresh();
    assert.deepEqual(f.account().balances, ['old-node']);
    f.cleanup();
  }
  console.log('Account read context checks passed: balance cache, stale success/error, page/reset/loading ownership, SDK transport/reconnect generations and exact-hash observation fences.');
})().catch(error => { console.error(error); process.exitCode = 1; });

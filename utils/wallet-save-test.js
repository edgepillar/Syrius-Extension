'use strict';

// Persistence control-flow fixtures only: opaque encrypted values, inert
// derivation/parser boundaries, no recovery phrase, private key or real storage.
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const React = require('react');
const root = path.join(__dirname, '..');
const compiled = new Map();
const password = 'Valid-fixture1!';
const storageKey = 'synthetic-wallets';
const load = (file, resolve, storage) => {
  const filename = path.join(root, file);
  if (!compiled.has(filename)) compiled.set(filename, babel.transformFileSync(filename, {
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }], ['@babel/preset-react', { runtime: 'classic' }]],
    configFile: false, babelrc: false,
  }).code);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'localStorage', compiled.get(filename))(
    module, module.exports, resolve, storage);
  return module.exports;
};
const finite = async (promise) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Wallet save did not settle')), 1000);
    })]);
  } finally { clearTimeout(timer); }
};
const fixture = () => {
  const state = { encrypted: { opaqueEncryptedValue: { version: 1 } }, existing: { retained: { opaqueEncryptedValue: 'retained' } },
    writes: [], encryptions: [], reads: 0, derivations: 0, commits: 0, notices: [], unlocks: 0, navigation: [],
    lockEffects: [], lifecycle: new Set(), locks: 0, autoLockMinutes: 0 };
  const store = { getKeyPair: () => ({ getAddress: async () => {
    state.derivations += 1;
    if (state.deriveError) throw state.deriveError;
    return { toString: () => 'synthetic-derived-address' };
  } }) };
  const sdk = {
    KeyFile: { encrypt: async (input, secret) => {
      state.encryptions.push([input, secret]);
      if (state.encryptError) throw state.encryptError;
      if (state.encryptPromise) return state.encryptPromise;
      return state.encrypted;
    } },
    KeyStoreManager: class {
      constructor() { this.walletPath = storageKey; }
      listAllKeyStores() {
        state.reads += 1;
        if (state.readError) throw state.readError;
        return structuredClone(state.existing);
      }
      saveKeyStore() { throw new Error('The unsettled manager path must not execute'); }
    },
    // The import callback's parser is an inert boundary accepting no material.
    KeyStore: class { fromMnemonic() { return store; } },
  };
  const storage = { setItem: (key, raw) => {
    state.writes.push({ key, raw });
    if (state.writeError) throw state.writeError;
    state.commits += 1;
  } };
  // Besides the SDK, the policy imports only the error catalogue, loaded for real.
  const errorModules = (name) => load(`src/services/utils/${name.split('/').pop()}.js`, errorModules, storage);
  const policy = load('src/services/wallet/password.js', (name) => {
    if (name === '../utils/errors') return errorModules(name);
    assert.equal(name, 'znn-ts-sdk'); return sdk;
  }, storage);
  return { state, store, sdk, storage, policy };
};
const elements = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
};
// The phone (services/utils/app) as the offer of biometric unlock sees it:
// f.state.phone is null in a browser, or { available, enabled, enable }.
const appModule = (f) => ({ __esModule: true, default: () => f.state.phone && { biometric: {
  available: async () => { if (f.state.phone.available instanceof Error) throw f.state.phone.available; return f.state.phone.available; },
  enabled: async (name) => { f.state.phone.asked = name; return f.state.phone.enabled; },
  enable: async (name, secret) => { f.state.phone.stored = [name, secret]; if (f.state.phone.refuse) throw f.state.phone.refuse; },
}, onLifecycle: (listener) => { f.state.lifecycle.add(listener); return () => f.state.lifecycle.delete(listener); },
}, biometricName: () => 'Fingerprint', biometricIcon: () => 'fingerprint' });
const notifyModule = (f) => ({ notify: {
  error: (error) => f.state.notices.push({ error }), success: (success) => f.state.notices.push({ success }),
} });
// The real shared lock hook with inert wallet/phone boundaries. Lifecycle
// effects are committed explicitly below and cleaned up on unmount.
const appLockModule = (f) => load('src/services/hooks/useAppLock.js', (name) => {
  if (name === 'react') return { useEffect: (effect) => f.state.lockEffects.push(effect) };
  if (name === 'react-router-dom') return { useNavigate: () => (...args) => f.state.navigation.push(args) };
  if (name === 'react-redux') return { useDispatch: () => () => {} };
  if (name.endsWith('/utils/app')) return appModule(f);
  if (name.endsWith('/wallet/lock')) return { __esModule: true, default: async () => { f.state.locks++; } };
  if (name.endsWith('/wallet/sessionLease')) return { __esModule: true, default: { never: -1 } };
  if (name.endsWith('/utils/storage')) return { getSettings: () => ({ autoLockMinutes: f.state.autoLockMinutes }) };
  if (name.endsWith('/utils/notify')) return notifyModule(f);
  if (name.endsWith('/redux/walletSlice')) return { resetWalletState: () => ({}) };
  if (name.endsWith('/redux/pendingTransactionsSlice')) return { resetPendingTransactions: () => ({}) };
  if (name === './useAccount') return { invalidateAccountCache: () => {} };
  throw new Error('Unexpected lock-hook dependency: ' + name);
}, f.storage);
const offerModule = (f, react = { ...React, useState: (initial) => [initial, () => {}] }) => load('src/components/biometric-offer/biometric-offer.js', (name) => {
  if (name === 'react') return react;
  if (name.endsWith('/services/utils/app')) return appModule(f);
  if (name.endsWith('/utils/notify')) return notifyModule(f);
  if (name.endsWith('/hooks/useAppLock')) return appLockModule(f);
  return () => null;
}, f.storage);
const page = (kind, f) => {
  // Creation's confirmation boundary uses an opaque split sentinel, rather
  // than constructing or rendering a phrase. Only the final save callback runs.
  const sentinel = Object.freeze({});
  const values = kind === 'create'
    ? [2, 'test-wallet', password, password, f.store, { split: () => [sentinel] }, [{ position: 0, options: [sentinel] }], [sentinel], true, false, null]
    : [1, '', 'test-wallet', password, password, false, null];
  const busyIndex = kind === 'create' ? 9 : 5;
  const offerIndex = busyIndex + 1;
  let cursor = 0;
  const Component = load(kind === 'create' ? 'src/pages/get-started/get-started.js' : 'src/pages/import-recovery/recovery.js', (name) => {
    if (name === 'react') return { ...React, useState: () => {
      const index = cursor++;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    }, useMemo: (callback) => callback() };
    if (name === 'react-router-dom') return { useNavigate: () => (...args) => f.state.navigation.push(args) };
    if (name === 'react-redux') return { useDispatch: () => () => {} };
    if (name === 'react-hook-form') return { useForm: () => ({ register: () => ({}), handleSubmit: (callback) => callback,
      formState: { errors: {} }, setValue: () => {} }) };
    if (name === 'znn-ts-sdk') return f.sdk;
    if (name.endsWith('/wallet/password')) return f.policy;
    if (name.endsWith('/wallet/bootstrap')) return { completeUnlock: async () => { f.state.unlocks += 1; } };
    if (name.endsWith('/wallet/phraseQuiz')) return load('src/services/wallet/phraseQuiz.js', () => null);
    if (name.endsWith('/utils/utils')) return { sanitizeWalletName: (name) => name, loadStorageWalletNames: () => [] };
    if (name.endsWith('/utils/notify')) return notifyModule(f);
    if (name.endsWith('/services/utils/app')) return appModule(f);
    if (name.endsWith('/biometric-offer/biometric-offer')) return offerModule(f);
    return () => null;
  }, f.storage).default;
  const render = () => { cursor = 0; return Component(); };
  const submit = () => kind === 'create'
    ? elements(render()).filter((element) => element.type === 'button' && element.props.onClick).at(-1).props.onClick()
    : elements(render()).find((element) => element.type === 'form').props.onSubmit();
  return { submit, render, isBusy: () => values[busyIndex], offerFor: () => values[offerIndex] };
};

(async () => {
  // Preserve the pinned manager's name/fallback, return value and raw KeyFile
  // object serialization. Do not switch to its differently shaped toJson().
  for (const [inputName, expectedName] of [['Wallet With Spaces', 'Wallet-With Spaces'],
    ['test-wallet', 'test-wallet'], [undefined, 'synthetic-derived-address'], ['', 'synthetic-derived-address'], [42, 'synthetic-derived-address']]) {
    const f = fixture();
    f.state.encrypted.toJson = () => { throw new Error('Raw KeyFile serialization must be preserved'); };
    assert.equal(await finite(f.policy.saveWalletWithPassword(f.store, password, inputName)), storageKey + expectedName);
    assert.equal(f.state.encryptions.length, 1);
    assert.deepEqual(f.state.encryptions[0], [f.store, password]);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.writes[0].key, storageKey);
    assert.deepEqual(JSON.parse(f.state.writes[0].raw), { ...f.state.existing, [expectedName]: { opaqueEncryptedValue: { version: 1 } } });
    assert.equal(f.state.commits, 1);
  }
  {
    const f = fixture();
    await assert.rejects(finite(f.policy.saveWalletWithPassword(f.store, 'weak', 'test-wallet')), /at least 8 characters/);
    assert.equal(f.state.encryptions.length, 0);
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes.length, 0);
  }
  for (const failure of ['derive', 'encrypt', 'read', 'write']) {
    const f = fixture(), error = new Error('Synthetic ' + failure + ' failure');
    f.state[failure + 'Error'] = error;
    await assert.rejects(finite(f.policy.saveWalletWithPassword(f.store, password,
      failure === 'derive' ? undefined : 'test-wallet')), (actual) => actual === error);
    assert.equal(f.state.commits, 0);
    assert.equal(f.state.writes.length, failure === 'write' ? 1 : 0);
    assert.equal(f.state.encryptions.length, failure === 'derive' ? 0 : 1);
  }
  for (const invalid of [null, [], 1, 'invalid-map']) {
    const f = fixture(); f.state.existing = invalid;
    await assert.rejects(finite(f.policy.saveWalletWithPassword(f.store, password, 'test-wallet')), /could not be read safely/);
    assert.equal(f.state.writes.length, 0);
  }
  for (const invalid of [null, undefined, [], 1, 'invalid-encrypted-value', false]) {
    const f = fixture(); f.state.encrypted = invalid;
    await assert.rejects(finite(f.policy.saveWalletWithPassword(f.store, password, 'test-wallet')), /could not be created safely/);
    assert.equal(f.state.encryptions.length, 1);
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes.length, 0);
  }
  {
    const f = fixture();
    let resolve;
    f.state.encryptPromise = new Promise((done) => { resolve = done; });
    const pending = f.policy.saveWalletWithPassword(f.store, password, 'test-wallet');
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.writes.length, 0, 'save did not await encryption');
    resolve(f.state.encrypted);
    assert.equal(await finite(pending), storageKey + 'test-wallet');
    assert.equal(f.state.encryptions.length, 1);
    assert.equal(f.state.commits, 1);
  }

  // Real create/import final callbacks must unwind busy state and never claim
  // success/unlock/navigation when encryption or persistent writing rejects.
  for (const kind of ['create', 'import']) {
    for (const failure of ['encrypt', 'write', 'read']) {
      const f = fixture(), error = new Error('Synthetic ' + failure + ' failure');
      f.state[failure + 'Error'] = error;
      const view = page(kind, f);
      const pending = view.submit();
      assert.equal(view.isBusy(), true);
      await finite(pending);
      assert.equal(view.isBusy(), false);
      assert.deepEqual(f.state.notices, [{ error }]);
      assert.equal(f.state.unlocks, 0);
      assert.equal(f.state.navigation.length, 0);
      assert.equal(f.state.commits, 0);
    }
    const f = fixture(), view = page(kind, f);
    await finite(view.submit());
    assert.equal(view.isBusy(), false);
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.unlocks, 1);
    assert.equal(f.state.notices.length, 1);
    assert.equal(typeof f.state.notices[0].success, 'string');
    assert.equal(f.state.navigation.length, 1);
    assert.equal(view.offerFor(), null);
  }

  // In the app, a new or imported wallet is offered biometric unlock before
  // the dashboard, only where the phone has it and the wallet does not use it.
  for (const kind of ['create', 'import']) {
    const f = fixture(); f.state.phone = { available: true, enabled: false };
    const view = page(kind, f);
    await finite(view.submit());
    assert.equal(f.state.unlocks, 1);
    assert.equal(f.state.phone.asked, 'test-wallet');
    assert.equal(f.state.navigation.length, 0, 'went on before the offer');
    assert.equal(view.offerFor(), 'test-wallet');
    const offer = elements(view.render()).find((element) => element.props?.walletName);
    assert.equal(offer.props.walletName, 'test-wallet');
    assert.equal(offer.props.password, password);
    offer.props.onDone();
    assert.deepEqual(f.state.navigation, [['/tabs/dashboard', { replace: true }]]);
    for (const phone of [{ available: false, enabled: false }, { available: true, enabled: true }, { available: new Error('Synthetic plugin failure') }]) {
      const g = fixture(); g.state.phone = phone;
      const other = page(kind, g);
      await finite(other.submit());
      assert.equal(other.offerFor(), null);
      assert.equal(g.state.navigation.length, 1);
    }
  }
  // The offer itself: Turn on stores the password behind the biometric and
  // goes on; a cancelled prompt stays, with the wallet ready either way.
  for (const refuse of [null, new Error('Synthetic cancelled prompt')]) {
    const f = fixture(); f.state.phone = { available: true, enabled: false, refuse };
    let saving = false, done = 0;
    const hooks = { ...React, useState: (initial) => [saving ?? initial, (next) => { saving = next; }] };
    const Offer = offerModule(f, hooks).default;
    const view = () => elements(Offer({ walletName: 'test-wallet', password, onDone: () => { done += 1; } }));
    const turnOn = view().find((element) => element.type === 'button' && /Turn on/.test(element.props.children)).props.onClick;
    await finite(turnOn());
    assert.deepEqual(f.state.phone.stored, ['test-wallet', password]);
    assert.equal(done, refuse ? 0 : 1);
    assert.equal(saving, refuse ? false : true);
    assert.deepEqual(f.state.notices, [refuse ? { error: refuse } : { success: 'Fingerprint unlock on' }]);
    const notNow = view().find((element) => element.type === 'button' && element.props.children === 'Not now');
    notNow.props.onClick(); assert.equal(done, refuse ? 1 : 2);
  }
  // The actual create/import callbacks hand their unlocked wallet to an offer
  // that owns foreground locking before TabsLayout exists. No SDK secrets or
  // native biometric prompt are created by these phone lifecycle fixtures.
  for (const kind of ['create', 'import']) for (const minutes of [0, 5, 15, 60]) {
    const f = fixture(); f.state.phone = { available: true, enabled: false };
    f.state.autoLockMinutes = minutes;
    const view = page(kind, f);
    await finite(view.submit());
    assert.equal(f.state.unlocks, 1);
    assert.equal(f.state.navigation.length, 0);
    const offer = elements(view.render()).find((element) => element.props?.walletName);
    offer.type(offer.props);
    assert.equal(f.state.lockEffects.length, 1, kind + ': the offer must own the native lock lifecycle');
    const cleanup = f.state.lockEffects[0]();
    assert.equal(f.state.lifecycle.size, 1);
    const emit = async (event) => { for (const listener of f.state.lifecycle) await listener(event); };
    await emit({ state: 'background', own: false, away: 0 });
    // The phone's biometric prompt remains an owned UI trip past the deadline.
    await emit({ state: 'foreground', own: true, away: minutes * 60000 + 1 });
    if (minutes) await emit({ state: 'foreground', own: false, away: minutes * 60000 - 1 });
    assert.equal(f.state.locks, 0);
    await emit({ state: 'foreground', own: false, away: minutes * 60000 });
    assert.equal(f.state.locks, 1, kind + ': lock on a normal return, including On close');
    assert.deepEqual(f.state.navigation.at(-1), ['/password', { replace: true }]);
    cleanup();
    assert.equal(f.state.lifecycle.size, 0);
    await emit({ state: 'foreground', own: false, away: 3600000 });
    assert.equal(f.state.locks, 1, 'unmounted offer must not keep a listener');
  }
  // Never: no time away locks the app.
  {
    const f = fixture(); f.state.phone = { available: true, enabled: false };
    f.state.autoLockMinutes = -1;
    const view = page('create', f);
    await finite(view.submit());
    const offer = elements(view.render()).find((element) => element.props?.walletName);
    offer.type(offer.props);
    const cleanup = f.state.lockEffects[0]();
    for (const listener of f.state.lifecycle) await listener({ state: 'foreground', own: false, away: 30 * 24 * 3600000 });
    assert.equal(f.state.locks, 0);
    cleanup();
  }
  // The tab screens still use the same hook; their unrelated incoming polling
  // effect is not launched by this control.
  {
    const f = fixture(); f.state.phone = {};
    const Watch = load('src/components/app-watch/app-watch.js', (name) => {
      if (name === 'react') return { useEffect: () => {}, useRef: (value) => ({ current: value }) };
      if (name.endsWith('/hooks/useAppLock')) return appLockModule(f);
      return {};
    }).default;
    Watch();
    assert.equal(f.state.lockEffects.length, 1);
    const cleanup = f.state.lockEffects[0]();
    assert.equal(f.state.lifecycle.size, 1);
    cleanup(); assert.equal(f.state.lifecycle.size, 0);
  }
  console.log('Wallet save checks passed: finite derivation/encryption/write failures, password policy, pinned storage shape/name fallback, create/import cleanup, biometric offer and native lock lifecycle ownership.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

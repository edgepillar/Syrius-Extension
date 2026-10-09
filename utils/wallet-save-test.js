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
    presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-react'],
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
    writes: [], encryptions: [], reads: 0, derivations: 0, commits: 0, notices: [], unlocks: 0, navigation: [] };
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
  const policy = load('src/services/wallet/password.js', (name) => {
    assert.equal(name, 'znn-ts-sdk'); return sdk;
  }, storage);
  return { state, store, sdk, storage, policy };
};
const elements = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
};
const page = (kind, f) => {
  // Creation's confirmation boundary uses an opaque split sentinel, rather
  // than constructing or rendering a phrase. Only the final save callback runs.
  const sentinel = Object.freeze({});
  const values = kind === 'create'
    ? [2, 'test-wallet', password, password, f.store, { split: () => [sentinel] }, [], [sentinel], true, false]
    : [1, '', 'test-wallet', password, password, false];
  const busyIndex = kind === 'create' ? 9 : 5;
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
    if (name.endsWith('/utils/utils')) return { sanitizeWalletName: (name) => name, loadStorageWalletNames: () => [] };
    if (name.endsWith('/utils/notify')) return { notify: {
      error: (error) => f.state.notices.push({ error }), success: (success) => f.state.notices.push({ success }),
    } };
    return () => null;
  }, f.storage).default;
  const render = () => { cursor = 0; return Component(); };
  const submit = () => kind === 'create'
    ? elements(render()).find((element) => element.type === 'button' && element.props.onClick).props.onClick()
    : elements(render()).find((element) => element.type === 'form').props.onSubmit();
  return { submit, isBusy: () => values[busyIndex] };
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
  }
  console.log('Wallet save checks passed: finite derivation/encryption/write failures, password policy, pinned storage shape/name fallback and actual create/import busy cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

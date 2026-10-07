'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const React = require('react');

const load = (file, resolve) => {
  const { code } = babel.transformFileSync(path.join(__dirname, '..', file), {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-react'],
    babelrc: false, configFile: false,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, resolve);
  return module.exports;
};
const chain = load('src/services/utils/chainId.js', name => {
  assert.equal(name, 'znn-ts-sdk');
  return { Constants: { defaultChainId: 1 } };
});
const maximum = Number.MAX_SAFE_INTEGER;
const valid = [1, 69, maximum, '1', '69', String(maximum), ' 69\n'];
const invalid = [
  '', ' ', '0', '-1', '+1', '01', '1.0', '1e3', '0x10', '1_000', 'Infinity',
  '9007199254740992', '9007199254740993', '18446744073709551615',
  0, -1, 1.5, maximum + 1, NaN, Infinity, -Infinity, null, undefined, true,
  false, [], ['1'], {}, new Number(1), { toString() { throw new Error('must not coerce'); } },
];
for (const input of valid) {
  assert.equal(chain.parseChainId(input), Number(input));
  assert.equal(String(chain.parseChainId(input)), String(Number(input)));
}
for (const input of invalid) assert.equal(chain.parseChainId(input), null);

const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
  ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];

// Invoke the actual settings submit callback, replacing storage, browser and
// node boundaries. Invalid input must not reach a chain write or announcement.
const submit = async input => {
  let stateIndex = 0;
  const states = [1, input, { isDetecting: false, chainId: null }];
  const writes = [], actions = [], announcements = [], errors = [], success = [];
  const Component = load('src/pages/settings/change-node/change-node.js', name => {
    if (name === 'react') return { ...React,
      useCallback: fn => fn, useEffect: () => {},
      useState: () => { const index = stateIndex++; return [states[index], next => { states[index] = next; }]; },
    };
    if (name === 'react-redux') return { useDispatch: () => action => actions.push(action) };
    if (name === 'znn-ts-sdk') return { Zenon: {
      getChainIdentifier: () => 1, setChainIdentifier: value => writes.push(value),
      getSingleton: () => { throw new Error('must not connect'); },
    } };
    if (name.endsWith('/node-list/node-list')) return () => null;
    if (name.endsWith('/hooks/useNodeList')) return () => ({ nodes: [], currentNode: null });
    if (name.endsWith('/redux/connectionParametersSlice')) return {
      storeChainIdentifier: value => ({ type: 'chain', payload: value }),
    };
    if (name.endsWith('/utils/chainId')) return chain;
    if (name.endsWith('/utils/notify')) return { notify: {
      error: value => errors.push(value), success: value => success.push(value),
    } };
    if (name.endsWith('/wallet/announce')) return {
      captureLifetime: () => 'fixture-lifetime', announceChain: async value => announcements.push(value),
    };
    throw new Error(`Unexpected import: ${name}`);
  }).default;
  const form = elements(Component()).find(element => element.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  return { states, writes, actions, announcements, errors, success };
};

(async () => {
  for (const input of ['9007199254740993', '01', '1e3', '']) {
    const result = await submit(input);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.announcements, []);
    assert.equal(result.errors.length, 1);
    assert.equal(result.success.length, 0);
  }
  for (const input of ['69', String(maximum)]) {
    const result = await submit(input);
    assert.deepEqual(result.writes, [Number(input)]);
    assert.deepEqual(result.actions, [{ type: 'chain', payload: Number(input) }]);
    assert.deepEqual(result.announcements, ['fixture-lifetime']);
    assert.equal(result.states[0], Number(input));
    assert.equal(result.states[1], String(Number(input)));
    assert.equal(result.errors.length, 0);
    assert.equal(result.success.length, 1);
  }
  for (const value of [69, '69', '9007199254740993', { chain: 1 }]) {
    const requests = [];
    const detected = await chain.detectNodeChainId({ ledger: { client: { sendRequest: async (...args) => {
      requests.push(args); return { chainIdentifier: value };
    } } } });
    assert.equal(detected, chain.parseChainId(value));
    assert.deepEqual(requests, [['ledger.getFrontierMomentum', []]]);
  }
  assert.equal(await chain.detectNodeChainId({}), null);
  console.log('chain identifiers: exact bounds, canonical input, settings write refusal and inert node suggestions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

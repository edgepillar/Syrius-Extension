'use strict';
// Actual presentation/modal modules with inert state and callbacks. No wallet,
// storage, SDK, browser profile or network endpoint is accessed.
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..'), cache = new Map();
const state = { connectionParameters: { chainIdentifier: 1, nodeUrl: 'wss://fixture-user:fixture-value@node.fixture.invalid:35998/private-route?fixture=hidden#detail' } };
const ModalContext = React.createContext({ closeModal() {} });
const load = file => {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const { code } = babel.transformFileSync(filename, {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-react'],
    configFile: false, babelrc: false,
  });
  const resolve = id => {
    if (id === 'react-redux') return { useSelector: select => select(state) };
    if (id.endsWith('/hooks/modal/modalContext')) return { ModalContext };
    if (id.endsWith('.svg')) return 'inert-icon.svg';
    if (!id.startsWith('.')) return require(id);
    const target = path.resolve(path.dirname(filename), id);
    return load(path.extname(target) ? target : target + '.js');
  };
  new Function('module', 'exports', 'require', code)(module, module.exports, resolve);
  return module.exports;
};
const TransactionNetwork = load('src/components/transaction-network/transaction-network.js').default;
const AlertModal = load('src/components/modals/alert-modal.js').default;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

for (const type of ['confirm', 'warning']) {
  const html = render(AlertModal, { type, transaction: true, title: 'Inert transaction confirmation', children: 'Reviewed action' });
  assert.match(html, /Selected signing chain<\/dt><dd class="word-break-all">1<\/dd>/);
  assert(html.includes('wss://node.fixture.invalid:35998'));
  for (const privatePart of ['fixture-user', 'fixture-value', '/private-route', 'fixture=hidden', '#detail']) assert(!html.includes(privatePart));
  assert(!html.includes('Effective block chain'), 'native selection is not presented as a prepared block');
  assert(html.includes('Reviewed action'));
}
assert(!render(AlertModal, { title: 'Nontransaction dialog' }).includes('Selected signing chain'));
state.connectionParameters = { chainIdentifier: 69, nodeUrl: 'ws://node.fixture.invalid:1234' };
const changed = render(AlertModal, { transaction: true, title: 'Changed selected settings' });
assert.match(changed, /Selected signing chain<\/dt><dd class="word-break-all">69<\/dd>/);
assert(changed.includes('ws://node.fixture.invalid:1234'));
const matching = render(TransactionNetwork, { chainIdentifier: 69, nodeUrl: state.connectionParameters.nodeUrl, effectiveChainIdentifier: 69 });
assert(matching.includes('Effective block chain')); assert(!matching.includes('different chain identifier'));
const unavailable = render(TransactionNetwork, { chainIdentifier: undefined, nodeUrl: 'invalid' });
assert.match(unavailable, /Selected signing chain<\/dt><dd class="word-break-all">Unavailable<\/dd>/);
assert.match(unavailable, /Node host<\/dt><dd class="word-break-all">Unavailable<\/dd>/);
const invalid = render(TransactionNetwork, { chainIdentifier: 1, effectiveChainIdentifier: { unsupported: true } });
assert(invalid.includes('Invalid chain identifier'), 'malformed raw chain metadata cannot crash rendering');
console.log('Approval context: native confirmation settings, explicit prepared chain, endpoint redaction and unavailable states passed');

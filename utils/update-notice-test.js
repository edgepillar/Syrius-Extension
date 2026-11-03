'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.join(__dirname, '..');
const load = (file) => {
  const filename = path.resolve(root, file);
  const mod = { exports: {} };
  const { code } = babel.transformFileSync(filename, { presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]], babelrc: false, configFile: false });
  const resolve = (id) => (id.startsWith('.') ? load(path.resolve(path.dirname(filename), id) + (path.extname(id) ? '' : '.js')) : require(id));
  new Function('module', 'exports', 'require', code)(mod, mod.exports, resolve);
  return mod.exports;
};

const session = new Map();
const sessionArea = {
  get: async (key) => (session.has(key) ? { [key]: session.get(key) } : {}),
  set: async (values) => { Object.entries(values).forEach(([key, value]) => session.set(key, value)); },
};
global.chrome = { storage: { session: sessionArea }, runtime: { getManifest: () => ({ version: '0.3.9' }) } };

const fresh = () => load('src/services/utils/updateNotice.js');
const at = (version) => ({ latest: async () => version, current: () => '0.3.9' });

(async () => {
  let notice = fresh();
  assert.equal(await notice.pendingUpdate(at('0.4.0')), '0.4.0', 'a newer release is shown');
  assert.equal(await notice.pendingUpdate(at('0.3.9')), null, 'the running version is not');
  assert.equal(await notice.pendingUpdate(at('0.3.8')), null, 'an older release is not');
  assert.equal(await notice.pendingUpdate(at(null)), null, 'an unknown latest is not');

  await notice.dismissUpdate('0.4.0');
  assert.equal(await notice.pendingUpdate(at('0.4.0')), null, 'dismissed stays hidden');
  assert.equal(await notice.pendingUpdate(at('0.4.1')), '0.4.1', 'a later release shows again');

  notice = fresh();
  assert.equal(await notice.pendingUpdate(at('0.4.0')), null, 'a reopened popup keeps the dismissal');

  session.clear();
  notice = fresh();
  assert.equal(await notice.pendingUpdate(at('0.4.0')), '0.4.0', 'a cold launch shows it again');

  global.chrome = { runtime: { getManifest: () => ({ version: '0.3.9' }) } };
  notice = fresh();
  await notice.dismissUpdate('0.4.0');
  assert.equal(await notice.pendingUpdate(at('0.4.0')), null, 'without session storage the dismissal lasts the page');

  sessionArea.get = async () => { throw new Error('unavailable'); };
  global.chrome = { storage: { session: sessionArea }, runtime: { getManifest: () => ({ version: '0.3.9' }) } };
  notice = fresh();
  assert.equal(await notice.pendingUpdate(at('0.4.0')), '0.4.0', 'a failed read still shows it');

  console.log('update notice: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

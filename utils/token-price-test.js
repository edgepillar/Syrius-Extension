'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

const filename = path.join(__dirname, '..', 'src/services/utils/tokenPrice.js');
const { code } = babel.transformFileSync(filename, { presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]], babelrc: false, configFile: false });
const mod = { exports: {} };
const stubRequire = name => (name === './errors' ? { fail: (n, detail) => Object.assign(new Error(`fail ${n}`), detail) } : require(name));
new Function('module', 'exports', 'require', code)(mod, mod.exports, stubRequire);
const { fetchTokenPrices } = mod.exports;

const wqsr = '0x96546afe4a21515a3a30cd3fd64a70eb478dc174';
const answer = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const serve = routes => { const seen = []; globalThis.fetch = async url => { seen.push(url); for (const [match, reply] of routes) if (url.includes(match)) return reply(); throw new Error(`unexpected ${url}`); }; return seen; };
const coingecko = () => answer({ 'zenon-2': { usd: 0.186 } });
const gecko = () => answer({ data: { attributes: { token_prices: { [wqsr]: '0.02765985084' } } } });

(async () => {
  {
    const seen = serve([['api.coingecko.com', coingecko], ['api.geckoterminal.com', gecko]]);
    assert.deepEqual(await fetchTokenPrices(), { znn: 0.186, qsr: 0.02765985084 });
    assert(seen.every(url => !/[=,]quasar(&|,|$)/.test(url)), 'QSR is not priced from CoinGecko id quasar, an unrelated project');
    assert(seen.some(url => url.includes(`/networks/eth/token_price/${wqsr}`)), 'QSR is priced from wQSR on Ethereum');
  }
  {
    serve([['api.coingecko.com', coingecko], ['api.geckoterminal.com', () => answer({}, false)]]);
    assert.deepEqual(await fetchTokenPrices(), { znn: 0.186, qsr: null });
  }
  {
    serve([['api.coingecko.com', () => answer({}, false)], ['api.geckoterminal.com', gecko]]);
    assert.deepEqual(await fetchTokenPrices(), { znn: null, qsr: 0.02765985084 });
  }
  {
    serve([['api.coingecko.com', coingecko], ['api.geckoterminal.com', () => answer({ data: { attributes: { token_prices: { [wqsr]: 'NaN' } } } })]]);
    assert.deepEqual(await fetchTokenPrices(), { znn: 0.186, qsr: null });
  }
  {
    serve([['api.coingecko.com', () => answer({}, false)], ['api.geckoterminal.com', () => answer({}, false)]]);
    await assert.rejects(fetchTokenPrices(), /fail 106/);
  }
  console.log(JSON.stringify({ token_price: true, cases: 5, passed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });

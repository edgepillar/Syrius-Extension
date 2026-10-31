'use strict';
// The operator pages (tokens, sentinel, bridge, node stats), checked without a
// browser, a node or a key: the contract rules their forms enforce, against
// go-zenon's own, and the call data they send, against the SDK where the SDK
// has an encoder. Pillar mode has its own suite (pillar-mode-test.js).
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.join(__dirname, '..');
const memory = new Map();
global.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
global.window = { localStorage: global.localStorage, crypto: require('node:crypto').webcrypto };

const load = (file, cache = new Map()) => {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  cache.set(filename, mod.exports);
  const { code } = babel.transformFileSync(filename, {
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }], ['@babel/preset-react', { runtime: 'classic' }]], babelrc: false, configFile: false,
  });
  const resolve = (name) => (name.startsWith('.')
    ? load(path.resolve(path.dirname(filename), name) + (path.extname(name) ? '' : '.js'), cache) : require(name));
  new Function('module', 'exports', 'require', code)(mod, mod.exports, resolve);
  cache.set(filename, mod.exports);
  return mod.exports;
};
const cache = new Map();
const token = load('src/services/token/token.js', cache);
const ztsSearch = load('src/services/token/ztsSearch.js', cache);
const blockHead = load('src/services/token/blockHead.js', cache);
const { Zenon, Primitives, utils } = require('znn-ts-sdk');
const { ethers } = require('ethers');
const { sha3_256 } = require('js-sha3');

const pending = [];
let passed = 0;
const test = (name, fn) => pending.push([name, fn]);

const hex = (template) => Buffer.from(template.data).toString('hex');
const a1 = 'z1qq6eg8n43g032hanpsfp02qcdmv7zfj3y2lt5d';
const a2 = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7';
const zts = 'zts1zr52xulll78tj769n264fy'; // devnet amm-ZNN-QSR-LP
const sdk = Zenon.getSingleton().embedded;
const search = ztsSearch.createSearch(require('js-sha3').sha3_256);

//
// Tokens
//
const issue = (over = {}) => ({
  name: 'Syrius-Test', symbol: 'SYT', domain: 'zenon.org', totalSupply: '100', maxSupply: '1000',
  decimals: 8, isMintable: true, isBurnable: true, isUtility: true, ...over,
});

test('token limits are go-zenon\'s', () => {
  assert.equal(token.issueFeeZnn, 100000000n, 'TokenIssueAmount, 1 ZNN');
  assert.equal(token.supplyMax, 2n ** 255n - 1n, 'common.BigP255m1');
  assert.deepEqual([token.nameMax, token.symbolMax, token.domainMax, token.decimalsMax], [40, 10, 128, 18]);
});

// go-zenon's pattern, `^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$`, as the rules it
// amounts to: only letters, digits and - . _, a letter or digit first and last,
// and no two separators together. Written out because the pattern itself
// backtracks exponentially in JavaScript (code scanning js/redos); Go's regexp
// does not.
const goName = (name) => /^[a-zA-Z0-9._-]+$/.test(name) && /^[a-zA-Z0-9]/.test(name) &&
  /[a-zA-Z0-9]$/.test(name) && !/[-._]{2}/.test(name);
// Every string of up to `length` characters drawn from `alphabet`.
const every = (alphabet, length) => {
  const out = [''];
  for (let at = 0; at < out.length; at++) if (out[at].length < length) for (const c of alphabet) out.push(out[at] + c);
  return out;
};

test('token names: the same answers as go-zenon\'s pattern', () => {
  const names = ['Tok1', 'my-token', 'my.tok_1', 'ä', 'A.B.C', 'x'.repeat(40), ...every(['a', 'Z', '1', '-', '.', '_', ' '], 5)];
  for (const name of names.filter(Boolean)) {
    assert.equal(token.issueError(issue({ name })) === null, goName(name), JSON.stringify(name));
  }
  assert.ok(token.issueError(issue({ name: 'x'.repeat(41) })));
  assert.ok(token.issueError(issue({ name: '' })));
});

test('token symbols: capitals and digits, up to 10, never ZNN or QSR', () => {
  for (const symbol of ['A', 'ABC123', 'X'.repeat(10)]) assert.equal(token.issueError(issue({ symbol })), null, symbol);
  for (const symbol of ['', 'abc', 'A-B', 'X'.repeat(11), 'ZNN', 'QSR']) assert.ok(token.issueError(issue({ symbol })), symbol);
});

test('token domains: empty, or go-zenon\'s pattern within 128 bytes', () => {
  for (const domain of ['', 'zenon.org', 'a-b.zenon.network', 'ab.cd']) assert.equal(token.issueError(issue({ domain })), null, domain);
  for (const domain of ['zenon', 'a.org', '-ab.org', 'ab-.org', 'https://zenon.org', 'zenon.o', `${'a'.repeat(63)}.${'b'.repeat(63)}.org`]) {
    assert.ok(token.issueError(issue({ domain })), domain);
  }
});

test('token supply: above zero, at most 2^255-1, max at least total, fixed when not mintable', () => {
  assert.equal(token.issueError(issue({ decimals: 18 })), null);
  assert.ok(token.issueError(issue({ decimals: 19 })));
  assert.ok(token.issueError(issue({ maxSupply: '0', totalSupply: '0' })));
  assert.ok(token.issueError(issue({ maxSupply: (2n ** 255n).toString() })));
  assert.equal(token.issueError(issue({ maxSupply: (2n ** 255n - 1n).toString() })), null);
  assert.ok(token.issueError(issue({ maxSupply: '99' })), 'max below total');
  assert.equal(token.issueError(issue({ totalSupply: '0' })), null, 'a mintable token may start at zero');
  assert.ok(token.issueError(issue({ isMintable: false })), 'not mintable, max must equal total');
  assert.equal(token.issueError(issue({ isMintable: false, maxSupply: '100' })), null);
});

test('mint, burn and update: the contract\'s permissions', () => {
  const owned = { owner: a1, isMintable: true, isBurnable: false, totalSupply: '100', maxSupply: '1000' };
  assert.equal(token.mintError(owned, '900', a2), null);
  assert.ok(token.mintError(owned, '901', a2), 'past the max');
  assert.ok(token.mintError(owned, '0', a2));
  assert.ok(token.mintError({ ...owned, isMintable: false }, '1', a2));
  assert.ok(token.mintError(owned, '1', 'z1qxemdeddedxt0kenxxxxxxxxxxxxxxxxh9amk0'), 'not to a contract');
  assert.equal(token.burnError(owned, '5', '5', a1), null, 'the owner burns a non-burnable token');
  assert.ok(token.burnError(owned, '5', '5', a2), 'nobody else does');
  assert.equal(token.burnError({ ...owned, isBurnable: true }, '5', '5', a2), null);
  assert.ok(token.burnError(owned, '6', '5', a1), 'more than held');
  assert.equal(token.updateError(owned, { owner: a2, isMintable: true, isBurnable: false }), null);
  assert.equal(token.updateError(owned, { owner: a1, isMintable: false, isBurnable: false }), null);
  assert.ok(token.updateError({ ...owned, isMintable: false }, { owner: a1, isMintable: true, isBurnable: false }), 'mintable only goes off');
  assert.ok(token.updateError(owned, { owner: a1, isMintable: true, isBurnable: false }), 'nothing changes');
});

test('token calls match the SDK byte for byte', async () => {
  const t = issue({ totalSupply: '100000000', maxSupply: '900000000000' });
  const ours = token.templates.issue(t);
  // The SDK's encoders refuse the BigNumber, Address and TokenStandard objects
  // their own types ask for (it tells them apart by constructor name, which
  // its minified build renames); they take strings.
  const theirs = await sdk.token.issueToken(t.name, t.symbol, t.domain, t.totalSupply, t.maxSupply, t.decimals, true, true, true);
  assert.equal(hex(ours), hex(theirs));
  assert.equal(ours.amount.toString(), '100000000');
  assert.equal(ours.tokenStandard.toString(), 'zts1znnxxxxxxxxxxxxx9z4ulx');
  assert.equal(ours.toAddress.toString(), token.tokenAddress);

  const ztsObject = Primitives.TokenStandard.parse(zts);
  const mint = token.templates.mint(zts, '42', a2);
  assert.equal(hex(mint), hex(await sdk.token.mint(zts, '42', a2)));
  assert.equal(mint.amount.toString(), '0', 'Mint refuses an amount on the block');

  const burn = token.templates.burn(zts, '7');
  assert.equal(hex(burn), hex(await sdk.token.burnToken(ztsObject, ethers.BigNumber.from(7))));
  assert.equal(burn.tokenStandard.toString(), zts, 'the tokens themselves');
  assert.equal(burn.amount.toString(), '7');

  const update = token.templates.update(zts, { owner: a2, isMintable: false, isBurnable: true });
  assert.equal(hex(update), hex(await sdk.token.updateToken(zts, a2, false, true)));
  assert.equal(update.amount.toString(), '0');
  assert.equal(hex(update).slice(0, 8), sha3_256('UpdateToken(tokenStandard,address,bool,bool)').slice(0, 8));
});

//
// Token ids with a chosen prefix or suffix
//
test('token ids: bech32 of the first 10 bytes of SHA3 over the issue block hash, as on devnet', () => {
  for (const id of ['zts1znnxxxxxxxxxxxxx9z4ulx', 'zts1qsrxxxxxxxxxxxxxmrhjll', zts]) {
    assert.equal(ztsSearch.encode(Primitives.TokenStandard.parse(id).getBytes()), id);
  }
  // Devnet: issue block 0f1017…30c9 from z1qpt799… created amm-ZNN-QSR-LP.
  assert.equal(search.idOf(Buffer.from('0f101714429bb3b041ac47bf4d4120d11d41ae4f4125d1edd7686e13202230c9', 'hex')), zts);
});

test('custom id patterns: the bech32 alphabet, six characters at most', () => {
  assert.equal(ztsSearch.patternError('zen', 'nn'), null);
  assert.ok(ztsSearch.patternError('zen', 'on'), 'o is not in bech32: no id can read zenon');
  assert.ok(ztsSearch.patternError('b', ''), 'b is not in bech32');
  assert.ok(ztsSearch.patternError('', 'io1'), 'nor i, o or 1');
  assert.ok(ztsSearch.patternError('zenonx', 'q'), 'seven in all');
  assert.equal(ztsSearch.normalise(' ZTS1Zen '), 'zen');
  assert.equal(ztsSearch.expectedTries('ab', 'c'), 32768);
});

test('the bytes searched over hash exactly as the SDK hashes the block', async () => {
  const block = token.templates.issue(issue({ totalSupply: '5', maxSupply: '5', isMintable: false }));
  block.address = Primitives.Address.parse(a1);
  block.chainIdentifier = 69;
  block.height = 412;
  block.previousHash = Primitives.Hash.parse('9e'.repeat(32));
  block.momentumAcknowledged.hash = Primitives.Hash.parse('3c'.repeat(32));
  block.momentumAcknowledged.height = 242819;
  block.fusedPlasma = 84000;
  block.difficulty = 0;
  block.nonce = '0000000000000000';
  const head = blockHead.headOf(block);
  const sdkHash = (await utils.BlockUtils.getTransactionHash(block)).toString();
  assert.equal(sha3_256(Buffer.concat([Buffer.from(head), Buffer.alloc(8)])), sdkHash);
  // And with a nonce: the last 8 bytes, big-endian.
  block.nonce = '00000001deadbeef';
  assert.equal(sha3_256(Buffer.concat([Buffer.from(head), Buffer.from(block.nonce, 'hex')])),
    (await utils.BlockUtils.getTransactionHash(block)).toString());
});

test('a search finds a nonce whose block hash gives the asked-for id', () => {
  const head = new Uint8Array(298).map((_, i) => (i * 7) & 255);
  const found = search.search({ head, prefix: 'ze', suffix: 'n', hi: 7, lo: 0, count: 2000000 });
  assert.ok(found.found, 'three characters in two million tries');
  assert.match(found.zts, /^zts1ze[a-z0-9]{19}n$/);
  const hash = sha3_256.array(Buffer.concat([Buffer.from(head), Buffer.from(found.nonce, 'hex')]));
  assert.equal(search.idOf(hash), found.zts, 'the id is the one the block will get');
  assert.equal(found.nonce.slice(0, 8), '00000007', 'the worker\'s high word');
  const missed = search.search({ head, prefix: 'zzzzz', suffix: '', hi: 7, lo: 0, count: 10 });
  assert.deepEqual([missed.found, missed.lo, missed.tried], [false, 10, 10]);
});

test('the search worker refuses what it was not built for and finds what it was', () => {
  const vm = require('node:vm');
  const source = require('./zts-search-worker')();
  const run = (job) => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m) };
    vm.runInNewContext(source, { self, Uint8Array, parseInt });
    self.onmessage({ data: job });
    return posted;
  };
  const head = '07'.repeat(298);
  assert.deepEqual(run({ head, prefix: 'b', suffix: '', hi: 1, chunk: 10 }).at(-1).error, 'Invalid search');
  assert.deepEqual(run({ head: '07', prefix: 'z', suffix: '', hi: 1, chunk: 10 }).at(-1).error, 'Invalid search');
  assert.deepEqual(run({ head, prefix: '', suffix: '', hi: 1, chunk: 10 }).at(-1).error, 'Invalid search');
  const posted = run({ head, prefix: 'q', suffix: '', hi: 1, chunk: 5 });
  assert.ok(posted[0].ready);
  const found = posted.at(-1);
  assert.ok(found.found && found.zts.startsWith('zts1q'));
  assert.equal(search.idOf(sha3_256.array(Buffer.from(head + found.nonce, 'hex'))), found.zts);
});

//
// Zap
//
const zap = load('src/services/zap/zap.js', cache);
const zapHex = (bytes) => Buffer.from(bytes).toString('hex');
// A well-formed user address (first byte zero) nobody holds the key to.
const userAddress = (fill) => {
  const core = Primitives.Address.parse(a1).core.constructor.alloc(20, fill);
  core[0] = 0;
  return new Primitives.Address('z', core).toString();
};
const tokenContract = 'z1qxemdeddedxt0kenxxxxxxxxxxxxxxxxh9amk0';

test('zap data: four marker bytes, then the message as UTF-8, at most 140 bytes', () => {
  assert.deepEqual(zap.marker, [0x7a, 0x61, 0x70, 0x01]);
  assert.equal(zapHex(zap.encodeZap('hi')), '7a6170016869');
  assert.equal(zapHex(zap.encodeZap('')), '7a617001');
  assert.equal(zapHex(zap.encodeZap()), '7a617001');
  assert.equal(zap.encodeZap('x'.repeat(140)).length, 144);
  assert.throws(() => zap.encodeZap('x'.repeat(141)), (error) => error.errorId === 430);
  // The cap is in bytes: forty-seven three-byte characters are 141.
  assert.throws(() => zap.encodeZap('€'.repeat(47)), (error) => error.errorId === 430);
  assert.equal(zap.encodeZap('€'.repeat(46)).length, 142);
  assert.equal(zap.messageError('x'.repeat(141)), 'That message is too long. Shorten it.');
  assert.equal(zap.messageError('fine'), null);
  assert.ok(new TextEncoder().encode(zap.defaultMessage).length <= zap.messageMax);
  assert.ok(!zap.defaultMessage.includes('—'), 'no em dash');
});

test('zap data: read back from the SDK\'s bytes and from the node\'s base64, and from nothing else', () => {
  const data = zap.encodeZap('Have a great day');
  assert.deepEqual(zap.decodeZap(data), { message: 'Have a great day' });
  assert.deepEqual(zap.decodeZap(Buffer.from(data)), { message: 'Have a great day' });
  assert.deepEqual(zap.decodeZap(Buffer.from(data).toString('base64')), { message: 'Have a great day' });
  assert.deepEqual(zap.decodeZap([...data]), { message: 'Have a great day' });
  assert.deepEqual(zap.decodeZap(zap.encodeZap('')), { message: '' }, 'the second block of a zap');

  const not = [
    null, undefined, '', new Uint8Array(0), Buffer.from('7a6170', 'hex'), Buffer.from('7a61700268', 'hex'),
    Buffer.from('zap!hello'), Buffer.from('hello'), 'not base64!', 'emFw', {}, 42,
    // A contract call's selector is not the marker.
    Buffer.from('bc410b91' + '00'.repeat(64), 'hex'),
    // One byte over.
    Buffer.concat([Buffer.from(zap.marker), Buffer.alloc(141, 0x61)]),
    // Not UTF-8.
    Buffer.concat([Buffer.from(zap.marker), Buffer.from([0xff, 0xfe, 0xfd])]),
    Buffer.concat([Buffer.from(zap.marker), Buffer.from([0xe2, 0x82])]),
  ];
  for (const data of not) assert.equal(zap.decodeZap(data), null, String(data));
});

test('zap message: a stranger\'s text is cut to one line of printable characters', () => {
  const read = (text) => zap.decodeZap(Buffer.concat([Buffer.from(zap.marker), Buffer.from(text, 'utf8')])).message;
  assert.equal(read('line one\nline two\r\n\tthree'), 'line one line two three');
  assert.equal(read('  padded   out  '), 'padded out');
  assert.equal(read('a\u0000b\u0007c\u001b[31m'), 'abc[31m');
  // Right-to-left override, zero-width space and joiner, byte order mark,
  // isolates. By code point: none of them belongs in a source file.
  const cp = (...points) => String.fromCodePoint(...points);
  assert.equal(read(`safe${cp(0x202e)}exe.gpj`), 'safeexe.gpj');
  assert.equal(read(`a${cp(0x200b)}b${cp(0x200d)}c${cp(0xfeff)}d${cp(0x2066)}e${cp(0x2069)}`), 'abcde');
  assert.equal(read(`a${cp(0x2028)}b${cp(0x85)}c`), 'a b c', 'a line separator is a break');
  // Markup is only ever text; it is kept as typed and never interpreted.
  assert.equal(read('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  assert.equal(read('https://example.com/claim'), 'https://example.com/claim');
  assert.equal(read('\u0000\u0001'), '');
  assert.equal(read('café \u{1F47D}'), 'café \u{1F47D}');
  // What the wallet shows it as: a text node, in the modal and nowhere as HTML.
  const fs = require('node:fs');
  for (const file of ['src/pages/settings/zap/zap.js', 'src/components/modals/zap-modal.js', 'src/pages/dashboard/dashboard/dashboard.js', 'src/components/transaction-item/transaction-item.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|<a\s[^>]*href=\{[^}]*message/.test(source), file);
  }
});

test('zap recipients: accounts that published a receive, never a contract, a vault or the sender', () => {
  const block = (blockType, address, toAddress = a1) => ({ blockType, address, toAddress });
  const detailed = { list: [
    { blocks: [block(2, a1, a2), block(3, a2)] },           // a send to a2, and a2 taking it in
    { blocks: [block(5, tokenContract), block(4, tokenContract, a1)] },
    { blocks: [block(3, a1), block(3, a2), block(1, a2)] },
    { blocks: [] }, {}, null,
  ] };
  assert.deepEqual([...zap.recipientsIn(detailed)].sort(), [a1, a2].sort());
  assert.deepEqual([...zap.recipientsIn(detailed, (address) => address === a1)], [a2]);
  assert.deepEqual([...zap.recipientsIn({ list: [{ blocks: [block(2, a1, a2)] }] })], [], 'sent to is not received');
  assert.deepEqual([...zap.recipientsIn({ list: [{ blocks: [block(3, 'not an address'), block(3, tokenContract)] }] })], []);
  assert.deepEqual([...zap.recipientsIn(null)], []);
  assert.equal(zap.isUser(a1), true);
  assert.equal(zap.isUser(tokenContract), false);
});

// A chain of one momentum every ten seconds, with receives where asked.
const chain = (frontierHeight, frontierTime, receives = {}) => {
  const calls = [];
  const timeOf = (height) => frontierTime - (frontierHeight - height) * 10;
  const request = async (method, params) => {
    calls.push([method, ...params]);
    if (method === 'ledger.getFrontierMomentum') return { height: frontierHeight, timestamp: frontierTime };
    if (method === 'ledger.getMomentumsByHeight') return { list: params[0] >= 1 && params[0] <= frontierHeight ? [{ height: params[0], timestamp: timeOf(params[0]) }] : [] };
    if (method === 'ledger.getDetailedMomentumsByHeight') {
      const list = [];
      for (let height = params[0]; height < params[0] + params[1] && height <= frontierHeight; height += 1) {
        list.push({ momentum: { height }, blocks: (receives[height] || []).map((address) => ({ blockType: 3, address })) });
      }
      return { list };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { request, calls, timeOf };
};

test('zap alien: only the last seven days are read, and the wallet\'s own addresses are never picked', async () => {
  const now = 1791700000;
  const week = 7 * 24 * 60 * 60;
  assert.equal(zap.windowSeconds, week);
  const frontier = 200000;
  // a2 received inside the week; a1 (ours) too; an old address just before it.
  const old = userAddress(7);
  const first = frontier - week / 10;            // the first momentum inside the week
  const net = chain(frontier, now, { [first - 1]: [old], [first]: [a2], [frontier]: [a1] });

  assert.equal(await zap.heightSince(net.request, now - week, { height: frontier, timestamp: now }), first);
  assert.equal(await zap.heightSince(net.request, now + 1, { height: frontier, timestamp: now }), null, 'a chain stopped for longer than the window');

  for (let run = 0; run < 20; run += 1) {
    net.calls.length = 0;
    const found = await zap.findAlien({ exclude: [a1], now: now * 1000, request: net.request });
    assert.equal(found.address, a2);
    assert.equal(found.among, 1);
    const reads = net.calls.filter(([method]) => method === 'ledger.getDetailedMomentumsByHeight');
    assert.ok(reads.length <= found.windows && found.windows === Math.ceil((frontier - first + 1) / zap.span), `${reads.length} reads`);
    assert.equal(new Set(reads.map(([, height]) => height)).size, reads.length, 'no window is read twice');
    for (const [, height, count] of reads) {
      assert.ok(height >= first, `read from ${height}, before the week began at ${first}`);
      assert.ok(count >= 1 && count <= zap.span && height + count - 1 <= frontier);
    }
  }
  // Nothing but the wallet's own and the old one: no alien.
  const lonely = chain(frontier, now, { [first - 1]: [old], [frontier]: [a1] });
  await assert.rejects(zap.findAlien({ exclude: [a1], now: now * 1000, request: lonely.request }), (error) => error.errorId === 431);
  const stopped = chain(frontier, now - week - 60, { [frontier]: [a2] });
  await assert.rejects(zap.findAlien({ now: now * 1000, request: stopped.request }), (error) => error.errorId === 431);
  await assert.rejects(zap.findAlien({ now: now * 1000, request: async () => null }), (error) => error.errorId === 431);
});

test('zap alien: every address found is as likely as another', async () => {
  const now = 1791700000;
  const frontier = 1000;                          // a young chain: one window holds it all
  const others = [a2, userAddress(7), userAddress(9)];
  for (const address of others) assert.ok(zap.isUser(address), address);
  // a2 received fifty times, the others once: activity must not weigh the draw.
  const receives = { 10: Array(50).fill(a2), 500: [others[1]], 900: [others[2]] };
  const net = chain(frontier, now, receives);
  const sorted = [...others].sort();
  for (let pick = 0; pick < 3; pick += 1) {
    const found = await zap.findAlien({ now: now * 1000, request: net.request, random: (n) => (n === 3 ? pick : 0) });
    assert.equal(found.address, sorted[pick]);
    assert.equal(found.among, 3);
  }
});

test('zap draw: every value below n is equally likely, so draws past the last multiple of n are retaken', () => {
  const feed = (...values) => { let i = 0; return (draw) => { draw[0] = values[i++]; }; };
  // 2^32 = 3 * 1431655765 + 1: only the top value is beyond a whole multiple.
  assert.equal(zap.randomBelow(3, feed(0)), 0);
  assert.equal(zap.randomBelow(3, feed(4294967294)), 2);
  assert.equal(zap.randomBelow(3, feed(4294967295, 4294967295, 5)), 2);
  assert.equal(zap.randomBelow(1, feed(4294967295)), 0);
  assert.equal(zap.randomBelow(2 ** 16, feed(4294967295)), 65535);
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5000; i += 1) counts[zap.randomBelow(5)] += 1;
  for (const count of counts) assert.ok(count > 800 && count < 1200, String(counts));
});

test('zap blocks: plain sends to the alien, the message on the first, the marker alone on the second', () => {
  const both = zap.blocksFor({ to: a2, amounts: { znn: '100000000', qsr: '1000000000' }, message: 'Hello' });
  assert.deepEqual(both.map((part) => [part.symbol, part.amount]), [['ZNN', '100000000'], ['QSR', '1000000000']]);
  assert.equal(both[0].template.toAddress.toString(), a2);
  assert.equal(both[0].template.tokenStandard.toString(), 'zts1znnxxxxxxxxxxxxx9z4ulx');
  assert.equal(both[1].template.tokenStandard.toString(), 'zts1qsrxxxxxxxxxxxxxmrhjll');
  assert.equal(both[0].template.amount.toString(), '100000000');
  assert.equal(hex(both[0].template), '7a61700148656c6c6f');
  assert.equal(hex(both[1].template), '7a617001');
  assert.deepEqual(zap.decodeZap(both[0].template.data), { message: 'Hello' });
  assert.equal(both[0].template.blockType, 2, 'a user send, not a contract call');

  const qsrOnly = zap.blocksFor({ to: a2, amounts: { znn: '0', qsr: '5' }, message: '   ' });
  assert.equal(qsrOnly.length, 1);
  assert.equal(qsrOnly[0].symbol, 'QSR');
  assert.deepEqual(zap.decodeZap(qsrOnly[0].template.data), { message: zap.defaultMessage }, 'an empty message is the default one');

  assert.throws(() => zap.blocksFor({ to: a2, amounts: { znn: '0', qsr: '0' } }), (error) => error.errorId === 432);
  assert.throws(() => zap.blocksFor({ to: a2, amounts: {} }), (error) => error.errorId === 432);
  assert.throws(() => zap.blocksFor({ to: tokenContract, amounts: { znn: '1' } }), (error) => error.errorId === 311);
  assert.throws(() => zap.blocksFor({ to: 'nonsense', amounts: { znn: '1' } }), (error) => error.errorId === 311);
  assert.throws(() => zap.blocksFor({ to: a2, amounts: { znn: '1' }, message: 'x'.repeat(141) }), (error) => error.errorId === 430);
  assert.deepEqual(zap.defaults, { znn: '1', qsr: '10' });
});

test('zap arrivals: each is new once, and an address\'s history is not news', () => {
  memory.delete('zapsSeen');
  assert.deepEqual(zap.takeNew(a1, ['h1', 'h2']), [], 'the first look sets the baseline');
  assert.deepEqual(zap.takeNew(a1, ['h1', 'h2']), []);
  assert.deepEqual(zap.takeNew(a1, ['h3', 'h1']), ['h3']);
  assert.deepEqual(zap.takeNew(a1, ['h3', 'h1']), [], 'once');
  assert.deepEqual(zap.takeNew(a2, ['h3']), [], 'per address');
  assert.deepEqual(zap.takeNew(a2, ['h4']), ['h4']);
  assert.deepEqual(zap.takeNew(a1, []), []);
  assert.deepEqual(zap.takeNew('', ['h9']), []);
  // A full list forgets the oldest, never the newest.
  const many = Array.from({ length: 250 }, (_, index) => `m${index}`);
  zap.takeNew(a1, many);
  assert.equal(JSON.parse(memory.get('zapsSeen'))[a1].length, 200);
  assert.deepEqual(zap.takeNew(a1, ['m0']), []);
  // Damaged storage is an empty one.
  memory.set('zapsSeen', '{broken');
  assert.deepEqual(zap.takeNew(a1, ['h1']), []);
  memory.set('zapsSeen', JSON.stringify({ [a1]: 'nope' }));
  assert.deepEqual(zap.takeNew(a1, ['h1']), []);
  assert.deepEqual(zap.takeNew(a1, ['h1', 'h5']), ['h5']);
});

//
// Plasma: cancelling several fuses
//
const batch = load('src/services/plasma/batchCancel.js', cache);
const fuseEntry = (id, qsrAmount, expirationHeight, isRevocable = true) => ({ id: { toString: () => id }, qsrAmount, expirationHeight, isRevocable });

test('fuses: only one past its expiration and revocable by this account can be picked', () => {
  const height = 1000;
  assert.equal(batch.isCancellable(fuseEntry('a', '10', 1000), height), true, 'at its expiration height');
  assert.equal(batch.isCancellable(fuseEntry('a', '10', 999), height), true);
  assert.equal(batch.isCancellable(fuseEntry('a', '10', 1001), height), false, 'still locked');
  assert.equal(batch.isCancellable(fuseEntry('a', '10', 1, false), height), false, 'fused by another wallet');
  assert.equal(batch.isCancellable(null, height), false);
  // Height not read yet: offered, as the row's own button always was.
  assert.equal(batch.isCancellable(fuseEntry('a', '10', 5000), 0), true);
  // The row decides with the same function, so a box never appears beside a
  // fuse the row would not let you cancel.
  const row = require('node:fs').readFileSync(path.join(root, 'src/components/fuse-item/fuse-item.js'), 'utf8');
  assert.ok(row.includes('const canCancel = isCancellable({ expirationHeight, isRevocable }, momentumHeight);'));
  assert.ok(row.includes('{onSelect && canCancel && ('));
  assert.ok(row.includes('{canCancel ? ('));
});

test('fuses: a selection is ids in list order, and follows the list', () => {
  const list = [fuseEntry('a', '1000000000', 10), fuseEntry('b', '2500000000', 5000), fuseEntry('c', '3000000000', 20), fuseEntry('d', '99', 1, false)];
  const height = 1000;
  assert.deepEqual(batch.selectAll(list, height), ['a', 'c'], 'the locked one and the external one are left out');
  assert.deepEqual(batch.toggle([], 'a'), ['a']);
  assert.deepEqual(batch.toggle(['a'], { toString: () => 'c' }), ['a', 'c']);
  assert.deepEqual(batch.toggle(['a', 'c'], 'a'), ['c']);
  const before = ['a'];
  batch.toggle(before, 'c');
  assert.deepEqual(before, ['a'], 'a new list each time');

  // Picked in the list's order, whatever order they were ticked in, once each.
  assert.deepEqual(batch.picked(list, ['c', 'a', 'a'], height).map((entry) => entry.id.toString()), ['a', 'c']);
  // A locked, external or vanished fuse cannot be sent, even if its id is in the selection.
  assert.deepEqual(batch.picked(list, ['b', 'd', 'gone', 'c'], height).map((entry) => entry.id.toString()), ['c']);
  assert.deepEqual(batch.prune(['a', 'b', 'gone', 'c'], list, height), ['a', 'c']);
  assert.deepEqual(batch.prune(['a', 'c'], [list[2]], height), ['c'], 'cancelled elsewhere');
  assert.deepEqual(batch.prune(['a'], [], height), []);

  assert.equal(batch.totalOf(batch.picked(list, ['a', 'c'], height)).toString(), '4000000000');
  assert.equal(batch.totalOf([]).toString(), '0');
  assert.equal(batch.totalOf([{ qsrAmount: ethers.BigNumber.from('5') }, { qsrAmount: 7 }]).toString(), '12');
});

test('fuses: a batch is sent one block at a time, and says how far it got', async () => {
  const sent = [];
  let inFlight = 0;
  const sendOne = (failAt) => async (id) => {
    assert.equal(inFlight, 0, 'the next block waits for the one before it');
    inFlight += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    if (id === failAt) throw new Error('node said no');
    sent.push(id);
    return { hash: `block-${id}` };
  };
  assert.deepEqual(await batch.cancelMany(['a', 'b', 'c'], sendOne()), { hash: 'block-c' });
  assert.deepEqual(sent, ['a', 'b', 'c']);

  sent.length = 0;
  await assert.rejects(batch.cancelMany(['a', 'b', 'c'], sendOne('c')), (error) => error.errorId === 319 && error.message === '2 of 3 fuses were cancelled. The rest were not: try them again.');
  assert.deepEqual(sent, ['a', 'b'], 'it stops at the first failure');

  // Nothing went: the node's own error is the whole story.
  sent.length = 0;
  await assert.rejects(batch.cancelMany(['a', 'b'], sendOne('a')), (error) => error.message === 'node said no' && error.errorId === undefined);
  assert.deepEqual(sent, []);
  await assert.rejects(batch.cancelMany([], sendOne()), (error) => error.errorId === 320);
});

test('fuses: the page sends what is in the list, after one confirmation, in one background row', () => {
  const page = require('node:fs').readFileSync(path.join(root, 'src/pages/plasma/plasma.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  // Read against the list at the moment of sending, not from what was ticked.
  assert.ok(page.includes('const list = picked(entries.items, selected, momentumHeight); if (!list.length) return;'));
  // One job of a CancelFuse block per listed fuse, each in its account's turn
  // (wallet/blockJobs.js, wallet/journal.js).
  assert.ok(page.includes('const templates = await Promise.all(list.map((entry) => plasma.cancel(entry.id)));'));
  assert.ok(page.includes("templates, kind: 'fuses',"));
  assert.equal(page.split("kind: 'fuses'").length - 1, 1, 'one place sends a batch');
  // The key is the one selected when the batch was confirmed.
  assert.ok(page.includes('addressIndex: vault.getSelectedIndex(),'));
  // Only the dialog starts it.
  assert.equal(page.split('cancelSelected').length - 1, 2, 'defined, and handed to the dialog');
  assert.equal(page.split('confirmCancelSelected').length - 1, 2, 'the dialog opener: defined, and bound to the button');
  assert.ok(page.includes('confirmLabel="Cancel fuses" dismissLabel="Keep" onSuccess={cancelSelected}'));
  assert.ok(page.includes('onClick={confirmCancelSelected}'));
  // The selection is dropped once sent and pruned when the list changes.
  assert.ok(page.includes('const next = prune(previous, entries.items, momentumHeight);'));
});

//
// Sentinel
//
const sentinel = load('src/services/sentinel/sentinel.js', cache);

test('sentinel: go-zenon\'s stake, lock and revoke window', () => {
  assert.equal(sentinel.stakeZnn, 500000000000n, 'SentinelZnnRegisterAmount, 5,000 ZNN');
  assert.equal(sentinel.stakeQsr, 5000000000000n, 'SentinelQsrDepositAmount, 50,000 QSR');
  assert.deepEqual([sentinel.lockDays, sentinel.revokeDays], [27, 3]);
  assert.equal(Primitives.Address.parse(sentinel.sentinelAddress).toString(), sentinel.sentinelAddress, 'a well-formed address');
  assert.equal(Primitives.Address.parse(sentinel.sentinelAddress).core[0], 1, 'an embedded contract');

  // GetSentinelRevokeStatus: locked 27 days, open 3, repeating from registration.
  const day = 86400;
  const at = (days) => sentinel.revokeWindowAt(1000, 1000 + days * day);
  assert.deepEqual(at(0), { revocable: false, seconds: 27 * day });
  assert.deepEqual(at(26.5), { revocable: false, seconds: day / 2 });
  assert.deepEqual(at(27), { revocable: true, seconds: 3 * day });
  assert.deepEqual(at(29.5), { revocable: true, seconds: day / 2 });
  assert.deepEqual(at(30), { revocable: false, seconds: 27 * day }, 'the cycle starts again');
  assert.deepEqual(at(57), { revocable: true, seconds: 3 * day });

  // What the node reports is used as it is; a revoked sentinel is never revocable.
  assert.deepEqual(sentinel.revokeWindow({ active: true, isRevocable: true, revokeCooldown: 120 }), { revocable: true, seconds: 120 });
  assert.deepEqual(sentinel.revokeWindow({ active: true, isRevocable: false, revokeCooldown: 99 }), { revocable: false, seconds: 99 });
  assert.equal(sentinel.revokeWindow({ active: false, isRevocable: true, revokeCooldown: 5 }).revocable, false);
  assert.deepEqual(sentinel.revokeWindow(null), { revocable: false, seconds: 0 });
});

test('sentinel: what the address is to the contract, and what registering still needs', () => {
  assert.equal(sentinel.sentinelState(null), 'none');
  assert.equal(sentinel.sentinelState({ active: true }), 'active');
  assert.equal(sentinel.sentinelState({ active: false }), 'revoked', 'on record for good: Register answers already registered');

  assert.deepEqual(sentinel.shortfall({ znnBalance: '500000000000', qsrDeposited: '5000000000000' }), { znnShort: 0n, qsrShort: 0n, ready: true });
  assert.deepEqual(sentinel.shortfall({ znnBalance: '499999999999', qsrDeposited: '5000000000000' }), { znnShort: 1n, qsrShort: 0n, ready: false });
  assert.deepEqual(sentinel.shortfall({ znnBalance: '900000000000', qsrDeposited: '0' }), { znnShort: 0n, qsrShort: 5000000000000n, ready: false });
  assert.deepEqual(sentinel.shortfall({}), { znnShort: 500000000000n, qsrShort: 5000000000000n, ready: false });
  assert.deepEqual(sentinel.shortfall({ znnBalance: 'junk', qsrDeposited: null }).ready, false);
  // More than enough of both is ready, not negative.
  assert.deepEqual(sentinel.shortfall({ znnBalance: '9'.repeat(15), qsrDeposited: '9'.repeat(15) }), { znnShort: 0n, qsrShort: 0n, ready: true });
});

test('sentinel calls: the contract\'s selectors, the right coin and amount on each', () => {
  const selector = (signature) => sha3_256(signature).slice(0, 8);
  const cases = [
    ['register', [], 'Register()', 'zts1znnxxxxxxxxxxxxx9z4ulx', '500000000000'],
    ['revoke', [], 'Revoke()', 'zts1znnxxxxxxxxxxxxx9z4ulx', '0'],
    ['collect', [], 'CollectReward()', 'zts1znnxxxxxxxxxxxxx9z4ulx', '0'],
    ['depositQsr', ['123456789'], 'DepositQsr()', 'zts1qsrxxxxxxxxxxxxxmrhjll', '123456789'],
    ['withdrawQsr', [], 'WithdrawQsr()', 'zts1znnxxxxxxxxxxxxx9z4ulx', '0'],
  ];
  for (const [name, args, signature, token, amount] of cases) {
    const template = sentinel.templates[name](...args);
    assert.equal(hex(template), selector(signature), name);
    assert.equal(template.toAddress.toString(), sentinel.sentinelAddress, name);
    assert.equal(template.tokenStandard.toString(), token, `${name}: the deposit is QSR, everything else ZNN`);
    assert.equal(template.amount.toString(), amount, name);
  }
  assert.equal(Object.keys(sentinel.templates).length, cases.length);
});

test('sentinel page: revoke goes through the password and the guard; a revoked address is not offered Register', () => {
  const page = require('node:fs').readFileSync(path.join(root, 'src/pages/sentinel/sentinel.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  assert.equal(page.split('templates.revoke()').length - 1, 1, 'one place builds a Revoke');
  assert.ok(page.includes("if (step('confirmed') !== steps.send) return; send(() => templates.revoke(),"));
  assert.ok(page.includes("if (step('press') !== steps.password) return; openModal( <PasswordModal"));
  assert.ok(page.includes("if (step('password', { verified: true }) !== steps.confirm) {"));
  // The guard is asked about this sentinel's own window, each time.
  assert.ok(page.includes('const subject = revokeWindow(sentinel).revocable ? sentinel : null;'));
  // Register is rendered for an address with no sentinel only.
  assert.equal(page.split('onRegister={register}').length - 1, 1);
  assert.ok(page.includes("{state === 'none' && ( <Unregistered"));
  const revoked = page.slice(page.indexOf('const Revoked = '), page.indexOf('const Sentinel = '));
  assert.ok(!revoked.includes('Register<') && !revoked.includes('onRegister') && !revoked.includes('canAdd />'), 'nothing to register or deposit with');
  assert.ok(revoked.includes('canAdd={false}'));
  // The route the Sentinel menu entry points at exists.
  const layout = require('node:fs').readFileSync(path.join(root, 'src/layouts/tabsLayout/tabsLayout.js'), 'utf8');
  assert.ok(layout.includes('<Route path="sentinel" element={<Sentinel />} />'));
});

//
// Node stats, pillar epoch history
//
const nodeStats = load('src/services/node/stats.js', cache);
const pillarRules = load('src/services/pillar/rules.js', cache);

test('node stats: a chain that stopped is called stalled, whatever the node says about its sync', () => {
  const now = 1791700000000;
  const ageOf = (secondsAgo) => nodeStats.momentumAge(1791700000 - secondsAgo, now);
  assert.equal(ageOf(0), 0);
  assert.equal(ageOf(7), 7);
  assert.equal(nodeStats.momentumAge(1791700000 + 30, now), 0, 'a node clock ahead of this one');
  for (const unknown of [null, undefined, 0, -5, 'x', NaN]) assert.equal(nodeStats.momentumAge(unknown, now), null, String(unknown));

  assert.equal(nodeStats.stalledAfter, 120, 'twelve momentums');
  assert.deepEqual(nodeStats.chainStatus(ageOf(10)), { kind: 'success', label: 'Producing' });
  assert.deepEqual(nodeStats.chainStatus(120), { kind: 'success', label: 'Producing' });
  assert.deepEqual(nodeStats.chainStatus(121), { kind: 'warning', label: 'Stalled' });
  assert.deepEqual(nodeStats.chainStatus(null), { kind: 'neutral', label: 'Unknown' });
  // The devnet on 2026-10-11: synced, level with its target, and stopped for an hour.
  const halted = { frontier: { height: 242818, timestamp: 1791697030 }, sync: { state: 2, currentHeight: 242818, targetHeight: 242818 } };
  assert.equal(nodeStats.syncStatus(halted.sync.state).label, 'Synced');
  assert.equal(nodeStats.behind(halted.sync), 0);
  assert.equal(nodeStats.chainStatus(nodeStats.momentumAge(halted.frontier.timestamp, now)).label, 'Stalled');

  assert.deepEqual([0, 1, 2, 3].map((state) => nodeStats.syncStatus(state).label), ['Unknown', 'Syncing', 'Synced', 'Not enough peers'], 'protocol.SyncState');
  assert.equal(nodeStats.syncStatus(9).label, 'Unknown');
  assert.equal(nodeStats.syncStatus(undefined).label, 'Unknown');
  assert.equal(nodeStats.behind({ currentHeight: 90, targetHeight: 100 }), 10);
  assert.equal(nodeStats.behind({ currentHeight: 100, targetHeight: 90 }), 0);
  assert.equal(nodeStats.behind(null), null);
});

test('node stats: ages, sizes and memory read as a person would say them', () => {
  assert.equal(nodeStats.formatAge(0), '0 s ago');
  assert.equal(nodeStats.formatAge(59), '59 s ago');
  assert.equal(nodeStats.formatAge(60), '1 min ago');
  assert.equal(nodeStats.formatAge(3599), '59 min ago');
  assert.equal(nodeStats.formatAge(3600 + 25 * 60), '1 h 25 min ago');
  assert.equal(nodeStats.formatAge(47 * 3600), '47 h 0 min ago');
  assert.equal(nodeStats.formatAge(3 * 86400), '3 d ago');
  assert.equal(nodeStats.formatAge(null), '');

  assert.equal(nodeStats.formatBytes(0), '0 B');
  assert.equal(nodeStats.formatBytes(1023), '1023 B');
  assert.equal(nodeStats.formatBytes(1536), '1.5 KB');
  assert.equal(nodeStats.formatBytes(16764973056), '15.6 GB');
  assert.equal(nodeStats.formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(nodeStats.formatBytes(-1), '');
  assert.equal(nodeStats.formatBytes('x'), '');

  assert.equal(nodeStats.memoryUsedPercent({ memoryTotal: 16764973056, memoryFree: 9973018624 }), 41);
  assert.equal(nodeStats.memoryUsedPercent({ memoryTotal: 100, memoryFree: 100 }), 0);
  for (const bad of [null, {}, { memoryTotal: 0, memoryFree: 0 }, { memoryTotal: 10, memoryFree: 11 }, { memoryTotal: 10, memoryFree: -1 }]) {
    assert.equal(nodeStats.memoryUsedPercent(bad), null);
  }
});

test('node stats: a read the node refuses leaves the others standing', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'src/services/node/stats.js'), 'utf8');
  assert.ok(source.includes("request('ledger.getFrontierMomentum'),"), 'the frontier is required');
  for (const method of ['stats.syncInfo', 'stats.processInfo', 'stats.networkInfo', 'stats.osInfo']) {
    assert.ok(source.includes(`optional(request('${method}')),`), method);
  }
  const page = require('node:fs').readFileSync(path.join(root, 'src/pages/settings/node-stats/node-stats.js'), 'utf8');
  assert.ok(page.includes('const age = momentumAge(frontier?.timestamp, now);'), 'the age is counted on this side, every second');
  assert.ok(page.includes('setInterval(() => setNow(Date.now()), 1000)'));
  const layout = require('node:fs').readFileSync(path.join(root, 'src/layouts/tabsLayout/tabsLayout.js'), 'utf8');
  assert.ok(layout.includes('<Route path="settings/node-stats" element={<NodeStats />} />'));
  const nodePage = require('node:fs').readFileSync(path.join(root, 'src/pages/settings/change-node/change-node.js'), 'utf8');
  assert.ok(nodePage.includes('<SettingsItem icon="chart" title="Node stats" url="/tabs/settings/node-stats" tone="info" />'), 'reached from the Node page');
});

test('pillar epoch history: the share produced is rounded down, and the Pillar tab shows it', () => {
  const share = (produced, expected) => pillarRules.epochProduction({ producedBlockNum: produced, expectedBlockNum: expected });
  assert.equal(share(2880, 2880), 100);
  assert.equal(share(2879, 2880), 99, 'one missed is not 100%');
  assert.equal(share(1625, 2880), 56);
  assert.equal(share(0, 2880), 0);
  assert.equal(share(0, 0), null, 'not asked to produce');
  assert.equal(share(2900, 2880), 100, 'never above the whole');
  assert.equal(pillarRules.epochProduction(null), null);

  const fs = require('node:fs');
  assert.ok(fs.readFileSync(path.join(root, 'src/services/pillar/calls.js'), 'utf8').includes("request('embedded.pillar.getPillarEpochHistory', [name, page, size])"));
  assert.ok(fs.readFileSync(path.join(root, 'src/pages/pillar/pillar.js'), 'utf8').includes('<EpochHistory name={pillar.name} />'));
  const view = fs.readFileSync(path.join(root, 'src/pages/pillar/epoch-history.js'), 'utf8');
  assert.ok(view.includes("percent !== null && percent < 80 ? 'is-low' : ''"), 'the threshold the Pillar card uses for Missing momentums');
});

//
// Sent blocks are followed from every screen (services/wallet/outgoingWatch)
//
const watch = load('src/services/wallet/outgoingWatch.js', cache);
const chainEvents = load('src/services/wallet/chainEvents.js', cache);
const watchNet = { chainIdentifier: 69, nodeUrl: 'wss://node.invalid' };
const h1 = 'a'.repeat(64);
const h2 = 'b'.repeat(64);
const settledRow = (over = {}) => ({ id: 'r1', status: 'settled', hash: h1, owner: a1, network: watchNet, label: 'Cancel fuse', ...over });

test('outgoing watch: only blocks the node accepted for this account on this network are followed', () => {
  const rows = [
    settledRow(),
    settledRow({ id: 'other-owner', hash: h2, owner: a2 }),
    settledRow({ id: 'other-node', hash: h2, network: { ...watchNet, nodeUrl: 'wss://elsewhere.invalid' } }),
    settledRow({ id: 'other-chain', hash: h2, network: { ...watchNet, chainIdentifier: 1 } }),
    settledRow({ id: 'no-context', hash: h2, network: null }),
    settledRow({ id: 'no-hash', hash: undefined }),
    settledRow({ id: 'sending', status: 'sending', hash: h2 }),
    settledRow({ id: 'failed', status: 'failed', hash: h2 }),
  ];
  assert.deepEqual(watch.acceptedRows(rows, a1, watchNet).map((row) => row.id), ['r1']);
  assert.deepEqual(watch.acceptedRows(rows, '', watchNet), []);
  assert.deepEqual(watch.acceptedRows(rows, a1, null), [], 'no connection, nothing to believe');
  assert.deepEqual(watch.acceptedRows(null, a1, watchNet), []);
  assert.equal(watch.isConfirmed({ confirmationDetail: { numConfirmations: 1 } }), true);
  for (const block of [null, undefined, {}, { confirmationDetail: null }]) assert.equal(watch.isConfirmed(block), false);
});

test('outgoing watch: a block is asked about until its momentum, once, and not for ever', async () => {
  let clock = 1000;
  const tracker = watch.createTracker({ now: () => clock });
  assert.equal(tracker.add([settledRow()]), true);
  assert.equal(tracker.add([settledRow()]), false, 'the same row again is not news');
  assert.deepEqual(tracker.waiting(), [h1]);
  assert.equal(tracker.stateOf(h1), 'unconfirmed');
  assert.equal(tracker.stateOf(h2), null);
  assert.equal(tracker.windowOpen(), false, 'nothing is looked for before a block confirms');

  const asked = [];
  const answers = { [h1]: { confirmationDetail: null } };
  const readBlock = async (hash) => { asked.push(hash); return answers[hash]; };
  assert.deepEqual(await tracker.check(readBlock), [], 'in the pool is not in a momentum');
  assert.deepEqual(await tracker.check(async () => { throw new Error('node unavailable'); }), [], 'a failed read says nothing');
  assert.deepEqual(await tracker.check(async () => null), [], 'an answer not to be believed says nothing');
  assert.deepEqual(tracker.waiting(), [h1]);

  answers[h1] = { confirmationDetail: { numConfirmations: 1 } };
  assert.deepEqual(await tracker.check(readBlock), [h1]);
  assert.deepEqual(await tracker.check(readBlock), [], 'confirmed is said once');
  assert.deepEqual(tracker.waiting(), []);
  assert.equal(asked.filter((hash) => hash === h1).length, 2, 'not asked about again once confirmed');
  assert.equal(tracker.stateOf(h1), 'confirmed');
  assert.equal(tracker.windowOpen(), true);
  clock += watch.confirmedShownMs;
  assert.equal(tracker.stateOf(h1), 'done');
  clock += watch.receiveWindowMs;
  assert.equal(tracker.windowOpen(), false, 'the look for what comes back ends');

  // Two polls overlapping on a slow node say it once between them.
  const slow = watch.createTracker({ now: () => clock });
  slow.add([settledRow()]);
  let open;
  const held = new Promise((resolve) => { open = resolve; });
  const slowRead = async () => { await held; return { confirmationDetail: {} }; };
  const both = [slow.check(slowRead), slow.check(slowRead)];
  open();
  assert.deepEqual((await Promise.all(both)).flat(), [h1]);

  // A halted chain: accepted, never confirmed.
  tracker.add([settledRow({ id: 'r2', hash: h2 })]);
  assert.deepEqual(tracker.waiting(), [h2]);
  clock += watch.giveUpMs;
  assert.deepEqual(tracker.waiting(), []);
  tracker.clear();
  assert.equal(tracker.stateOf(h1), null);
  assert.ok(watch.pollMs <= 5000 && watch.receivePollMs <= 10000, 'within a momentum');
});

test('outgoing watch: the strip names what is moving, in the words the rows use', async () => {
  let clock = 0;
  const tracker = watch.createTracker({ now: () => clock });
  const items = [
    { id: 'pow', status: 'generating-plasma', owner: a1, label: 'Fuse' },
    { id: 'out', status: 'sending', owner: a1, label: 'Stake' },
    settledRow({ id: 'wait', label: 'Cancel fuse' }),
    settledRow({ id: 'unknown', hash: h2, label: 'Old' }),
    { id: 'bad', status: 'failed', owner: a1, label: 'Vote', error: 'x' },
    { id: 'theirs', status: 'sending', owner: a2, label: 'Other account' },
  ];
  tracker.add([items[2]]);
  assert.deepEqual(watch.stripRows(items, a1, tracker), [
    { id: 'pow', label: 'Fuse', state: 'Generating plasma' },
    { id: 'out', label: 'Stake', state: 'Sending' },
    { id: 'wait', label: 'Cancel fuse', state: 'Unconfirmed' },
    // No toast says why a block failed, so the strip does, until dismissed.
    { id: 'bad', label: 'Vote', state: 'x', failed: true },
  ]);
  await tracker.check(async () => ({ confirmationDetail: {} }));
  assert.deepEqual(watch.stripRows(items, a1, tracker)[2], { id: 'wait', label: 'Cancel fuse', state: 'Confirmed', done: true });
  clock += watch.confirmedShownMs;
  assert.deepEqual(watch.stripRows(items, a1, tracker).map((row) => row.id), ['pow', 'out', 'bad'], 'a confirmed block leaves the strip');
  assert.deepEqual(watch.stripRows([{ ...items[4], error: undefined }], a1, tracker), [{ id: 'bad', label: 'Vote', state: 'Failed', failed: true }]);
  assert.deepEqual(watch.stripRows([], a1, tracker), []);
});

test('outgoing watch: one receive at a time, whichever screen asks', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = watch.receiveOnce(async () => { runs += 1; await gate; return 3; });
  const second = watch.receiveOnce(async () => { runs += 1; return 9; });
  assert.equal(first, second, 'the second waits for the first');
  release();
  assert.equal(await second, 3);
  assert.equal(runs, 1);
  assert.equal(await watch.receiveOnce(async () => { runs += 1; return 1; }), 1, 'and the next one runs');
  await assert.rejects(watch.receiveOnce(async () => { throw new Error('refused'); }), /refused/);
  assert.equal(await watch.receiveOnce(async () => 2), 2, 'a failed receive does not block the next');
});

test('chain events: every listener hears, one that throws does not stop the rest', () => {
  const heard = [];
  const stopFirst = chainEvents.onChainChange(() => { throw new Error('a broken screen'); });
  const stopSecond = chainEvents.onChainChange((kind) => heard.push(kind));
  chainEvents.emitChainChange('confirmed');
  stopSecond();
  chainEvents.emitChainChange('incoming');
  stopFirst();
  assert.deepEqual(heard, ['confirmed']);
});

test('outgoing watch: mounted for every tab screen, silent on Home, and each screen reads again', () => {
  const fs = require('node:fs');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const layout = read('src/layouts/tabsLayout/tabsLayout.js');
  const at = layout.indexOf('<OutgoingWatch />');
  assert.ok(at > layout.indexOf('</Routes>') && layout.indexOf('<OutgoingWatch />', at + 1) < 0, 'outside the routes, so no route unmounts it');
  assert.ok(at < layout.indexOf('<MenuTabs />'), 'just above the tab bar');

  const component = read('src/components/outgoing-watch/outgoing-watch.js');
  assert.ok(component.includes("const homePath = '/tabs/dashboard';"));
  assert.ok(component.includes('const rows = onHome ? [] : stripRows('), 'Home lists the same blocks as rows: the strip stays down');
  assert.ok(!component.includes('notify.'), 'block work reports here, not in toasts');
  assert.ok(component.includes('return context.isCurrent() ? block : null;'), 'an answer from a changed connection is dropped');
  assert.ok(component.includes("if (home.current || !getSettings().autoReceive) return;"), 'Home receives for itself; elsewhere only with the setting on');
  assert.ok(component.includes('receiveOnce(async () =>'));
  for (const event of ["emitChainChange('confirmed')", "emitChainChange('incoming')", "emitChainChange('received')"]) assert.ok(component.includes(event), event);
  assert.ok(component.includes('markAccountStale();'), 'balances are read again on every screen');
  assert.ok(!/setInterval\([^)]*\)\s*;?\s*$/m.test(component.split('if (!isWaiting) return undefined;')[0]), 'nothing is polled while nothing is in flight');

  const home = read('src/pages/dashboard/dashboard/dashboard.js');
  assert.ok(home.includes("if (kind === 'incoming') {\n      refreshPending();\n      if (getSettings().autoReceive) receive();"), 'Home receives what arrives without being reopened');
  assert.ok(home.includes('await receiveOnce(async () => receivePendingBlocks('));

  for (const file of [
    'src/services/hooks/usePillar.js', 'src/services/hooks/useSentinel.js', 'src/pages/plasma/plasma.js',
    'src/pages/staking/stake/stake.js', 'src/pages/delegate/delegate.js', 'src/pages/pillar/rewards.js',
    'src/pages/pillar/az.js', 'src/pages/settings/sporks/sporks.js', 'src/pages/tokens/token-manage.js',
    'src/pages/tokens/token-detail.js', 'src/pages/dashboard/dashboard/dashboard.js',
  ]) {
    const source = read(file);
    assert.ok(/import useChainChange from '[./]+(services\/hooks\/)?useChainChange';/.test(source) && source.includes('useChainChange(('), file);
  }

  const css = read('src/sections/Popup/Popup.scss');
  assert.match(css, /\.outgoing-dock \{[^}]*grid-template-rows: 0fr;[^}]*flex: 0 0 auto;/, 'takes its own room, never covers a button');
  assert.ok(!/prefers-reduced-motion/.test(css), 'its motion always runs');

  // A send no longer jumps to Home: a tab stays where it is, and a form goes
  // back to the screen that opened it. Send is Home's own form.
  const toHome = "navigate('/tabs/dashboard')";
  const pages = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    (entry.isDirectory() ? pages(`${dir}/${entry.name}`) : entry.name.endsWith('.js') ? [`${dir}/${entry.name}`] : []));
  assert.deepEqual(pages('src/pages').filter((file) => read(file).includes(toHome)), ['src/pages/send-receive/send/send.js']);
  for (const [file, back] of [
    ['src/pages/settings/zap/zap.js', "navigate('/tabs/settings');"], ['src/pages/pillar/az-form.js', "navigate('/tabs/az');"],
    ['src/pages/pillar/pillar-form.js', "navigate('/tabs/pillar');"], ['src/pages/tokens/token-issue.js', "navigate('/tabs/tokens/manage');"],
  ]) assert.ok(read(file).includes(back), file);
});

test('zap message: a zap this wallet sent reads To, one that arrived reads From', () => {
  const read = (file) => require('node:fs').readFileSync(path.join(root, file), 'utf8');
  const modal = read('src/components/modals/zap-modal.js');
  assert.ok(modal.includes("{sent ? 'To' : 'From'} {truncateAddress(counterparty)}"));
  assert.ok(modal.includes('{!sent && <p className="zap-modal-note">'), 'only a stranger\'s message carries the warning');
  assert.ok(read('src/pages/dashboard/dashboard/dashboard.js').includes("<ZapModal counterparty={row.address} sent={row.type !== 'received'}"));
  // The row's address is the other side either way (see the history check below).
  const { identify } = load('src/services/hooks/useTransactions.js', cache);
  assert.equal(identify({ address: a1, toAddress: a2, data: '' }, a1, 2).type, 'sent');
  assert.equal(identify({ address: a2, toAddress: a1, data: '' }, a1, 3).type, 'received');
});

//
// Delegate
//
test('delegate: the weight delegated is the node\'s base-unit figure, shown as ZNN', () => {
  const { formatAmount } = load('src/services/utils/format.js', cache);
  const page = require('node:fs').readFileSync(path.join(root, 'src/pages/delegate/delegate.js'), 'utf8');
  // The SDK's weightWithDecimals is "10000.0", which is no whole number and read as 0.
  assert.ok(!page.includes('weightWithDecimals,') && !page.includes('delegated.weightWithDecimals'));
  assert.ok(page.includes("const delegatedWeight = (delegation) => delegation?.weight?.toString() || '0';"));
  assert.ok(page.includes('Delegated · {formatAmount(delegatedWeight(delegated), 8, { maxDecimals: 0 })} ZNN'));
  assert.equal(formatAmount('1000000000000', 8, { maxDecimals: 0 }), '10,000');
  assert.equal(formatAmount(ethers.BigNumber.from('999700000000').toString(), 8, { maxDecimals: 0 }), '9,997');
});

//
// About
//
test('about: versions compare by number, and only an exact version counts', () => {
  const release = load('src/services/utils/release.js', cache);
  assert.deepEqual(release.parseVersion('v0.3.10'), [0, 3, 10]);
  for (const bad of ['', '0.3', '0.3.4-beta', '0.3.4.1', 'latest', '1.2.x', null, 4, 'v0.3.4\nhttps://evil.example']) assert.equal(release.parseVersion(bad), null, String(bad));
  assert.equal(release.isNewer('0.3.10', '0.3.9'), true, 'not compared as text');
  assert.equal(release.isNewer('0.4.0', '0.3.99'), true);
  assert.equal(release.isNewer('0.3.4', '0.3.4'), false);
  assert.equal(release.isNewer('0.3.3', '0.3.4'), false);
  assert.equal(release.releaseState('0.3.5', '0.3.4'), 'update');
  assert.equal(release.releaseState('0.3.4', '0.3.4'), 'current');
  assert.equal(release.releaseState('0.3.3', '0.3.4'), 'current', 'a build ahead of the releases is not told to update');
  assert.equal(release.releaseState(null, '0.3.4'), 'unknown');
});

test('about: one request for the tag, kept six hours, and no answer is ever an error', async () => {
  const release = load('src/services/utils/release.js', cache);
  memory.delete('releaseCheck');
  const asked = [];
  const answer = (body, ok = true) => async (url, options) => { asked.push([url, options]); return { ok, json: async () => body }; };
  assert.equal(await release.latestVersion({ fetcher: answer({ tag_name: 'v0.4.1', html_url: 'https://evil.example' }), now: 1000 }), '0.4.1');
  assert.equal(asked[0][0], 'https://api.github.com/repos/sol-znn/syrius-extension/releases/latest');
  assert.equal(JSON.stringify(asked[0]).includes('z1'), false, 'nothing about the wallet is sent');
  // Kept: no second request inside six hours, one after.
  assert.equal(await release.latestVersion({ fetcher: answer({ tag_name: 'v9.9.9' }), now: 1000 + 6 * 3600 * 1000 - 1 }), '0.4.1');
  assert.equal(asked.length, 1);
  assert.equal(await release.latestVersion({ fetcher: answer({ tag_name: 'v0.4.2' }), now: 1000 + 6 * 3600 * 1000 }), '0.4.2');
  memory.delete('releaseCheck');
  assert.equal(await release.latestVersion({ fetcher: answer({ tag_name: 'nightly' }) }), null);
  assert.equal(await release.latestVersion({ fetcher: answer({ tag_name: 'v1.0.0' }, false) }), null, 'a refused request');
  assert.equal(await release.latestVersion({ fetcher: async () => { throw new Error('offline'); } }), null);
  assert.equal(memory.has('releaseCheck'), false, 'a failure is not kept');

  // The screen links to the constant pages, never to what the answer names.
  const read = (file) => require('node:fs').readFileSync(path.join(root, file), 'utf8');
  const page = read('src/pages/settings/about/about.js');
  assert.equal(release.releasesUrl, 'https://github.com/sol-znn/syrius-extension/releases');
  assert.ok(page.includes('href: releasesUrl') && !/html_url|tag_name/.test(page));
  assert.ok(page.includes('target="_blank" rel="noreferrer"'));
  assert.ok(read('src/layouts/tabsLayout/tabsLayout.js').includes('<Route path="settings/about" element={<About />} />'));
  assert.ok(read('src/pages/settings/settings/settings.js').includes('<SettingsItem icon="info" title="About" url="about" />'));
  assert.ok(read('privacy-policy.md').includes('**GitHub:**'), 'the request is in the privacy policy');
  // The lock screen says so only when there is something newer, and links
  // the same constant page.
  const lock = read('src/pages/dashboard/dashboard-password/dashboard-password.js');
  assert.ok(lock.includes("releaseState(latest, currentVersion()) === 'update') setUpdate(latest)"));
  assert.ok(lock.includes('{update && (') && lock.includes('href={releasesUrl}') && !/html_url|tag_name/.test(lock));
});

test('about: Update applies a browser-managed update and downloads otherwise, per platform', async () => {
  const { updateNow, statusOf, downloadUrl } = load('src/services/utils/selfUpdate.js', cache);
  assert.equal(statusOf('update_available'), 'update_available');
  assert.equal(statusOf({ status: 'no_update', version: '' }), 'no_update');
  assert.equal(statusOf(['throttled', {}]), 'throttled');
  assert.equal(statusOf(undefined), 'failed');
  // Built from the version and the repository constant, never from the answer.
  const releases = 'https://github.com/sol-znn/syrius-extension/releases';
  assert.equal(downloadUrl('v0.3.7', 'chrome'), `${releases}/download/v0.3.7/syrius-extension-0.3.7-chrome-brave.zip`);
  assert.equal(downloadUrl('0.3.7', 'firefox'), `${releases}/download/v0.3.7/syrius-extension-0.3.7-firefox.xpi`);
  assert.equal(downloadUrl('0.3.7', 'android'), `${releases}/download/v0.3.7/syrius-0.3.7-android.apk`);
  assert.equal(downloadUrl('0.3.7', 'ios'), `${releases}/tag/v0.3.7`);
  assert.equal(downloadUrl('0.3.7/../../evil', 'chrome'), `${releases}/latest`);
  const browser = ({ installType = 'normal', status = 'update_available', ready = true, getSelfThrows = false }) => {
    const listeners = new Set();
    const calls = [];
    global.chrome = {
      management: { getSelf: (callback) => { if (getSelfThrows) throw new Error('no management'); callback({ installType }); } },
      runtime: {
        lastError: undefined,
        requestUpdateCheck: (callback) => {
          calls.push('check');
          callback({ status });
          if (ready && status === 'update_available') setImmediate(() => listeners.forEach((listener) => listener({ version: '9.9.9' })));
        },
        onUpdateAvailable: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
      },
    };
    return calls;
  };
  let reloaded = 0;
  const reload = () => { reloaded += 1; };
  // Unpacked from a ZIP, or a browser that will not say: never asks.
  for (const options of [{ installType: 'development' }, { getSelfThrows: true }]) {
    let calls = browser(options);
    assert.deepEqual(await updateNow('0.3.7', { target: 'chrome', reload }), { result: 'unzip', url: downloadUrl('0.3.7', 'chrome') });
    calls = browser(options);
    assert.deepEqual(await updateNow('0.3.7', { target: 'firefox', reload }), { result: 'download', url: downloadUrl('0.3.7', 'firefox') });
    assert.deepEqual(calls, []);
  }
  // Mobile never asks a browser.
  for (const target of ['android', 'ios']) {
    const calls = browser({});
    assert.deepEqual(await updateNow('0.3.7', { target, reload }), { result: 'download', url: downloadUrl('0.3.7', target) });
    assert.deepEqual(calls, []);
  }
  // Browser-managed: check, wait for it, reload.
  for (const target of ['chrome', 'firefox']) {
    browser({});
    assert.deepEqual(await updateNow('0.3.7', { target, reload }), { result: 'reloading', url: null });
  }
  assert.equal(reloaded, 2);
  for (const [status, expected] of [['no_update', 'not-yet'], ['throttled', 'throttled'], ['weird', 'failed']]) {
    browser({ status });
    assert.deepEqual(await updateNow('0.3.7', { target: 'chrome', reload }), { result: expected, url: null });
  }
  // Firefox falls back to opening the signed package, which installs over this one.
  for (const status of ['no_update', 'weird']) {
    browser({ status });
    assert.deepEqual(await updateNow('0.3.7', { target: 'firefox', reload }), { result: 'download', url: downloadUrl('0.3.7', 'firefox') });
  }
  assert.equal(reloaded, 2, 'reloaded without an update in hand');
  delete global.chrome;
});

//
// History rows
//
test('history: a send to oneself is a send, and its receive is the only row that reads Received', () => {
  const { identify } = load('src/services/hooks/useTransactions.js', cache);
  // The send block as the node returns it, and as a receive row is shown (the
  // receive is expanded to the send it took in): to and from are both a1.
  const selfSend = { address: a1, toAddress: a1, data: '' };
  assert.equal(identify(selfSend, a1, 2).type, 'sent', 'own block is a send');
  assert.equal(identify(selfSend, a1, 2).label, 'Sent');
  assert.equal(identify(selfSend, a1, 3).type, 'received', 'own block is the receive');
  // Unchanged: somebody else's send taken in, and a send to somebody else.
  assert.equal(identify({ address: a2, toAddress: a1, data: '' }, a1, 3).type, 'received');
  assert.equal(identify({ address: a1, toAddress: a2, data: '' }, a1, 2).type, 'sent');
  assert.equal(identify({ address: 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp', toAddress: a1, data: '' }, a1, 3).counterpartyName, 'Plasma');
  // A block whose type is not known falls back to where it is addressed.
  assert.equal(identify({ address: a2, toAddress: a1, data: '' }, a1, NaN).type, 'received');

  // The receive row links to the send it took in, so the two share `hash`.
  // They are still two rows: a fresh reading of one must not replace the other.
  const { mergeRows } = load('src/services/hooks/useTransactions.js', cache);
  const sendRow = { id: 'own-send', hash: 'send', type: 'sent' };
  const receiveRow = { id: 'own-receive', hash: 'send', type: 'received' };
  assert.deepEqual(mergeRows([sendRow], [receiveRow, sendRow]).map((row) => row.type), ['received', 'sent']);
  assert.deepEqual(mergeRows([receiveRow, sendRow], [receiveRow, sendRow]).map((row) => row.type), ['received', 'sent']);
  assert.deepEqual(mergeRows([sendRow], [{ ...sendRow, confirmations: 3 }]), [{ ...sendRow, confirmations: 3 }]);
  const source = require('node:fs').readFileSync(path.join(root, 'src/services/hooks/useTransactions.js'), 'utf8');
  assert.ok(source.includes('id: rowId(own) || rowId(block),'), 'a row is identified by the account\'s own block');
  assert.ok(require('node:fs').readFileSync(path.join(root, 'src/pages/dashboard/dashboard/dashboard.js'), 'utf8').includes('key={transaction.id ||'));
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
  }
  console.log(`operator-mode-test: ${passed} passed`);
})().catch((error) => { console.error(error); process.exit(1); });

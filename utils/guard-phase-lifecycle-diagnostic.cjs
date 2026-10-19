'use strict';
// Instrument protocol method/type enums only; no payloads, URLs or exception text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const assert = require('node:assert/strict');
const filename = path.join(__dirname, 'fixtures/production-browser.js');
let source = fs.readFileSync(filename, 'utf8');
console.log(JSON.stringify({ diagnostic_helper_sha256: crypto.createHash('sha256').update(source).digest('hex') }));
const start = source.indexOf('    const ready = (async () => {');
const end = source.indexOf('    target.ready = ready;', start);
assert(start > 0 && end > start);
source = source.slice(0, start) + "    let phase = 'START';\n    const guarded = (method, ...args) => { phase = method; return cdp(method, ...args); };\n" +
  source.slice(start, end).replace(/\bcdp\(/g, 'guarded(') + source.slice(end);
const caught = "    ready.catch(() => {\n      if (!stopping && !stopped && sessions.has(sessionId)) fatalError = failure('BROWSER_NETWORK_GUARD_FAILED');\n    });";
assert.equal(source.split(caught).length, 2);
source = source.replace(caught, "    ready.catch(error => {\n      if (!stopping && !stopped && sessions.has(sessionId)) {\n        stats.guardFailure = { targetType: target.type, phase, code: error.code || 'UNKNOWN' };\n        fatalError = failure('BROWSER_NETWORK_GUARD_FAILED');\n      }\n    });");
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(source, filename);
require.cache[filename] = loaded;
require('./keyfile-lifecycle-browser-test.js');

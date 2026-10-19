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
source = source.replace(caught, "    ready.catch(error => {\n      if (!stopping && !stopped && sessions.has(sessionId)) {\n        stats.guardFailure ||= { targetType: target.type, phase, code: error.code || 'UNKNOWN' };\n        fatalError = failure('BROWSER_NETWORK_GUARD_FAILED');\n      }\n    });");
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(source, filename);
require.cache[filename] = loaded;
const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-owned-worker-churn-'));
const extensionDir = path.join(temporary, 'extension'); fs.mkdirSync(extensionDir);
fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({manifest_version:3,name:'Owned worker attachment control',version:'1.0',permissions:['storage']}));
fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<!doctype html><title>Owned worker attachment control</title>');
fs.writeFileSync(path.join(extensionDir, 'worker.js'), 'self.onmessage = () => {};');
let browser, stopped = true;
const report = {diagnostic_only:true,control:'worker termination during attachment',workers:20,production_keyfile_qualified:false};
(async()=>{
  try {
    browser = await loaded.exports.startBrowser({extensionDir,profileDir:path.join(temporary,'profile')});
    const page = await browser.openPage();
    report.browser = browser.browserVersion;
    await browser.evaluate(page, "(()=>{globalThis.ownedWorkers=Array.from({length:20},()=>new Worker('worker.js'));setTimeout(()=>{globalThis.ownedWorkers.forEach(worker=>worker.terminate());globalThis.ownedWorkersEnded=true;},20);return true})()");
    await browser.until(page, 'globalThis.ownedWorkersEnded===true', 'owned workers terminated', 15000);
    for(let i=0;i<5;i++) { await new Promise(resolve=>setTimeout(resolve,100)); await browser.evaluate(page,'true'); }
    report.survived_owned_worker_termination = true;
  } catch(error) {
    report.survived_owned_worker_termination = false;
    report.failure_code = error.code || 'UNKNOWN';
    if(error.code === 'BROWSER_SHUTDOWN_TIMEOUT') stopped = false;
  } finally {
    if(browser) {
      report.guard_failure = browser.stats.guardFailure || null;
      report.network = {...browser.stats};
      try { await browser.stop(); } catch(error) { stopped=false; report.cleanup_error=error.code||'UNKNOWN'; }
    }
    if(stopped) fs.rmSync(temporary,{recursive:true,force:true});
    report.fixture_removed = !fs.existsSync(temporary);
    console.log(JSON.stringify(report));
  }
})();

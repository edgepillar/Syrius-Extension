'use strict';

// Inert native control. Only protocol method/type/code enums and counts leave RAM.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const filename = path.join(__dirname, 'fixtures/production-browser.js');
let source = fs.readFileSync(filename, 'utf8');
const helperDigest = crypto.createHash('sha256').update(source).digest('hex');
const replace = (before, after) => {
  assert.equal(source.split(before).length, 2, 'Unique diagnostic seam');
  source = source.replace(before, after);
};
replace('    pending.set(next, {', '    pending.set(next, { method, sessionId,');
replace('    const guarded = (method, ...args) => { phase = method; return cdp(method, ...args); };',
  '    const guarded = (method, ...args) => { phase = method; if (target.type === "worker") module.probe?.phase(method, cdp); return cdp(method, ...args); };');
replace('      const callback = pending.get(message.id);',
  '      const callback = pending.get(message.id);\n      module.probe?.message(message, callback, sessions);');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(source, filename);

const phases = ['Network.enable', 'Network.setBlockedURLs', 'Network.emulateNetworkConditions',
  'Runtime.enable', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger'];
const reports = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const selectedPhase of phases) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-owned-guard-termination-'));
    fs.chmodSync(temporary, 0o700);
    const extensionDir = path.join(temporary, 'extension');
    fs.mkdirSync(extensionDir);
    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({ manifest_version: 3,
      name: 'Owned guard termination control', version: '1.0', permissions: ['storage'] }));
    fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<!doctype html><title>Owned termination control</title>');
    fs.writeFileSync(path.join(extensionDir, 'worker.js'), 'self.onmessage = () => {};');
    let browser, page, armed = false, triggered = false, stopped = true;
    let eventSequence = 0;
    const workerSessions = new Set();
    const detachedSessions = new Set();
    const terminationCommands = [];
    const report = { diagnostic_only: true, helper_sha256: helperDigest, selected_phase: selectedPhase,
      worker_attachments: 0, worker_detachments: 0, protocol_errors: [], guard_failed: false };
    loaded.probe = {
      phase(method, cdp) {
        if (armed && !triggered && method === selectedPhase) {
          triggered = true;
          report.termination_sent_at = ++eventSequence;
          terminationCommands.push(cdp('Runtime.evaluate', { expression: 'globalThis.ownedWorker.terminate(); true',
            returnByValue: true }, page.sessionId).then(() => { report.termination_acknowledged = true; },
            error => { report.termination_error = error.code || 'UNKNOWN'; }));
        }
      },
      message(message, callback, sessions) {
        const order = ++eventSequence;
        if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'worker') {
          workerSessions.add(message.params.sessionId);
          report.worker_attachments++;
        }
        if (message.method === 'Target.detachedFromTarget' && workerSessions.has(message.params.sessionId)) {
          detachedSessions.add(message.params.sessionId);
          report.worker_detachments++;
          report.last_detachment_at = order;
        }
        if (callback && message.error && workerSessions.has(callback.sessionId)) {
          report.protocol_errors.push({ order, phase: callback.method,
            protocol_code: Number.isInteger(message.error.code) ? message.error.code : null,
            session_present: sessions.has(callback.sessionId),
            detachment_observed: detachedSessions.has(callback.sessionId),
            error_class: /closed|terminated|not found|No session/i.test(message.error.message || '') ? 'TARGET_LIFECYCLE' : 'OTHER' });
        }
      },
    };
    try {
      browser = await loaded.exports.startBrowser({ extensionDir, profileDir: path.join(temporary, 'profile') });
      report.browser = browser.browserVersion;
      page = await browser.openPage();
      armed = true;
      await browser.evaluate(page, "(()=>{globalThis.ownedWorker=new Worker('worker.js');return true})()");
      const by = Date.now() + 15000;
      while (!triggered && Date.now() < by) await sleep(10);
      assert(triggered, 'Selected worker guard phase reached');
      await Promise.all(terminationCommands);
      await sleep(250);
      await browser.evaluate(page, 'true');
      report.survived = true;
    } catch (error) {
      report.survived = false;
      report.failure_code = error.code || 'ASSERTION';
      report.guard_failed = error.code === 'BROWSER_NETWORK_GUARD_FAILED';
    } finally {
      if (browser) {
        report.guard_failure = browser.stats.guardFailure;
        try { await browser.stop(); } catch (error) { stopped = false; report.cleanup_error = error.code || 'UNKNOWN'; }
        report.network = { ...browser.stats };
      }
      if (stopped) fs.rmSync(temporary, { recursive: true, force: true });
      report.fixture_removed = !fs.existsSync(temporary);
      reports.push(report);
      console.log(JSON.stringify(report));
    }
  }
  console.log(JSON.stringify({ diagnostic_summary: true, controls: reports.length,
    guard_failures: reports.filter(report => report.guard_failed).length,
    all_fixtures_removed: reports.every(report => report.fixture_removed),
    production_keyfile_qualified: false }));
  if (reports.some(report => !report.fixture_removed || !report.termination_acknowledged ||
      report.network?.externalResponses !== 0 || report.network?.externalWebSocketHandshakes !== 0)) process.exitCode = 1;
})().catch(() => { console.log(JSON.stringify({ diagnostic_incomplete: true })); process.exitCode = 1; });

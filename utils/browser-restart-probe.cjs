'use strict';
// Diagnostic only: non-secret storage markers, no wallet/key/signing operation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = process.cwd();
const filename = path.join(root, 'utils/fixtures/production-browser.js');
const original = fs.readFileSync(filename, 'utf8');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-restart-probe-'));
const sourceDigest = crypto.createHash('sha256').update(original).digest('hex');
const results = [];
let allProcessesStopped = true;
const assignment = "    extensionId = (await cdp('Extensions.loadUnpacked', { path: extensionDir })).id;";
assert.equal(original.split(assignment).length, 2);

function helper(mode) {
  let source = original.replace(assignment,
    "    const installed = (await cdp('Extensions.getExtensions')).extensions || [];\n" +
    "    const retained = installed.filter(entry => entry.enabled === true && path.resolve(entry.path) === path.resolve(extensionDir));\n" +
    "    stats.retainedInstallsBeforeLoad = retained.length;\n" +
    (mode === 'reuse' ? "    extensionId = retained.length === 1 ? retained[0].id : (await cdp('Extensions.loadUnpacked', { path: extensionDir })).id;" : assignment));
  source = source.replace('    socket?.close();', '    stats.shutdownExitCode = browser?.exitCode; stats.shutdownSignal = browser?.signalCode;\n    socket?.close();');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

async function run(mode, extensionDir, label) {
  const profileDir = path.join(temporary, label + '-' + mode);
  const { startBrowser } = helper(mode);
  const options = { extensionDir, profileDir, setupScript: "if(!localStorage.getItem('currentNodeUrl'))localStorage.setItem('currentNodeUrl','wss://offline.invalid:1');if(!localStorage.getItem('syrius.settings'))localStorage.setItem('syrius.settings',JSON.stringify({autoReceive:false,autoLockMinutes:15}));" };
  let browser;
  const value = { mode, fixture: label, passed: false };
  try {
    browser = await startBrowser(options);
    value.browser = browser.browserVersion;
    const page = await browser.openPage();
    await browser.evaluate(page, "(localStorage.setItem('qualification.restart','non-secret-owned-fixture'),true)");
    value.before = await browser.evaluate(page, "localStorage.getItem('qualification.restart')==='non-secret-owned-fixture'");
    const firstId = browser.id;
    const firstStats = browser.stats;
    await browser.stop(); browser = null;
    value.firstShutdownExit = firstStats.shutdownExitCode;
    value.firstShutdownSignal = firstStats.shutdownSignal;
    browser = await startBrowser(options);
    value.sameIdentity = browser.id === firstId;
    value.retainedInstallsBeforeReload = browser.stats.retainedInstallsBeforeLoad;
    const restarted = await browser.openPage();
    value.after = await browser.evaluate(restarted, "localStorage.getItem('qualification.restart')==='non-secret-owned-fixture'");
    value.externalResponses = firstStats.externalResponses + browser.stats.externalResponses;
    value.externalWebSocketHandshakes = firstStats.externalWebSocketHandshakes + browser.stats.externalWebSocketHandshakes;
    value.passed = value.before && value.after && value.sameIdentity && value.firstShutdownExit === 0 && !value.firstShutdownSignal;
  } catch (error) {
    value.errorCode = error.code || 'UNCLASSIFIED_DIAGNOSTIC_ERROR';
    if (error.code === 'BROWSER_SHUTDOWN_TIMEOUT') allProcessesStopped = false;
  } finally {
    if (browser) {
      try { await browser.stop(); } catch (error) {
        allProcessesStopped = false;
        value.cleanupError = error.code || 'CLEANUP_ERROR';
      }
    }
  }
  results.push(value);
}

(async () => {
  const minimal = path.join(temporary, 'minimal'); fs.mkdirSync(minimal);
  fs.writeFileSync(path.join(minimal, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Owned restart diagnostic', version: '1.0', permissions: ['storage'] }));
  fs.writeFileSync(path.join(minimal, 'popup.html'), '<!doctype html><title>Owned storage diagnostic</title>');
  await run('original', minimal, 'minimal');
  await run('original', path.join(root, 'build'), 'production');
  await run('reuse', path.join(root, 'build'), 'production');
})().catch(() => { process.exitCode = 1; }).finally(() => {
  // Uncertain shutdown retains the owned fixture; it never authorizes deletion.
  if (allProcessesStopped) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ diagnostic_only: true, source_sha256: sourceDigest, results, fixture_removed: !fs.existsSync(temporary), all_processes_stopped: allProcessesStopped, product_keyfile_qualified: false }));
});

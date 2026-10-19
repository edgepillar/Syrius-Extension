'use strict';
// Owned, non-secret markers only. This diagnostic is not wallet qualification.
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
const results = [];
let allProcessesStopped = true;
const sourceDigest = crypto.createHash('sha256').update(original).digest('hex');
const anchor = "    await closePage(settings);\n    extensionId = (await cdp('Extensions.loadUnpacked', { path: extensionDir })).id;";
assert.equal(original.split(anchor).length, 2);

const persistentInstall = `    const matching = async () => {
      const listed = await cdp('Extensions.getExtensions');
      return (listed.extensions || []).filter(entry => entry.enabled === true && path.resolve(entry.path) === path.resolve(extensionDir));
    };
    let installed = await matching();
    stats.retainedInstallsBeforeLoad = installed.length;
    if (installed.length > 1) throw failure('BROWSER_EXTENSION_AMBIGUOUS');
    if (!installed.length) {
      const loaded = await cdp('Extensions.loadUnpacked', { path: extensionDir });
      // Reload through Chrome's ordinary developer UI before creating any data.
      const reloaded = await evaluate(settings, 'new Promise(resolve => chrome.developerPrivate.reload(' + JSON.stringify(loaded.id) + ', {failQuietly:true,populateErrorForUnpacked:true}, result => resolve(!chrome.runtime.lastError && !result)))');
      if (!reloaded) throw failure('BROWSER_PERSISTENT_INSTALL_FAILED');
      installed = await matching();
      if (installed.length !== 1 || installed[0].id !== loaded.id) throw failure('BROWSER_PERSISTENT_INSTALL_FAILED');
    }
    extensionId = installed[0].id;
    await closePage(settings);`;

function helper(mode) {
  let source = original.replace(anchor, mode === 'normalReload' ? persistentInstall :
    "    const installed = (await cdp('Extensions.getExtensions')).extensions || [];\n" +
    "    stats.retainedInstallsBeforeLoad = installed.filter(entry => entry.enabled === true && path.resolve(entry.path) === path.resolve(extensionDir)).length;\n" + anchor);
  if (mode === 'normalReload') {
    const registration = "        const loaded = await cdp('Extensions.loadUnpacked', { path: extensionDir });\n        if (loaded.id !== extensionId) throw failure('BROWSER_EXTENSION_ID_CHANGED');\n";
    assert.equal(source.split(registration).length, 2);
    source = source.replace(registration, '');
    const available = "        const listed = await cdp('Extensions.getExtensions');\n        if (!listed.extensions?.some(extension => extension.id === extensionId && extension.enabled === true)) {\n          throw failure('BROWSER_RELOAD_UNAVAILABLE');\n        }";
    assert.equal(source.split(available).length, 2);
    source = source.replace(available, "        const reloadBy = Date.now() + 15000;\n        let available = false;\n        while (!available && Date.now() < reloadBy) {\n          const listed = await cdp('Extensions.getExtensions');\n          available = listed.extensions?.some(extension => extension.id === extensionId && extension.enabled === true && path.resolve(extension.path) === path.resolve(extensionDir));\n          if (!available) await sleep(50);\n        }\n        if (!available) throw failure('BROWSER_RELOAD_UNAVAILABLE');");
  }
  source = source.replace('    socket?.close();', '    stats.shutdownExitCode = browser?.exitCode; stats.shutdownSignal = browser?.signalCode;\n    socket?.close();');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

async function run(mode, extensionDir, fixture) {
  const profileDir = path.join(temporary, fixture + '-' + mode);
  const { startBrowser } = helper(mode);
  const options = { extensionDir, profileDir, setupScript: "if(!localStorage.getItem('currentNodeUrl'))localStorage.setItem('currentNodeUrl','wss://offline.invalid:1');if(!localStorage.getItem('syrius.settings'))localStorage.setItem('syrius.settings',JSON.stringify({autoReceive:false,autoLockMinutes:15}));" };
  let browser;
  const value = { mode, fixture, passed: false, epochs: [] };
  try {
    let firstId;
    for (let epoch = 0; epoch < 3; epoch++) {
      browser = await startBrowser(options);
      value.browser = browser.browserVersion;
      let page = await browser.openPage();
      firstId ||= browser.id;
      const sameIdentity = browser.id === firstId;
      if (epoch === 0) await browser.evaluate(page, "(async()=>{localStorage.setItem('qualification.restart','non-secret-owned-fixture');await chrome.storage.local.set({'qualification.restart':'non-secret-owned-fixture'});return true})()");
      if (epoch === 0) {
        await browser.reloadExtension();
        page = await browser.openPage();
        value.runtimeReloadPreserved = await browser.evaluate(page, "localStorage.getItem('qualification.restart')==='non-secret-owned-fixture'");
      }
      const web = await browser.evaluate(page, "localStorage.getItem('qualification.restart')==='non-secret-owned-fixture'");
      const local = await browser.evaluate(page, "(async()=>((await chrome.storage.local.get('qualification.restart'))['qualification.restart']==='non-secret-owned-fixture'))()");
      const stats = browser.stats;
      await browser.stop(); browser = null;
      value.epochs.push({ web, local, sameIdentity,
        retainedInstallsBeforeLoad: stats.retainedInstallsBeforeLoad,
        cleanExit: stats.shutdownExitCode === 0 && !stats.shutdownSignal,
        externalResponses: stats.externalResponses, externalWebSocketHandshakes: stats.externalWebSocketHandshakes });
    }
    value.passed = value.runtimeReloadPreserved && value.epochs.every((epoch, index) => epoch.web && epoch.local && epoch.cleanExit && epoch.sameIdentity &&
      epoch.externalResponses === 0 && epoch.externalWebSocketHandshakes === 0 &&
      (index === 0 || mode !== 'normalReload' || epoch.retainedInstallsBeforeLoad === 1));
  } catch (error) {
    value.errorCode = error.code || 'UNCLASSIFIED_DIAGNOSTIC_ERROR';
    if (error.code === 'BROWSER_SHUTDOWN_TIMEOUT') allProcessesStopped = false;
  } finally {
    if (browser) try { await browser.stop(); } catch (error) {
      allProcessesStopped = false; value.cleanupError = error.code || 'CLEANUP_ERROR';
    }
  }
  results.push(value);
}

(async () => {
  const minimal = path.join(temporary, 'minimal'); fs.mkdirSync(minimal);
  fs.writeFileSync(path.join(minimal, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Owned restart diagnostic', version: '1.0', permissions: ['storage'] }));
  fs.writeFileSync(path.join(minimal, 'popup.html'), '<!doctype html><title>Owned storage diagnostic</title>');
  await run('original', minimal, 'minimal');
  await run('normalReload', minimal, 'minimal');
  await run('normalReload', path.join(root, 'build'), 'production');
})().catch(() => { process.exitCode = 1; }).finally(() => {
  if (allProcessesStopped) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ diagnostic_only: true, source_sha256: sourceDigest, results,
    fixture_removed: !fs.existsSync(temporary), all_processes_stopped: allProcessesStopped, product_keyfile_qualified: false }));
});

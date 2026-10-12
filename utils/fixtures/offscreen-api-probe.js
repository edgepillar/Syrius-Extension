'use strict';

// Fork-only native API observation. The owned extension contains no wallet,
// SDK, key material, node, transaction or external content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const legacy = process.env.SYRIUS_LEGACY_BROWSER === '1';
const { startBrowser } = require(legacy ? './production-browser-legacy' : './production-browser');
const source = '1b48a0999ad95c387d86c0c81c93cc8b37902569';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reportPath = process.env.SYRIUS_BACKGROUND_API_REPORT;
assert(reportPath && path.isAbsolute(reportPath));
assert(['true', 'false'].includes(process.env.SYRIUS_EXPECT_WORKERS_SUPPORTED));
const expected = process.env.SYRIUS_EXPECT_WORKERS_SUPPORTED === 'true';
const manifest = fs.readFileSync(path.join(root, 'src/manifest.json'));
const receiver = fs.readFileSync(path.join(root, 'src/sections/Background/receiver.js'));
for (const [name, bytes] of [['src/manifest.json', manifest], ['src/sections/Background/receiver.js', receiver]]) {
  assert(execFileSync('git', ['show', source + ':' + name], { cwd: root }).equals(bytes));
}
assert(receiver.toString().includes("reasons: ['WORKERS']"));
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-offscreen-api-'));
const extensionDir = path.join(owned, 'extension');
const profileDir = path.join(owned, 'profile');
fs.mkdirSync(extensionDir);
fs.mkdirSync(profileDir);
fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Owned offscreen API fixture', version: '1.0.0',
  minimum_chrome_version: '109', permissions: ['offscreen'],
  background: { service_worker: 'background.js' }, action: { default_popup: 'popup.html' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
}));
fs.writeFileSync(path.join(extensionDir, 'background.js'), "'use strict';\n");
for (const file of ['popup.html', 'receiver.html']) {
  fs.writeFileSync(path.join(extensionDir, file), '<!doctype html><html><head><title>Owned API fixture</title></head><body></body></html>');
}
let browser;
const report = {
  source, node: process.version, source_manifest_sha256: digest(manifest),
  source_receiver_sha256: digest(receiver), declared_minimum_chrome: JSON.parse(manifest).minimum_chrome_version,
  native_api_fixture_only: true, product_receiver_execution_qualified: false,
  no_wallet_sdk_node_signing_or_chain: true, expected_workers_supported: expected,
};
(async () => {
  try {
    browser = await startBrowser({ extensionDir, profileDir });
    report.browser = browser.browserVersion;
    report.browser_distribution = legacy ? 'Chromium (not Google Chrome)' : 'Chrome for Testing or runner Chrome';
    const page = await browser.openPage();
    report.observation = await browser.evaluate(page, `(async () => {
      const enumPresent = chrome.offscreen?.Reason?.WORKERS === 'WORKERS';
      let accepted = false, errorName = null;
      try {
        await chrome.offscreen.createDocument({ url: 'receiver.html', reasons: ['WORKERS'],
          justification: 'Owned native API compatibility fixture; no wallet or network.' });
        accepted = true;
        await chrome.offscreen.closeDocument();
      } catch (error) { errorName = String(error?.name || 'Error'); }
      return { workers_enum_present: enumPresent, workers_document_accepted: accepted, error_name: errorName };
    })()`);
    assert.equal(report.observation.workers_enum_present, expected);
    assert.equal(report.observation.workers_document_accepted, expected);
    if (legacy) assert.equal(report.browser, 'Chrome/112.0.5615.29');
    assert.equal(browser.stats.externalResponses, 0);
    assert.equal(browser.stats.externalWebSocketHandshakes, 0);
    assert.equal(browser.stats.runtimeErrors, 0);
    assert.equal(browser.stats.cspErrors, 0);
    report.network = { ...browser.stats };
    report.passed = true;
  } finally {
    if (browser) await browser.stop();
    fs.rmSync(owned, { recursive: true, force: true });
    report.profile_removed = !fs.existsSync(owned);
    if (legacy) {
      report.startup_observability_limit = 'CLI-loaded fixture starts before CDP attachment; the owned denying proxy covers transport, but later counters do not certify that interval.';
      report.browser_provenance = {
        distribution: 'Chromium', playwright_version: '1.32.1', revision: '1055',
        archive_url: 'https://playwright-akamai.azureedge.net/builds/chromium/1055/chromium-linux.zip',
        archive_sha256: '5dc43c51d3c226efeaf4f06c8aa9e993ac6e90cc36b9f5bb16b5a0deab13c268',
      };
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
})().then(() => console.log(JSON.stringify({ native_api_observation_verified: true,
  browser: report.browser, workers_supported: report.observation.workers_document_accepted,
  product_receiver_qualified: false, profile_removed: report.profile_removed })), error => {
  console.error('Native API observation incomplete:', error.code || error.name || 'ERROR');
  process.exitCode = 1;
});

'use strict';

// Optional test transport only: run every assertion and cleanup path from the
// existing lifecycle fixture against the same untouched production package.
// The SDK, cryptography, UI and storage implementation are never replaced.
const fs = require('node:fs');
const modern = require('./fixtures/production-browser');
const legacy = require('./fixtures/production-browser-legacy');
modern.startBrowser = legacy.startBrowser;

// The fixture writes its report after cleanup, including signal handling.
// Synchronous exit annotation adds fixed provenance without recording secrets.
process.once('exit', () => {
  const file = process.env.SYRIUS_LIFECYCLE_REPORT;
  if (!file || !fs.existsSync(file)) return;
  try {
    const report = JSON.parse(fs.readFileSync(file));
    report.browser_distribution = 'Chromium (not Google Chrome)';
    report.minimum_runtime = { playwright_version: '1.32.1', revision: '1055', expected_version: '112.0.5615.29' };
    report.startup_observability_limit = 'CLI-loaded extension starts before CDP attachment; the owned denying proxy covers that interval, while post-attachment counters cannot certify unobserved startup.';
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  } catch {
    console.error('Minimum-runtime report annotation failed.');
    process.exitCode = 1;
  }
});

require('./keyfile-lifecycle-browser-test');

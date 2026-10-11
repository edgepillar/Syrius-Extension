'use strict';

// Fork-only package/report association. Never copy browser profiles, protocol
// payloads, wallet material or evaluated expressions into evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const required = name => { assert(process.env[name], 'Required qualification configuration missing'); return process.env[name]; };
const metadataFile = required('SYRIUS_MINIMUM_PACKAGE_METADATA');
const tree = dir => {
  const files = [];
  const visit = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert(!entry.isSymbolicLink(), 'Package symlink refused');
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(path.join(current, entry.name), name);
      else if (entry.isFile()) files.push([name, digest(fs.readFileSync(path.join(current, entry.name)))]);
    }
  };
  visit(dir);
  return { files, sha256: digest(JSON.stringify(files)) };
};

const prepare = () => {
  const downloadDir = required('SYRIUS_PACKAGE_DOWNLOAD_DIR');
  const packageDir = required('SYRIUS_MINIMUM_PACKAGE_DIR');
  const candidates = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Downloaded symlink refused');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) candidates.push(file);
    }
  };
  visit(downloadDir);
  // The pinned action may choose its own filename. Require exactly one raw
  // artifact and validate its bytes; do not assume a named ZIP was produced.
  assert.equal(candidates.length, 1, 'Expected one untouched package artifact');
  const archive = candidates[0], bytes = fs.readFileSync(archive);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'Downloaded artifact is not a ZIP');
  execFileSync('unzip', ['-tq', archive], { stdio: 'ignore' });
  // Validate member paths and symlink attributes before native extraction.
  execFileSync('python3', ['-c', [
    'import pathlib,stat,sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' for i in z.infolist():',
    '  p=pathlib.PurePosixPath(i.filename)',
    '  assert not p.is_absolute() and ".." not in p.parts and "\\\\" not in i.filename',
    '  assert not stat.S_ISLNK(i.external_attr >> 16)',
  ].join('\n'), archive], { stdio: 'ignore' });
  assert(!fs.existsSync(packageDir), 'Package extraction destination already exists');
  fs.mkdirSync(packageDir, { recursive: true });
  execFileSync('unzip', ['-q', archive, '-d', packageDir], { stdio: 'ignore' });
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3, 'Expected Manifest V3');
  assert.equal(manifest.version, required('SYRIUS_EXPECTED_PACKAGE_VERSION'), 'Package version changed');
  const members = tree(packageDir);
  assert(!members.files.some(([name]) => /\.map$|(?:^|\/)(?:desktop\.ini|dekstop\.ini|thumbs\.db|ehthumbs\.db)$/i.test(name)), 'Unexpected package metadata');
  const references = [manifest.background?.service_worker, manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}), ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap(item => [...(item.js || []), ...(item.css || [])])].filter(Boolean);
  for (const reference of references) {
    assert(typeof reference === 'string' && !path.isAbsolute(reference) && !reference.split('/').includes('..'), 'Invalid manifest reference');
    assert(fs.existsSync(path.join(packageDir, reference)), 'Manifest asset missing');
  }
  const metadata = {
    source_sha: required('GITHUB_SHA'), source_repository: required('GITHUB_REPOSITORY'), run_id: required('GITHUB_RUN_ID'),
    artifact_name: `syrius-extension-${manifest.version}-chrome-brave.zip`,
    artifact_delivery: 'pinned download-artifact v8; skip-decompress=true; digest-mismatch=error; filename discovered',
    zip_sha256: digest(bytes), zip_bytes: bytes.length, manifest_version: manifest.manifest_version, package_version: manifest.version,
    package_tree_sha256: members.sha256, member_count: members.files.length, member_sha256: members.files,
    manifest_at_root: true, referenced_assets_present: references.length, native_zip_CRC_check_passed: true,
  };
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
  console.log('Untouched candidate ZIP and member identity verified.');
};

const finalize = () => {
  const reportFile = required('SYRIUS_LIFECYCLE_REPORT');
  const metadata = JSON.parse(fs.readFileSync(metadataFile));
  let report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : {
    passed: false, failed_stage: 'minimum lifecycle report unavailable', cases: [],
  };
  report.candidate_artifact = metadata;
  report.browser_distribution = 'Chromium (not Google Chrome)';
  report.browser_provenance = {
    playwright_version: '1.32.1', revision: '1055', expected_version: '112.0.5615.29',
    archive_url: 'https://playwright-akamai.azureedge.net/builds/chromium/1055/chromium-linux.zip',
    archive_sha256: '5dc43c51d3c226efeaf4f06c8aa9e993ac6e90cc36b9f5bb16b5a0deab13c268',
  };
  report.startup_observability_limit = 'CLI-loaded extension starts before CDP attachment; owned denying proxy covers that interval, but post-attachment counters do not certify unobserved startup.';
  report.remaining_gates = ['Actual Google Chrome minimum-version qualification', 'Store installation, real version upgrade and permission policy'];
  if (report.package_tree_sha256 !== metadata.package_tree_sha256) {
    report.passed = false; report.artifact_association_failed = true;
  }
  const epochs = [report.first_browser_network, report.last_browser_network];
  const verified = report.passed === true && report.profile_removed === true && !report.interrupted &&
    /^(?:Chrome|Chromium)\/112\.0\.5615\.29$/.test(report.browser || '') &&
    report.cases?.length === 15 && report.cases.every(item => item.passed === true) &&
    epochs.every(stats => stats && stats.externalResponses === 0 && stats.externalWebSocketHandshakes === 0 &&
      stats.runtimeErrors === 0 && stats.cspErrors === 0 && stats.wasmModules > 0 &&
      stats.guardChecks?.http === true && stats.guardChecks?.webSocket === true &&
      stats.earlyExtensionStartupObserved === false);
  report.minimum_qualification_verified = verified;
  if (report.passed && !verified) {
    report.passed = false; report.failed_stage = 'minimum runtime evidence verification';
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log('Sanitized minimum-runtime report associated with exact candidate ZIP.');
  if (!report.passed) process.exitCode = 1;
};

try {
  if (process.argv[2] === 'prepare') prepare();
  else if (process.argv[2] === 'finalize') finalize();
  else throw new Error('Unknown qualification operation');
} catch {
  console.error('Minimum-runtime artifact qualification failed.');
  process.exitCode = 1;
}

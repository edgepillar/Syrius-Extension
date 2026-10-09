'use strict';

// Negative controls use disposable local package directories containing only
// package names/versions and the already supplied public README text. They do
// not edit the real dependency directory or use wallet/cryptographic fixtures.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const generate = require('./third-party-readme-notices');
const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '..')); 
const reportPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const names = ['asn1.js', 'brorand', 'des.js', 'elliptic', 'hash.js', 'hmac-drbg', 'isarray', 'miller-rabin', 'minimalistic-crypto-utils'];
const result = { positive: null, negative_controls: [], real_dependencies_modified: false, disposable_fixture_directories_removed: false };
const owned = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-notice-control-'));
  owned.push(root);
  for (const name of names) {
    const parent = name === 'isarray' ? path.dirname(require.resolve('browserify-sign/package.json', { paths: [sourceRoot] })) : sourceRoot;
    const sourceMetadata = require.resolve(name + '/package.json', { paths: [parent] });
    const metadata = JSON.parse(fs.readFileSync(sourceMetadata, 'utf8'));
    const target = name === 'isarray' ? path.join(root, 'node_modules/browserify-sign/node_modules/isarray') : path.join(root, 'node_modules', name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version: metadata.version }));
    fs.copyFileSync(path.join(path.dirname(sourceMetadata), 'README.md'), path.join(target, 'README.md'));
  }
  fs.writeFileSync(path.join(root, 'node_modules/browserify-sign/package.json'), JSON.stringify({ name: 'browserify-sign', version: '2.2.0' }));
  return root;
};
try {
  const realAsset = generate(sourceRoot);
  const validRoot = fixture();
  result.positive = { reproduced_exact_real_asset: generate(validRoot).equals(realAsset), real_asset_sha256: crypto.createHash('sha256').update(realAsset).digest('hex'), real_asset_bytes: realAsset.length };
  const cases = [
    ['missing_readme', root => fs.rmSync(path.join(root, 'node_modules/asn1.js/README.md')), error => error.code === 'ENOENT'],
    ['version_mismatch', root => fs.writeFileSync(path.join(root, 'node_modules/asn1.js/package.json'), JSON.stringify({ name: 'asn1.js', version: '0.0.0' })), error => error.message === 'Notice source version changed: asn1.js'],
    ['duplicate_license_heading', root => fs.appendFileSync(path.join(root, 'node_modules/asn1.js/README.md'), '\n## License\nUnreviewed appended source\n'), error => error.message === 'Ambiguous notice source: asn1.js'],
    ['missing_license_heading', root => { const file = path.join(root, 'node_modules/asn1.js/README.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^#{1,6}[ \t]+licen[sc]e[^\r\n]*$/gim, '## Unrecognized section')); }, error => error.message === 'Ambiguous notice source: asn1.js'],
    ['truncated_permission_notice', root => { const file = path.join(root, 'node_modules/asn1.js/README.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Permission is hereby granted', 'Unreviewed changed permission text')); }, error => error.message === 'Complete notice source changed: asn1.js'],
  ];
  for (const [name, modify, expected] of cases) {
    const root = fixture();
    modify(root);
    let refused = false;
    let expectedError = false;
    try { generate(root); } catch (error) { refused = true; expectedError = expected(error); }
    result.negative_controls.push({ name, generation_refused: refused, expected_refusal: expectedError });
  }
} finally {
  for (const directory of owned) fs.rmSync(directory, { recursive: true, force: true });
  result.disposable_fixture_directories_removed = owned.every(directory => !fs.existsSync(directory));
}
result.result = result.positive?.reproduced_exact_real_asset && result.negative_controls.every(control => control.generation_refused && control.expected_refusal) && result.disposable_fixture_directories_removed ? 'PASS' : 'FAIL';
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ result: result.result, negative_controls: result.negative_controls.length, fixture_cleanup: result.disposable_fixture_directories_removed }));
if (result.result !== 'PASS') process.exitCode = 1;

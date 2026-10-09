'use strict';

// Preserve nine attributable README license
// sections. Every source version and complete section must match qualification;
// dependency or notice drift requires review rather than silent truncation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const inputs = [
  ['asn1.js', '4.10.1', '3d4c482b33be93d2eecd755040c773a64e69fda85a94b724b0c62061ab3025eb'],
  ['brorand', '1.1.0', 'a263df31562d198f6bc8c85a843503e59c575768b4c0b61e8cbf9e63ee7b8cd9'],
  ['des.js', '1.1.0', 'f055e15cce42b8223cdc20216c17b05852fdd2b03e653746db2712b5393810c4'],
  ['elliptic', '6.6.1', 'd381c472c970268835de1517cfbabfb21338f254d3b9804def85c8f97a5fa052'],
  ['hash.js', '1.1.7', 'a263df31562d198f6bc8c85a843503e59c575768b4c0b61e8cbf9e63ee7b8cd9'],
  ['hmac-drbg', '1.0.1', '026ba1e70aaaff9c4e7a7e162160a562d2607be86899644858cb108fb914d506'],
  ['isarray', '1.0.0', '41199fc577f56d37d06db42992c3a89f669b3ea406da5699bb458bf5f7a0bb25', 'browserify-sign'],
  ['miller-rabin', '4.0.1', 'a263df31562d198f6bc8c85a843503e59c575768b4c0b61e8cbf9e63ee7b8cd9'],
  ['minimalistic-crypto-utils', '1.0.1', 'c6e1014325b62ec8dd40b2a32c27e00c04fff4600f74da76fba39b8c42bb92d7'],
];

module.exports = function createNotices(sourceRoot = path.join(__dirname, '..')) {
  const notices = [
    'Third-party README license sections\n',
    'The following supplied sections are preserved verbatim for the named package versions.\n',
    'This file supplements the other distributed notices and does not claim complete dependency or license coverage.\n',
  ];
  for (const [name, version, expectedHash, parent] of inputs) {
    const resolutionRoot = parent ? path.dirname(require.resolve(parent + '/package.json', { paths: [sourceRoot] })) : sourceRoot;
    const packagePath = require.resolve(name + '/package.json', { paths: [resolutionRoot] });
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (metadata.name !== name || metadata.version !== version) throw new Error('Notice source version changed: ' + name);
    const readme = fs.readFileSync(path.join(path.dirname(packagePath), 'README.md'), 'utf8');
    const headings = [...readme.matchAll(/^#{1,6}[ \t]+licen[sc]e[^\r\n]*\r?\n/gim)];
    if (headings.length !== 1) throw new Error('Ambiguous notice source: ' + name);
    const start = headings[0].index + headings[0][0].length;
    const next = /^#{1,6}[ \t]+/m.exec(readme.slice(start));
    const section = next ? readme.slice(start, start + next.index) : readme.slice(start);
    if (crypto.createHash('sha256').update(section).digest('hex') !== expectedHash) throw new Error('Complete notice source changed: ' + name);
    notices.push('\n----- ' + name + '@' + version + ' -----\n');
    notices.push('Supplied source: https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + version + '\n');
    notices.push(section);
  }
  return Buffer.from(notices.join(''), 'utf8');
};

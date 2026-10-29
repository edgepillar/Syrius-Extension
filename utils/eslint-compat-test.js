'use strict';

// Exercise the actual project config and installed plugins. Virtual source
// files keep these lint controls independent of wallets and filesystem writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '..');
const fixtures = [
  { name: 'valid JSX', code: 'import React from "react"; export default function Demo({ label }) { return <button type="button">{label}</button>; }' },
  { name: 'React state mutation', rule: 'react/no-direct-mutation-state', severity: 1,
    code: 'import React from "react"; export default class Demo extends React.Component { render() { this.state.count = 1; return <div />; } }' },
  { name: 'conditional hook', rule: 'react-hooks/rules-of-hooks', severity: 2,
    code: 'import { useState } from "react"; export default function Demo({ active }) { if (active) { useState(0); } return null; }' },
  { name: 'image accessibility', rule: 'jsx-a11y/alt-text', severity: 1,
    code: 'import React from "react"; export default function Demo() { return <img src="fixture.png" />; }' },
  { name: 'import placement', rule: 'import/first', severity: 2,
    code: 'const label = "fixture"; import React from "react"; export default function Demo() { return <div>{label}</div>; }' },
  { name: 'undefined variable', rule: 'no-undef', severity: 2,
    code: 'export default function Demo() { return missingFixtureValue; }' },
];

(async () => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.cjs') });
  for (const fixture of fixtures) {
    const [result] = await eslint.lintText(fixture.code, { filePath: path.join(root, 'src', 'eslint-compat-fixture.jsx') });
    assert.equal(result.fatalErrorCount, 0, fixture.name);
    if (!fixture.rule) {
      assert.deepEqual(result.messages, [], fixture.name);
    } else {
      assert(result.messages.some(message => message.ruleId === fixture.rule && message.severity === fixture.severity), fixture.name);
    }
  }
  console.log(JSON.stringify({ eslint_compatibility: true, eslint_version: ESLint.version,
    cases: fixtures.length, passed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });

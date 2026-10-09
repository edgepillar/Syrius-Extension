const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build-and-release.yml'), 'utf8');
const publication = workflow.split('      - name: Publish GitHub release assets\n')[1];
assert(publication, 'Publication step required');
const script = publication.split('        run: |\n')[1].split('\n')
  .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
assert(script.trim(), 'Actual publication shell required');

const run = ({ automatic = false, existing = false, creationFails = false, assets = 2 } = {}) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-release-assets-'));
  try {
    fs.mkdirSync(path.join(scratch, 'release-assets'));
    for (let index = 0; index < assets; index++) {
      fs.writeFileSync(path.join(scratch, 'release-assets', `fixture-${index}`), 'inert artifact\n');
    }
    const calls = path.join(scratch, 'calls');
    fs.writeFileSync(path.join(scratch, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> "$SYRIUS_TEST_CALLS"
if [ "$1 $2" = 'release view' ]; then [ "$SYRIUS_TEST_EXISTING" = true ]; exit $?; fi
if [ "$1 $2" = 'release create' ]; then [ "$SYRIUS_TEST_CREATION_FAILS" != true ]; exit $?; fi
exit 99
`, { mode: 0o700 });
    // macOS's Bash 3 lacks mapfile. This only adapts array input for the fixture;
    // every publication branch and GitHub invocation remains the workflow's.
    const compatibility = 'if ! type mapfile >/dev/null 2>&1; then mapfile() { assets=(); while IFS= read -r line; do assets+=("$line"); done; }; fi\n';
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', compatibility + script], {
      cwd: scratch,
      env: { ...process.env, PATH: scratch + path.delimiter + process.env.PATH,
        AUTO_RELEASE: String(automatic), TAG_NAME: 'v0.0.0', TARGET_SHA: 'inert-head',
        SYRIUS_TEST_EXISTING: String(existing), SYRIUS_TEST_CREATION_FAILS: String(creationFails),
        SYRIUS_TEST_CALLS: calls },
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

for (const automatic of [false, true]) {
  test(`${automatic ? 'main' : 'tag'} rerun refuses existing release without an upload or create`, () => {
    const result = run({ automatic, existing: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /already exists/);
    assert.deepEqual(result.calls, ['release view v0.0.0']);
  });
  test(`${automatic ? 'main' : 'tag'} new release uses the intended identity check`, () => {
    const result = run({ automatic });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 2);
    assert.match(result.calls[1], /^release create v0\.0\.0 release-assets\/fixture-0 release-assets\/fixture-1 /);
    assert.match(result.calls[1], automatic ? /--target inert-head/ : /--verify-tag/);
    assert.doesNotMatch(result.calls.join('\n'), /release upload|--clobber/);
  });
  test(`${automatic ? 'main' : 'tag'} create failure is propagated without upload fallback`, () => {
    const result = run({ automatic, creationFails: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 2);
    assert.doesNotMatch(result.calls.join('\n'), /release upload|--clobber/);
  });
}
for (const assets of [0, 1, 3]) {
  test(`invalid ${assets}-file package refuses publication before GitHub access`, () => {
    const result = run({ assets });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
}

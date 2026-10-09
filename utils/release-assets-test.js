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
const candidate = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);
const tag = sha => ({ name: 'v0.0.0', commit: { sha } });

const run = ({ automatic = false, existing = false, creationFails = false,
  assets = 2, pages = [[tag(candidate)]], apiFails = false, targetSha = candidate } = {}) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-release-assets-'));
  try {
    fs.mkdirSync(path.join(scratch, 'release-assets'));
    for (let index = 0; index < assets; index++) {
      fs.writeFileSync(path.join(scratch, 'release-assets', `fixture-${index}`), 'inert artifact\n');
    }
    const responses = path.join(scratch, 'responses');
    fs.mkdirSync(responses);
    pages.forEach((page, index) => fs.writeFileSync(path.join(responses, `${index}.json`), JSON.stringify(page)));
    const calls = path.join(scratch, 'calls');
    fs.writeFileSync(path.join(scratch, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> "$SYRIUS_TEST_CALLS"
if [ "$1 $2" = 'release view' ]; then [ "$SYRIUS_TEST_EXISTING" = true ]; exit $?; fi
if [ "$1 $2" = 'release create' ]; then [ "$SYRIUS_TEST_CREATION_FAILS" != true ]; exit $?; fi
if [ "$1" = api ]; then
  [ "$SYRIUS_TEST_API_FAILS" != true ] || exit 1
  shift
  paginate=false
  query=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --paginate) paginate=true ;;
      --jq) shift; query="$1" ;;
    esac
    shift
  done
  [ -n "$query" ] || exit 1
  index=0
  while [ "$index" -lt "$SYRIUS_TEST_PAGE_COUNT" ]; do
    jq -r "$query" "$SYRIUS_TEST_RESPONSES/$index.json" || exit 1
    index=$((index + 1))
    [ "$paginate" = true ] || break
  done
  exit 0
fi
exit 99
`, { mode: 0o700 });
    // macOS's Bash 3 lacks mapfile. This only adapts array input for the fixture;
    // publication branches remain the workflow's, and jq runs its actual query
    // over inert API pages without contacting GitHub.
    const compatibility = 'if ! type mapfile >/dev/null 2>&1; then mapfile() { assets=(); while IFS= read -r line; do assets+=("$line"); done; }; fi\n';
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', compatibility + script], {
      cwd: scratch,
      env: { ...process.env, PATH: scratch + path.delimiter + process.env.PATH,
        GH_REPO: 'fixture/extension', AUTO_RELEASE: String(automatic), TAG_NAME: 'v0.0.0', TARGET_SHA: targetSha,
        SYRIUS_TEST_EXISTING: String(existing), SYRIUS_TEST_CREATION_FAILS: String(creationFails),
        SYRIUS_TEST_API_FAILS: String(apiFails), SYRIUS_TEST_RESPONSES: responses,
        SYRIUS_TEST_PAGE_COUNT: String(pages.length), SYRIUS_TEST_CALLS: calls },
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};
const noPublication = result => {
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls.join('\n'), /release create|release upload|--clobber/);
};

for (const automatic of [false, true]) {
  const mode = automatic ? 'main' : 'tag';
  test(`${mode} rerun refuses existing release before the tag query`, () => {
    const result = run({ automatic, existing: true });
    noPublication(result);
    assert.match(result.stdout, /already exists/);
    assert.deepEqual(result.calls, ['release view v0.0.0']);
  });
  test(`${mode} same remote commit permits only the intended new release`, () => {
    const result = run({ automatic });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 3);
    assert.match(result.calls[1], /^api --paginate repos\/fixture\/extension\/tags\?per_page=100 --jq /);
    assert.match(result.calls[2], /^release create v0\.0\.0 release-assets\/fixture-0 release-assets\/fixture-1 /);
    assert.match(result.calls[2], automatic ? new RegExp(`--target ${candidate}`) : /--verify-tag/);
    assert.doesNotMatch(result.calls.join('\n'), /release upload|--clobber/);
  });
  test(`${mode} resolves the matching tag on a later API page`, () => {
    const result = run({ automatic, pages: [[{ name: 'unrelated', commit: { sha: otherCommit } }], [tag(candidate)]] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 3);
  });
  test(`${mode} rejects a remote tag at a different commit`, () => {
    const result = run({ automatic, pages: [[tag(otherCommit)]] });
    noPublication(result);
    assert.match(result.stdout, /does not uniquely match/);
  });
  test(`${mode} rejects duplicate matching tags across API pages`, () => {
    const result = run({ automatic, pages: [[tag(candidate)], [tag(candidate)]] });
    noPublication(result);
    assert.match(result.stdout, /does not uniquely match/);
  });
  test(`${mode} rejects a failed API request before creating a release`, () => {
    const result = run({ automatic, apiFails: true });
    noPublication(result);
    assert.match(result.stdout, /could not be checked safely/);
  });
  for (const [description, pages] of [
    ['non-array API response', [{}]],
    ['null tag entry', [[null]]],
    ['incomplete tag entry', [[{}]]],
    ['non-string tag name', [[{ name: 4, commit: { sha: candidate } }]]],
    ['empty tag name', [[{ name: '', commit: { sha: candidate } }]]],
    ['non-object commit', [[{ name: 'v0.0.0', commit: [] }]]],
    ['malformed unrelated tag', [[{ name: 'unrelated', commit: { sha: null } }, tag(candidate)]]],
    ['malformed later page after a match', [[tag(candidate)], [null]]],
    ['null commit', [[tag(null)]]],
    ['empty commit', [[tag('')]]],
    ['malformed commit', [[tag('invalid')]]],
    ['commit with trailing whitespace', [[tag(candidate + '\n')]]],
  ]) {
    test(`${mode} rejects ${description}`, () => {
      const result = run({ automatic, pages });
      noPublication(result);
      assert.match(result.stdout, /could not be checked safely/);
    });
  }
  test(`${mode} rejects an invalid candidate commit`, () => {
    const result = run({ automatic, targetSha: '' });
    noPublication(result);
    assert.match(result.stdout, /candidate commit is invalid/);
    assert.deepEqual(result.calls, ['release view v0.0.0']);
  });
  test(`${mode} create race or failure is propagated without upload fallback`, () => {
    const result = run({ automatic, creationFails: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 3);
    assert.doesNotMatch(result.calls.join('\n'), /release upload|--clobber/);
  });
}
test('main missing tag permits creation at the candidate commit', () => {
  const result = run({ automatic: true, pages: [[]] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls[2], new RegExp(`--target ${candidate}`));
});
test('tag missing remotely refuses publication', () => {
  const result = run({ pages: [[]] });
  noPublication(result);
  assert.match(result.stdout, /missing from the remote/);
});
for (const assets of [0, 1, 3]) {
  test(`invalid ${assets}-file package refuses publication before GitHub access`, () => {
    const result = run({ assets });
    noPublication(result);
    assert.deepEqual(result.calls, []);
  });
}

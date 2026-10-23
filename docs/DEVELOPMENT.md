# Development

Building, testing, the dev harness and releasing. First-time setup of the
checkout and the ABI sources is in [SETUP.md](SETUP.md).

```bash
npm ci --legacy-peer-deps
npm run build      # production build into build/
npm run lint

# Create a separate source-only checkout for the ABI checks.
git clone --no-checkout https://github.com/zenon-network/go-zenon.git ../go-zenon-abi
git -C ../go-zenon-abi checkout --detach 667a69d9e9a418edf7580b08492ba5dcb9efd63a
export GO_ZENON_ABI_DIR='../go-zenon-abi/vm/embedded/definition'
npm run test
node --test utils/validation-gates-test.js
npm run test:security
# Native browser checks use disposable profiles and synthetic fixtures.
# Set CHROMIUM_PATH to your current Chrome/Chromium executable when needed.
npm run test:browser
npm run prettier
```

`npm test` re-derives every embedded contract's method selectors from the Go
ABI definitions in `GO_ZENON_ABI_DIR`, or the legacy
`../go-zenon/vm/embedded/definition` directory when unset. It feeds synthetic
blocks through the decoder the wallet uses. It is the only check on the HTLC labels, since
`znn-ts-sdk` has no HTLC implementation to compare against. Missing or empty ABI
sources fail the check. Follow [SETUP.md](SETUP.md#2-install-and-build) to prepare
the source-only checkout at the same revision used by CI; no Go compiler or
running Zenon node is required.

`npm run test:browser` runs the native browser fixtures registered in
`package.json`, including the existing vault, request identity, approval queue
and document lifecycle checks. It uses `CHROMIUM_PATH`, or the existing macOS
Brave default when unset. CI discovers the runner's Chrome/Chromium executable
and fails if the browser is unavailable.
These fixtures do not exercise real wallet encryption or a live Zenon network.

What each browser fixture establishes: [testing/](testing/).

## Dev harness

`utils/dev-harness.js` runs the extension in a Chrome of its own — separate
profile, separate debugging port — with a wallet that unlocks itself, so a
screen can be opened and worked on without clicking through the splash, the
password and the menus every time. It defaults to the sibling go-zenon
checkout's devnet at `../go-zenon/docker/devnet` (`ws://localhost:35998`, chain 69)
and that repo's committed dev mnemonic, at address index 1.

```bash
npm run dev:start                     # build, launch Chrome, unlock, screenshot
npm run dev:reload                    # rebuild, reload the extension, screenshot
npm run dev:stop                      # close it again

node utils/dev-harness.js route tabs/settings/change-node
node utils/dev-harness.js shot --full --out node-settings.png
node utils/dev-harness.js click "text=Use chain 69"
node utils/dev-harness.js fill "input[name=chainIdField]" 3
node utils/dev-harness.js text .chain-id-card
node utils/dev-harness.js logs
```

Chrome stays up between commands, so each one lands on the screen the last one
left behind. Screenshots go to `.dev-harness/shots/`. The wallet it unlocks is
written to `.dev-harness/wallet.json` on first run — edit that file to point the
harness at a different mnemonic, node, chain or address index.

`node utils/dapp-test.js` drives a real web page against the injected provider
end to end — connect prompt, approval, reconnecting without a second prompt, and
a message signed through the approval window — against the Chrome the harness is
already running.

The same Chrome can drive any dApp and answer the wallet for it, one command at
a time, which is how a site's wallet integration gets tested against the real
extension rather than a stub:

```bash
node utils/dev-harness.js open http://127.0.0.1:4175/        # the page under test
node utils/dev-harness.js page click "text=Prove Zenon address"
node utils/dev-harness.js approvals                          # what is queued, oldest first
node utils/dev-harness.js approve --expect connect
node utils/dev-harness.js approve --expect signMessage
node utils/dev-harness.js page fill "#some-input" "a value"
node utils/dev-harness.js page shot --full --out page.png
node utils/dev-harness.js reject                             # answer the next one with no
```

`page` acts on the tab `open` last created, or on `--url <part of its
address>`. `approve` prints the approval screen verbatim before it presses
anything, waits for the wallet to let go of the request — a block may mine
plasma first — and fails if the wallet shows an error. It refuses to press
anything unless the wallet's node is on this machine and its chain is not
mainnet's, and `--expect <type>` makes it refuse a request of any other kind.
`page reload` is worth knowing beside `page goto`: on a single-page app an
address that differs only in its hash moves the router without reloading, so
anything the page read at startup stays on screen after it has changed.

Two sides of a trade need two wallets that cannot see each other, which means
two browsers. `--instance <name>` gives each its own profile, wallet, port and
screenshots, and `--address-index` at `start` is what makes the second one
somebody else:

```bash
node utils/dev-harness.js start --instance a --address-index 1
node utils/dev-harness.js start --instance b --address-index 2
node utils/dev-harness.js open --instance b http://127.0.0.1:4175/
node utils/dev-harness.js approve --instance b --expect signAndSendBlock
node utils/dev-harness.js stop --instance b
```

Within one wallet, the Change address screen at `tabs/change-address` switches
account without a second instance.

The auto-unlock only exists in builds made by the harness: it needs
`SYRIUS_DEV_WALLET=true`, which nothing else sets, it refuses to run in a
production build, and even then it does nothing until the harness leaves a
wallet in the browser's own storage. Nothing about it is compiled into
`npm run build`.

### A chain to send to

Harnessed runs that send a block use the lab, a go-zenon devnet of this
repo's own, and never a shared network:
[tools/devnet/lab](../tools/devnet/lab/README.md).

## Releasing

`.github/workflows/build-and-release.yml` validates every pull request and push
to the development branches. A release run (a `v*` tag, or a push to `main`)
creates the release with the Chrome/Brave ZIP. Each other platform builds and
adds its own files in jobs of its own, so one that fails does not hold back the
rest: the unsigned iOS IPA (macOS runner), the Android APK signed with the
project's key, and the Firefox XPI, which addons.mozilla.org signs (unlisted),
with `updates.json` for Firefox's own updater. If signing fails, the release
gets the unsigned XPI instead, without `updates.json`, and the run carries a
warning; attach the signed one later by hand. Every file has a SHA-256
checksum beside it. Android and Firefox need the repository's `ANDROID_*` and
`WEB_EXT_*` secrets, and sign only on a release run: Mozilla signs a version
once. To add a platform to a release published without it, run the workflow by
hand with `attach_to` set to its tag and `platforms` set to that platform. Bump
`src/manifest.json`, `package.json` and `package-lock.json` together before
merging a release. To use the tag-triggered path manually instead of the
automatic `main` release:

```bash
release_version="$(node -p "require('./src/manifest.json').version")" &&
  git tag "v${release_version}" &&
  git push origin "v${release_version}"
```

The normal `main` workflow creates the tag itself. The workflow does not
require a CRX private key: Chrome and Brave load the published ZIP as an
unpacked extension.

The checklist for a release candidate is [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

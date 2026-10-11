# Syrius Extension setup

This guide covers building and loading the Manifest V3 extension in Chrome,
Brave and other Chromium-based browsers on Windows.

## 1. Required runtime

Install Node.js 24.x. The repository pins the major version in .nvmrc and
expects npm 10 or newer:

~~~powershell
& 'C:\Program Files\nodejs\node.exe' --version
& 'C:\Program Files\nodejs\npm.cmd' --version
~~~

Run all commands from the repository root. Do not use a second Node.js
installation for this project.

## 2. Install and build

~~~powershell
git clone https://github.com/sol-znn/syrius-extension.git
Set-Location syrius-extension
& 'C:\Program Files\nodejs\npm.cmd' ci --legacy-peer-deps
& 'C:\Program Files\nodejs\npm.cmd' run lint

# Create a separate source-only checkout for the embedded ABI comparator.
git clone --no-checkout https://github.com/zenon-network/go-zenon.git ../go-zenon-abi
git -C ../go-zenon-abi checkout --detach 667a69d9e9a418edf7580b08492ba5dcb9efd63a
$env:GO_ZENON_ABI_DIR = '../go-zenon-abi/vm/embedded/definition'

& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\node.exe' --test utils/validation-gates-test.js
& 'C:\Program Files\nodejs\npm.cmd' run test:security
& 'C:\Program Files\nodejs\npm.cmd' run build
~~~

The generated production extension is in the build directory. The browser
loads the generated files, not the source directory.

The ABI comparator requires go-zenon's source definitions and fails when they
are missing or contain no ABI functions. It needs no Go compiler or running
Zenon node. CI checks out the revision above with a sparse checkout; local tests use
GO_ZENON_ABI_DIR, or the legacy ../go-zenon/vm/embedded/definition location when
the variable is unset. Changing this pinned reference requires reviewing the
decoder against the new protocol definitions.

## 3. Load in Chrome or Brave

1. Open chrome://extensions/ in Chrome or brave://extensions/ in Brave.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's build directory.
5. Open the Syrius popup and create or unlock the local wallet.

Other Chromium-based browsers use the same procedure with their own extensions
page URL.

## 4. GitHub Actions package and release

The workflow in .github/workflows/build-and-release.yml uses .nvmrc, installs
the lockfile with npm ci --legacy-peer-deps, runs the audit, lint and
regression checks, and creates a Chrome/Brave-ready ZIP with a SHA-256
checksum. The workflow artifact is the ZIP itself, without a second artifact
archive; the checksum is attached to the GitHub Release.

CI also runs the native browser fixtures registered in package.json with its
installed Chrome or Chromium. Locally, set CHROMIUM_PATH to your browser executable
and run npm run test:browser. These checks use disposable profiles and synthetic data;
they do not contact a Zenon network or qualify real wallet encryption.

Download the ZIP and its .sha256 file into the same directory. On systems with
GNU coreutils, run `sha256sum --check syrius-extension-0.3.4-chrome-brave.zip.sha256`
there. The checksum records the ZIP's basename, so it does not depend on a CI
workspace directory.

The current source version is 0.3.4. A push to `main` automatically creates
the matching `v0.3.4` tag and publishes the ZIP assets to a GitHub Release.
Pushes to `master`, `development` and `manifest-v3` only create validation artifacts.

For a manual tag-triggered release instead of the automatic `main` release:

~~~powershell
git tag v0.3.4
git push origin v0.3.4
~~~

No custom repository variables or secrets are required. The release job uses
GitHub's built-in GITHUB_TOKEN. Repository settings must allow workflows to
request read/write permissions for the release job.

The workflow intentionally publishes a ZIP rather than a CRX. Load the ZIP's
extracted directory with **Load unpacked**. A CRX signing key is not required
and should not be introduced without a deliberate extension-ID/key-management
plan.

## 5. Session, auto-lock and balance privacy

The default timed session can be restored after closing the popup until its
15-minute inactivity deadline. Change the period under **Settings → Auto-lock**.
The **On close** option belongs to the unlocking window and cannot be restored
by another window. Locking revokes the session's authority and clears its saved
unlock record; the encrypted wallet remains in extension storage.

Use the eye button on the dashboard to hide or show balance amounts. Hidden
amounts are displayed as *** and the preference is stored locally.

## 6. Nodes and Chain ID

Use **Settings → Node management** to select a reachable WebSocket endpoint or
add a custom node. The Chain ID must match the network the node serves. The
pinned SDK defaults to Chain ID 1; the local development harness uses 69.
Confirm any testnet identifier with that network's operator rather than
reusing the mainnet or development value.

The default node list is defined in src/services/utils/storage.js and the
currently selected URL is shown in Settings. An endpoint being listed does
not establish its availability, network identity or trustworthiness. A successful
WebSocket connection does not authenticate the chain. Verify both the endpoint
and Chain ID before signing.

## 7. Bridge testing

Test with an isolated staging or testnet setup first. The manifest injects the
provider into HTTP and HTTPS pages, including frames. Access to wallet data and
signing is controlled by the extension's origin and account permissions and
individual approval requests. Refresh the page after reloading the extension.

For every signing request, verify the origin, destination, token, exact amount,
node and Chain ID in the approval screen before approving.

## 8. Troubleshooting

### The extension does not appear on a bridge page

The provider is injected into HTTP and HTTPS pages. HTTPS and HTTP are different
permission origins. Rebuild, reload the extension, refresh the page, and check
Settings → Connected sites for the current origin and wallet account.

### The popup or service worker reports an error

Open the extension's service-worker inspector from the extensions page. Do not
use browser flags such as --disable-ipc-flooding-protection; they hide the
symptom and weaken the browser's protection. Rebuild and reload the unpacked
extension after correcting the source.

### The bridge does not receive a result

Keep the originating bridge tab open while approving. Reloading or closing that
tab cancels the temporary integration context. Check Settings → Connected sites
and revoke/reconnect the origin if necessary.

### A node connection fails

Confirm that the endpoint is reachable and has the correct Chain ID. Prefer
wss:// for remote endpoints; the local development harness uses ws://localhost.
A local endpoint only works when a compatible local node is running. Connection
success does not independently verify the network's identity.

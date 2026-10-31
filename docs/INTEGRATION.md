# Integrating a site

The extension injects `window.zenon` into every page, before the page's own
scripts run. It exposes nothing about the wallet until the person approves the
origin, and it never signs anything without asking.

A page that was already open when the extension was installed gets
`window.zenon` then, without a reload, in Chrome and Brave (0.3.7 and later)
and in Firefox. `zenon#initialized` fires when it arrives. A site that decided
"not installed" at load should look again when that event fires, or when the
person clicks Connect, rather than telling them to install it.

The Android app has no `window.zenon`; a page or app there asks with a
`syrius://request` link and gets the answer at a callback URL
([Requests from another app](APP-REQUESTS.md)).

```js
// The provider is injected at document_start, but a script that runs even
// earlier can wait for it.
const zenon = window.zenon ?? (await new Promise((resolve) =>
  window.addEventListener('zenon#initialized', () => resolve(window.zenon), { once: true })
));

// Read-only, never prompts. Empty until this origin is connected.
await zenon.getAccounts();   // [] | ['z1q…']
await zenon.getChainId();    // null until connected/unlocked; 1 for mainnet
await zenon.getNodeUrl();    // null | ws(s)://host[:port], without private endpoint details

// Opens the connect prompt. Resolves immediately for an origin already
// connected; rejects with {code: 4001} if the person declines.
const [address] = await zenon.connect();

// A transfer. `amount` is in the token's smallest unit.
const { hash } = await zenon.sendTransaction({
  to: 'z1q…',
  tokenStandard: 'zts1znnxxxxxxxxxxxxx9z4ulx',
  amount: '100000000',                    // 1 ZNN
});

// An arbitrary account block, including contract calls. Shown in full before
// anything is signed.
await zenon.sendAccountBlock(block);

// A signature over a message, for a login challenge or a proof of ownership.
// Prompted every time; nothing is broadcast and nothing is spent.
const { publicKey, signature } = await zenon.signMessage(
  `Sign in to example.com at ${new Date().toISOString()}`
);

zenon.on('accountsChanged', (accounts) => {});
zenon.on('chainChanged', (chainId) => {});
zenon.on('nodeChanged', (nodeUrl) => {});

await zenon.disconnect();
```

Chain and node reads are unprompted and return `null` until the origin is
connected and the wallet is unlocked. Node reads, node-change events and legacy
grant fields expose only the WebSocket scheme, host and nondefault port. URL
credentials, paths, query strings and fragments remain private. This public
descriptor may not be a usable connection endpoint; the wallet keeps the full
configured URL for its own SDK connection and reconnect fallback.

Failed disconnections remain visible in Connected Sites for retry. Treat an
error as incomplete and retry until the site is removed. A saved session denial
blocks access while a failed durable removal is pending; it is not a substitute
for completing that removal before restarting the browser.

Errors follow EIP-1193 numbering: `4001` the person declined, `4100` the origin
is not connected, `4200` unknown method, `4900` the wallet is locked, `-32602`
the parameters were malformed.

### Verifying a signature

`signMessage` is desktop Syrius' `znn_sign` under another name — it signs the
message bytes directly with the account's Ed25519 key and answers with the
signature and public key as hex, so one verifier covers both wallets. The
`address` field is a convenience — it is derived from the same public key, and
a verifier that cares should re-derive it rather than take it on trust:

```js
const bytes = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));

const ok = await crypto.subtle.verify(
  'Ed25519',
  await crypto.subtle.importKey('raw', bytes(publicKey), 'Ed25519', false, ['verify']),
  bytes(signature),
  new TextEncoder().encode(message)
);
```

Two things worth knowing:

- The message is encoded as **UTF-8**. Desktop passes UTF-16 code units narrowed
  to bytes, which agrees for ASCII — what a login challenge is made of — and
  differs for anything else.
- A message whose UTF-8 encoding is **exactly 32 bytes** is refused. That is the
  size of an account block hash, and signing raw bytes of that length would let
  a site have a transaction signed by calling it a message. Pad the challenge to
  any other length.

The flat `window.postMessage({method: 'znn.requestWalletAccess'})` protocol the
2023 build used is still relayed, so sites written against it keep working.

## Request limits

Approval requests expire 30 minutes after admission; another request never renews that deadline. The queue holds at most 16 pending requests globally, two per origin, four per tab and one pending connection request per origin. Requests must fit 128 KiB of UTF-8 JSON including their queue metadata, depth 32 and 20,000 values. Correlation IDs are finite numbers or nonempty strings up to 128 characters; site titles are limited to 1,024 characters and favicon URLs to 4,096. Supported 16 KiB calldata in Base64, byte-array and Buffer-JSON forms remains accepted. Inputs exceeding a limit are rejected without truncation.

Closing the approval window does not answer a request (0.3.9 and later). It stays pending, and counts toward these limits, until the person approves or rejects it, its page leaves, or it expires; the wallet shows it on the toolbar badge and can reopen it. Only `4001` means the person declined.

Capacity/attention limits return retryable code `-32005`; invalid or oversized requests use `-32602`. An invalid correlation ID is not echoed. Unapproved expiry returns `-32006`. If processing has already begun, expiry or closure reports unknown outcome: check the result before retrying, since an already-started publication cannot be recalled. Provider and legacy transport fallbacks settle missing replies after 31 minutes with the same caution.

A new approval window is limited to one per five seconds globally, one per 10 seconds per origin and one per 10 seconds per tab, so a page that frames several origins is held to the same pace as one origin. Existing windows are reused without refocusing. A successful human approval permits that origin, and that tab, one follow-up opening within 10 seconds, including connect-then-sign after the empty-window grace; rejection does not grant that allowance. These decisions survive worker restarts within the browser session. At most 32 provider handlers/transports are active at each boundary. Chrome necessarily decodes messages before these checks, so these are wallet admission bounds, not a general browser traffic guarantee.

Chrome 112 is required for the 10 MB session-storage quota. Sending and receiving after the popup closes needs Chrome 113, where an offscreen document may run workers; on 112 the popup does that work while it is open. JSON size is not Chrome's exact memory accounting; native quota/storage failures remain errors and never authorize signing. Expired requests are pruned on queue access and the worker alarm. Old unversioned queue entries require a fresh request after an extension update. Queue deadlines, claim ownership and key/publication checks fail closed; the wallet's other session and document-lifetime policies still apply independently.

Approval preparation and submission use at most two operation slots per popup. Each node RPC has a native client cleanup timeout of at most 10 seconds, shortened by the approval deadline. Canceled operations keep their slot until outstanding native RPC promises settle. The automatic block preview is canceled when its view is replaced or submission begins. Approval proof of work uses a static, operation-owned worker terminated on completion, cancellation, error or expiry. A submitted transaction whose response is lost has an unknown outcome; check the ledger before retrying.

Permission finalization first saves a durably inactive pending record, preserving prior consent. The exact isolated relay must accept the connection response before the fixed deadline; its timestamp marks completion of that consent decision. Durable promotion may finish after the acknowledgement, while immediate follow-up reads wait on the permission lock. A failed promotion leaves the pending record inactive and requires reconnecting, even if the reply already reached the page. Pending records remain inactive after a browser restart even if rollback fails and all session state is lost. The relay timestamp also distinguishes an accepted response from a late response when the page event queue runs later.

Requests are bound to the document that made them, and any cross-document navigation cancels them, even one that never commits. Provider events are bound to the document alone: a page whose navigation is aborted (a 204 response, a download) keeps receiving them. A page Chrome prerenders (address-bar prediction, speculation rules) sends nothing until it is shown, and its load-time reads are answered then. The `webNavigation` permission behind the navigation fence is shown on the install prompt as "Read your browsing history".

## Wallet and account consent

Site connections are stored per origin, exact wallet import, and exact derived
account. The first derived address identifies the seed; the stored wallet name
separates duplicate imports. Reusing a name for another seed never transfers
consent. Older origin-only connections require reconnection. Switching A → B → A
restores A's saved consent, but never revives an approval shown before a switch.
The approval screen shows the wallet, account number, and full address. Signing
and publication check that same selection and use its explicit address index.

On close keeps public reads empty and stores no resumable entropy. A connected
site may queue a request for the known account and wait for that account's next
immediate unlock; an unknown or changed account is refused. Once displayed, the
request cannot rebind. Timed session reopening preserves the selection identity.
Connected sites lists each wallet/account grant; its Disconnect all button covers
all wallets and accounts. Removing a wallet withdraws its consent and queued
approvals before deleting the local keystore. Duplicate imports remain separate.

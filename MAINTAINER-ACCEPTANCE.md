# Maintainer acceptance handoff

Status: review preparation, 9 October 2026. This document records unresolved decisions; no maintainer approval, production architecture selection, merge or release is implied.

Target: `sol-znn/syrius-extension`, master `247f02517f67f60ec7d42e1f46b99598b28d9e0e`. The fourteen focused contributions are drafts: #14, #15, #17, #18 and #20 through #29. The latest completed combined hosted qualification is source `208bc0b901692b225a081b6830012c29382d8b6d`. This continuation preserves additional supplied README notices and keeps approval actions in normal flow so they cannot cover preview text. Requalify the resulting exact head; prior hosted results do not attest a subsequent head.

## Review and integration

Repository maintainers need to authorize the target workflows and review the exact PR heads. `action_required` is approval pending, not a passing or failing test. [Own-fork qualification](https://github.com/edgepillar/Syrius-Extension/actions/runs/37942750666) is bounded evidence for its tested source and cannot replace target approval.

The integration must preserve these five shared files:

| File | Contributions | Acceptance requirement |
| --- | --- | --- |
| `package.json` | #14, #17, #20, #21, #22, #23, #27, #28 | Preserve dependency/toolchain changes, twenty security commands and six browser commands. |
| `webpack.config.js` | #17, #29 | Preserve tooling corrections and project/SDK/Argon2/supplementary notice packaging. |
| `src/components/modals/alert-modal.js` | #21, #28 | Preserve transaction-network presentation, dismissal-first focus and bounded dialog layout. |
| `src/sections/Popup/Popup.scss` | #21, #26 | Preserve responsive review controls and reduced-motion behavior. |
| `src/pages/settings/change-node/change-node.js` | #20, #22 | Preserve read-context invalidation and exact chain-identifier validation. |

Requalify the resulting combined head. The own-fork workflow's additional lifecycle/minimum-runtime jobs are qualification instrumentation; their success does not automatically add those gates to the target workflow.

## Issue #19: decisions required before implementation

[Issue #19](https://github.com/sol-znn/syrius-extension/issues/19) coordinates durable transaction outcomes, common account sequencing and shared wallet writers. The current contribution batch does not implement these mechanisms. The following fields should be recorded with an accountable owner and an explicit acceptance contract before selecting real adapters.

| Decision | Required owner | Question to settle |
| --- | --- | --- |
| Account/network conflict scope | Wallet, SDK and security | Which authenticated profile/account identities share ownership? What happens when endpoints, aliases or the selected profile change? |
| Authority | Wallet and security | At which atomic boundaries are current vault lease, consent, request/document identity, selection and reviewed-block identity checked? Recovery must not itself grant signing authority. |
| Durable record and barriers | Wallet and storage | What minimum record survives each acknowledged boundary, using which atomicity and crash-durability guarantees? How are malformed records and ambiguous acknowledgements handled? |
| Original-outcome reconciliation | Wallet, SDK and protocol | Which evidence identifies the original signed operation? Which user-visible states and successor-admission rules are justified? Node acceptance or observation is not authenticated finality. |
| Confidentiality and retention | Wallet and security | What is stored, who may decrypt it, how long is it retained, and what may diagnostics expose? Addresses and hashes can also identify users. |
| Lifecycle and migration | Wallet and storage | What happens on restart, restored backup, password rotation, removal, schema migration and stale ownership? |
| Shared writers | Wallet and storage | What prevents stale writes, entry-identity reuse and silent clobber across documents? What proves current state separately from historical write acknowledgement? |
| Review and support | Repository and browser | Who reviews each adapter and owns interruption tests, supported runtimes, upgrade consent and performance budgets? |

Local acceptance preparation used an in-memory model and an independent prefix checker with opaque labels only. The measured finite exploration covers 11,088 transaction schedules, 280 writer schedules, eighteen explicit positive scenarios including seven interruption cuts, and thirty expected-code negative controls. It makes no SDK, signing, publication, storage or network calls. Its acknowledgements, authority issuance and scope equivalence are assumptions. It proves neither production recovery nor liveness, finality or real browser durability; no retry, re-signing or reservation-release policy is selected.

The review sequence is: settle owner decisions; independently review a separately scoped adapter design; verify actual durable and authority boundaries offline; qualify native interruption at the resulting exact head; then consider a separately authorized disposable-chain environment. An unanswered proposal is not agreement.

## Release and support gates

Additional local evidence narrows boundaries without closing their owner gates. Five offline production-provider/native-window cases passed on the earlier `62d9bfc` package, including native connect/sign with independently verified Ed25519 output. The after-claim interruption deliberately held a real browser API callback before cryptographic continuation; it did not test transaction publication. Four real-provider keyboard/accessibility cases passed on the subsequent working-tree candidate at actual 100%/200% browser zoom, including final message-glyph visibility and safe rejection. Structural accessibility-tree evidence is separate from screen-reader speech.

The pinned SDK's shipped Node keyfile paths failed compatibility probes. A four-line, unapplied source candidate now passes strict source checks and both Node/browser builds using the SDK's own locked development tools. Its rebuilt explicit Node bundle passes nineteen checks on macOS arm64 with the unchanged extension Argon2 0.45.1 external. This does not qualify the SDK's legacy native dependency, browser distribution interoperability, default export selection, a corrected SDK release or a support matrix. No installer, preparation script or dependency upgrade was run.

The notice-only combined build preserves all sixty-one preceding package members byte for byte and adds complete supplied README sections for nine attributable package versions. Reviewed versions and full-section hashes fail closed on drift; five negative controls pass. Packaging does not alter runtime bytes or dependencies. This is a bounded omission correction, not complete embedded/compiler attribution or legal coverage.

| Gate | Owner | Required evidence |
| --- | --- | --- |
| Private disclosure | Security | An accepted private reporting destination and accountable response owner. Sensitive findings remain private. |
| Repository and release policy | Repository and release | Required reviews/checks and protected release refs. Preflight tag identity does not prevent later tag movement. Immutable-release settings must be verified by an authorized owner. |
| Distribution identity | Release and distribution | Stable signed extension identity/channel, exact-head artifact provenance, actual store/CRX install and upgrade behavior, and permission consent. ZIP qualification is not signed distribution attestation. |
| Dependency compatibility | SDK | A compatibility-qualified migration/exposure decision for the pinned crypto dependency graph. A moderate-threshold audit pass does not settle low-severity advisories or embedded-code reachability. |
| Notices | SDK and distribution | Attributable prebundled JS/WASM provenance, supplied notice preservation and reconciliation of SDK ISC metadata with its supplied MIT license. |
| Browser and accessibility support | Browser and accessibility | Actual minimum Google Chrome, supported-device budgets, provider/native interruption and assistive technology. Chromium qualification is a separate distribution boundary. |
| Protocol qualification | Protocol and test-environment | Agreed trust/finality criteria and a separately authorized disposable environment after prior gates pass. |

GO for focused review and target workflow authorization. Release and real-wallet readiness remain NO-GO while these gates are open. This handoff contains no wallet material, credentials, private diagnostics or reproduction payloads.

# Release qualification checklist

This is a proposed maintainer review checklist. It does not enable repository
protection, appoint reviewers, approve transaction semantics or attest a release.

## Exact candidate and distribution

- Record the target commit and all incorporated contribution heads. Resolve test
  registrations without dropping existing suites, then run checks at that exact
  integrated commit. A passing personal-fork run is supplementary evidence.
- Approve and run target-repository workflows. Require independent review for
  wallet/session, provider/approval, SDK/storage and release changes. Configure
  branch and tag protections and required checks in the repository settings.
- Use a new version for different published bytes. The workflow refuses an
  existing release; repository-enforced tag/release immutability and artifact
  attestation require separate maintainer configuration.
- Inspect the final ZIP, manifest references, project license and third-party
  notices. Retain the checksum and build/source metadata. A checksum alone does
  not authenticate the distributor or prove reproducibility.

## Browser and wallet behavior

- Run the documented native browser fixtures and, after incorporating the
  production lifecycle test, its full matrix against the actual package.
  Use disposable profiles and generated wallets without node, funds or payments.
- Test the declared minimum Chrome version and supported Brave versions. Record
  the actual executable versions; do not infer support from a newer Chromium.
- Qualify cold start, native toolbar popup closure, lock/expiry, password change,
  recovery and removal. Test keyboard navigation and short windows with visible
  progress and complete approval details.
- Test a published previous version to the candidate under the intended
  installation channel. Unpacked re-registration does not qualify store/CRX
  identity, update delivery or permission consent. Review permission changes and
  document their purpose before distribution.
- Keep browser WASM, native library execution, SDK native keyfile support and
  independent reference checks as separate results. Measure startup, KDF/PoW
  responsiveness and memory on the supported browsers before choosing a budget.

## Transaction, storage and privacy decisions

- Settle the ownership and acceptance decisions in [issue #19](https://github.com/sol-znn/syrius-extension/issues/19)
  before implementing durable transaction recovery or shared account sequencing.
  Define uncertain outcomes, original-hash reconciliation, endpoint identity,
  encrypted record retention, migration, password rotation and wallet removal.
- Agree a common storage writer protocol for create/import/change/remove,
  including collision/revision checks and post-write verification. Display-cache
  generations and pending history rows do not provide these guarantees.
- Qualify interruption, stale owners and competing operations offline first.
  Any disposable-devnet or live-chain run needs its own environment and scope;
  browser UI success does not establish settlement or finality.
- Review price-feed/favicon behavior, permissions and retention statements.
  Establish and publish an operational private vulnerability reporting channel;
  do not substitute a public issue for confidential disclosure.

For each gate, record an owner, the exact evidence and a pass, failure or pending
decision. Do not mark a pending external approval or an unexecuted test as passed.

# Supplied README notice preservation

The production build adds `third-party-readme-notices.txt`, preserving complete
supplied README license sections for nine included package versions. Existing
project, SDK, Argon2-wrapper and compiler-extracted notices remain separate.
This addition does not claim complete dependency or legal coverage.

Run the bounded controls manually on Node 24 or newer:

```sh
node utils/third-party-readme-notices-test.js
npm run build
```

The positive control reproduces the real generated asset from disposable local
package directories. Five negative controls require failure for a missing
README, changed package version, duplicate/missing license heading, and changed
permission notice. They retain complete supplied text, use no wallet or native
cryptographic fixture, install no dependency, make no registry request, and
remove owned temporary directories. The build itself enforces reviewed package
versions and exact full-section SHA-256 hashes. Source or notice drift requires
review and fails the build rather than silently dropping text.

The preserved versions are `asn1.js@4.10.1`, `brorand@1.1.0`, `des.js@1.1.0`,
`elliptic@6.6.1`, `hash.js@1.1.7`, `hmac-drbg@1.0.1`, `isarray@1.0.0`,
`miller-rabin@4.0.1` and `minimalistic-crypto-utils@1.0.1`. Some supplied sections
have identical bytes; each named package remains attributable. The qualified
`isarray@1.0.0` is resolved from `browserify-sign`'s dependency context rather
than the root's separately installed version. Both included `1.0.0` instances
have the same source and supplied notice; the root `2.0.5` is not substituted.

Inspect the generated asset and final ZIP. Verify that all nine sections match
their supplied sources byte-for-byte and that existing output members remain
unchanged. The local qualification for the source on which this addition was
prepared reproduced all sixty-one prior members; the sole extra member was the
notice. This is a packaging check, not new browser, native SDK, release-channel
or live-chain qualification. No package manifest or workflow hook is changed by
this contribution.

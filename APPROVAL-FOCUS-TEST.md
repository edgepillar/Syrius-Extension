# Native approval review qualification

Run `node utils/approval-focus-browser-test.js` with Node 24 and a Chromium-family browser supporting the DevTools `Extensions.loadUnpacked` command. Set `CHROMIUM_PATH` to its executable when it is not the default Brave location.

The optional fixture compiles the actual approval screen, amount/network/argument presentation components, approval identity helpers and stylesheet under the product's MV3 CSP. Queue messages, storage-change events, wallet state, SDK calls, transaction preparation/decoding and signing boundaries are inert. It does not load a wallet or connect to a node. The disposable browser profile is removed before a successful result is reported.

Native checks cover initial review focus, same-type replacement through the actual storage-change callback, natural expiry with a queued replacement, disappearance/reappearance, unchanged-request focus and scroll retention, accessible region naming, disabled preparation, Enter without approval from the review region, and the Reject callback. All four approval types are exercised with long origin/details at 360×400, 280×400 and 180×300 CSS-pixel viewports, including keyboard scrolling to the final details, visible actions and unchanged standard toolbar-popup dimensions.

For a negative control, run the same fixture in an otherwise identical checkout containing the baseline approval screen and stylesheet with `--expect-baseline`. It verifies retained authorization-button focus after replacement and fixed-width clipping. The fixture does not modify source files.

This is an isolated extension-page test, not a real wallet or native approval-window lifecycle qualification. Reduced viewport dimensions approximate the layout space available under zoom; actual browser/OS zoom, screen-reader speech and navigation, assistive devices, and minimum supported browsers require separate qualification. Package scripts, dependency identities and target workflows are unchanged.

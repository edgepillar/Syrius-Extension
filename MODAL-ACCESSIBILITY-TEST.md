# Native modal focus qualification

The modal regression runs as part of `npm run test:browser`, after the four existing browser regressions. Run `node utils/modal-focus-browser-test.js` for a targeted check with Node 24 and an installed Chromium-family browser. Set `CHROMIUM_PATH` to the browser executable when it is not the default Brave location. The browser must support the DevTools `Extensions.loadUnpacked` command.

The fixture compiles the current modal, alert, context and modal state hook under the product's MV3 content security policy. It uses inert callback counters, the current popup stylesheet and a disposable profile that is removed on completion. It does not load a wallet, SDK, real account or network endpoint.

Coverage includes safe initial focus, native Tab/ShiftTab containment, redirected background focus, accessible dialog naming, Escape/backdrop and Close/Cancel/Confirm callback counts, content replacement, no usable controls, disabled/hidden/inert controls, detached triggers and unmount restoration. A simple confirmation is checked at a 360 by 400 viewport. Long dialogs are checked at 360 by 400 and 320 by 184: the header Close button stays visible, the dialog stays within the viewport, and native Tab/ShiftTab scrolls Cancel and Confirm into the bounded body. These dimensions use viewport emulation, not browser or OS zoom. This is an extension-page fixture, not a native toolbar popup, production approval-window lifecycle or screen-reader speech qualification.

For a negative control, run the same test from an otherwise identical checkout containing the baseline modal and alert components with `--expect-baseline`. This mode checks the missing initial focus, escaped Tab focus and absent dialog name. It does not change source files itself.

For the height/scroll regression, use `--expect-scroll-baseline` with the prior focus-correct modal and alert sources. It checks that a long dialog extends beyond the 320 by 184 viewport and its body has no scroll containment. The normal test must fail on those prior sources and pass after the layout correction. This mode also leaves source files unchanged.

The fixture requires the existing webpack, Babel and Sass dependencies. Suite registration preserves the four existing browser commands and appends the modal regression. Dependencies and target CI workflows are unchanged. Registering the command does not establish hosted CI or complete production-package qualification.

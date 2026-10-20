# NEXUS iOS Slate branding — readiness report

October 20, 2026. Repository: ScienceByHugs/Nexus. Baseline: `6add5ed00a71eca89f9486a2afed0cef19fab896`.

## Decision

Ready for visual/code review; **not yet cleared for TestFlight submission**. No merge, deployment, App Store Connect changes or upload was performed.

## Source of truth and scope

Inspected the existing Capacitor iOS wrapper, runtime stylesheet cascade, native asset catalog, launch storyboard, contributor instructions and the canonical `brand/` portfolio. The referenced Nexus Core Development conversation contains no usable design specification beyond the request; its assistant messages are opaque reference markers. The repository portfolio is the substantive authority, with its approval ledger preserved.

Implemented approved A02 Slate colors (#222629 background, #303639 surfaces, #F0F1EF primary text, #A8B0B2 secondary text, #171A1C navigation), A03 flat styling/porcelain actions, and the approved `n.` symbol. Generated color variables reject unapproved color tokens. The existing system-font fallback and type scale are used; proposed P03 sizes/weights, P04 measurements and P06 cinematic motion were not promoted to approved tokens. NEXUS is plain text with the parent endorsement; P01 permanent wordmark punctuation remains unresolved.

Migrated home, catalog, product, authentication, account, cart, membership, referrals, support, policies, profile and biometric styling. Navigation destinations, handlers, authentication, checkout, integrations, safe-area calculations and staging identity are preserved. Existing provider buttons keep their own artwork. The final stylesheet retires the visual cascade while retaining the earlier files' layout rules; this is intentionally a scoped migration rather than a risky layout rewrite.

The iOS icon and launch raster exports derive directly from the approved vector, with an opaque icon background. Launch uses a centered static symbol on Slate. No cinematic vial was fabricated. Existing catalog/packaging images remain unchanged and are **not certified** against real packaging by this work.

## Verification

- TypeScript/Vite staging build: passed.
- Capacitor iOS synchronization: passed.
- Staging isolation/configuration check: passed.
- iOS Debug simulator build (Xcode, iOS 27 SDK, iPhone 18 Pro): passed with signing disabled. Installed and launched locally; the actual native research-access entry screen was visually inspected. Launch-asset preview is an export proof, not a timed screenshot of the native launch transition.
- Automated preview checks: 11 major screens at 320, 393 and 768 CSS pixels; correct Slate background, no horizontal overflow, no browser script errors.
- Screenshots reviewed for palette, primary action contrast, provider button preservation and layout. Web screenshots use the existing offline design fixture with fictional data, not authenticated live sessions.
- Unit suite: 61/64 pass. Unchanged main produces the identical three Apple-onboarding failures because `../backend/supabase/functions/complete-apple-profile/index.ts` is absent. This is a pre-existing checkout/test-fixture issue, not a passing suite.
- Diff whitespace checks: passed.

## Before TestFlight

1. Review this branding PR and outstanding brand choices with the owner. Approve platform artwork on devices, including home-screen icon and launch transition.
2. Restore the missing backend test fixture or make the existing suite repository-self-contained; rerun all 64 tests.
3. Run signed physical-device smoke tests: Apple/email auth and recovery, keyboard and safe areas, cart/checkout and payments in staging, profile/photo editing, biometric lock, push, offline launch, text scaling, VoiceOver and reduced motion. Preview checks do not prove these integrations.
4. Verify packaging imagery against the approved SKU reference pack before treating it as final NEXUS 2.0 product art.
5. Select an unused build number. The repository remains **2.0.0 (9)** and `com.sciencebyhugs.nexus.staging`; earlier work records build 9 uploaded. This report does not re-verify App Store Connect state.
6. After separate release approval, create/validate a signed Release archive, confirm entitlements, provisioning, privacy metadata and export compliance, then approve/upload explicitly. No signing validation or TestFlight processing verification is claimed here.

## Reproduction

Run `npm ci`, configure the existing staging environment, then `npm run build`, `npm test`, `npm run verify:staging`, and `npm run ios:sync`. `npm run brand:generate` refreshes only approved colors and the SVG symbol copy. Optional raster regeneration: install Sharp 0.34.x locally and run `node scripts/export-brand-assets.cjs`; `NEXUS_SHARP_MODULE` may point to an existing Sharp module. The checked-in raster assets do not require Sharp to build.

For responsive preview verification, run the local development server and `node scripts/verify-brand-preview.cjs` with Playwright available. Optional `NEXUS_PLAYWRIGHT_MODULE` and `NEXUS_CHROME_PATH` select installed tools. Preview screenshots are in `docs/review/nexus-ios-slate/` and deliberately show the fixture's review controls on non-modal screens.

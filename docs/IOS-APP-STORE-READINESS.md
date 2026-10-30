# NEXUS 2.0 — iOS App Store release readiness

**Working branch:** `IOS-App` in `Science-By-Hugs/Nexus`  
**Baseline:** `main` commit `f98565407003d478e78f1d4d661990a8fe4f79f7` (2026-10-29)  
**Status:** **NO-GO / preparation only**  
**Release authority:** An explicit owner approval is required before any production build upload, backend cutover, Apple review submission, or public distribution.

This document distinguishes confirmed code findings from external checks that have **not** been performed. It is **not** an assertion that the existing TestFlight app or public NEXUS service is safe for release.

## Owner-facing next actions, in priority order

- [ ] **Confirm the existing App Store Connect app record and exact bundle ID.** The earlier release record supplied by the owner is App Store Connect app ID `6822648422`; NEXUS 2.0.0 (11) was reported uploaded to TestFlight on October 21, 2026. Neither record status nor bundle ID has been verified live in this branch audit. Do not guess or replace the bundle ID: an app with an uploaded build cannot change it.
- [ ] **Create a distinct, reviewed production iOS configuration**, preserving the existing staging build and environment. A production build must use the actual Apple bundle ID, verified signing team/profile, approved backend, accurate public app name, distinct session storage, and explicit production runtime guards. Do not point the existing staging app at production services.
- [ ] **Review release-blocking GitHub PRs** individually: [#6 checkout, payment, consent and security](https://github.com/Science-By-Hugs/Nexus/pull/6); [#7 CI and branch rules](https://github.com/Science-By-Hugs/Nexus/pull/7); [#8 research verification](https://github.com/Science-By-Hugs/Nexus/pull/8). Do not auto-merge these changes without reviewing code, required backend migration/secret prerequisites, compatibility and test results.
- [ ] **Establish a permitted iOS catalog.** For each proposed physical product, verify its actual regulatory and legal status, eligibility for sale, image accuracy, and platform policy eligibility. Apply restrictions server-side through CORE/Supabase, not only client filters. Synthetic fixtures are never to be represented as inventory.
- [ ] **Approve backend and purchasing behavior.** Audit customer isolation and CORE owner permissions; check the deployed backend and Edge Functions; verify discounts, inventory recheck, order totals, refunds/cancellation, invoices, delivery and payment-provider configuration. Keep live payments and Zelle disabled until legal eligibility and end-to-end testing are approved.
- [ ] **Create and test a new internal TestFlight release candidate**, using a build number greater than the currently highest build for the same App Store version. Test login/logout, Apple ID sign-in, recovery, account deletion, biometrics, push, checkout where permitted, order history, keyboard navigation, safe areas, large fonts, empty/errors, iPhone and iPad. Reproduce the same archive to be submitted to review; do not rely solely on browser screenshots.
- [ ] **Prepare and verify the listing:** icon, real device screenshots, name/subtitle, description, keywords, category, support and privacy policy URLs, data collection/privacy disclosures, age rating, encryption/export-compliance answers, reviewer instructions and an accessible demo account.
- [ ] **Get explicit owner release approval** only after evidence-based go/no-go sign-off. Select the tested build for App Review and choose manual release. No public release from this preparation branch without approval.

## Confirmed engineering findings on `IOS-App` baseline

| Area | Finding | Required work |
| --- | --- | --- |
| Capacitor | `capacitor.config.ts`: `com.sciencebyhugs.nexus.staging`, `NEXUS Staging` | Match the *existing* Apple app record; preserve a separate staging identity |
| Xcode | `ios/App/App.xcodeproj/project.pbxproj`: both build configurations use staging bundle ID; `MARKETING_VERSION = 2.0.0`; `CURRENT_PROJECT_VERSION = 10` | Verify App Store record, identity, effective archive settings and new build number; repository version may lag TestFlight |
| App metadata | `ios/App/App/Info.plist`: `CFBundleDisplayName = NEXUS Staging` | Set approved public name for the production target only |
| Frontend build | `npm run build` always uses `vite build --mode staging`; `ios:sync` calls that staging build | Design a separate production build path; do not bypass stage guards |
| Environment validation | `src/environment.ts` requires `VITE_APP_ENV=staging`, sandbox payments, and blocks known production projects/domains | Implement explicit production-specific allowlists and validated settings before any release |
| Session isolation | `src/services/supabase.ts` uses `sbh-nexus-v2-staging-auth` | Use a reviewed production storage namespace and migration policy |
| Staging identity | `src/main.ts`, `index.html`, and PWA config show internal staging labels | Remove staging UI only from production mode; retain it for testers |
| Push | Checked-in entitlements set `aps-environment=development` | Verify Archive entitlement/signing and production APNs; never change by guesswork |
| Checkout | Checkout functions are gated behind staging test-payment flags; sandbox reservation paths exist | Confirm only legally permitted products and approved payment integration before activating real orders |
| Native platform | Xcode `TARGETED_DEVICE_FAMILY = 1,2` | Test iPhone/iPad and supply each required size of real App Store screenshots |
| CI | Only stages a local fixture backend; it doesn't deploy, validate live services, or prove native/archive behavior | `IOS-App` push/PR CI was enabled on this branch; separate native/manual gates remain |

### Read-only automated check

```sh
# Supply the exact bundle ID observed inside the existing Apple app record.
NEXUS_APP_STORE_BUNDLE_ID='com.example.actual-from-apple' npm run audit:ios-release
```

Replace the example value before running. The command prints **BLOCKED** for unresolved code-level requirements and exits nonzero. It reads local source files only: no deployment, credential creation or Apple submission. Even a future PASS does **not** replace product legality, reviewer access, Apple signing, backend security, TestFlight or device acceptance.

### Do not confuse CI with a production readiness certificate

`v2-ci.yml` currently installs dependencies, runs the existing tests, creates a **staging** build with local fixture values, and verifies staging isolation. This is intentional and non-deploying. The new `IOS-App` trigger makes the branch testable, but a green run demonstrates only those checks; it does not prove App Store approval or the existence of a functioning production backend.

## Policy and disclosure gates

- Apple's App Review Guideline 1.4.3 prohibits certain drug-related promotion and facilitating prohibited controlled-substance sales. Physical goods payment rules (3.1.3(e)) do not override product legality. Review the legal status and eligibility of each research product before showing or selling it in the iOS app. Research disclaimers and customer attestations by themselves do not establish legal permission.
- The product page and screenshots must match **real, running app functionality**; don't use fictional design-review screenshots as shipped features.
- Apple's current required screenshot sizes include an iPhone with Dynamic Island and a 13-inch iPad if iPadOS is supported. The project currently targets both device families.
- Supply reviewer documentation and demo credentials securely through App Store Connect; never commit passwords, production tokens or API keys into this repository.
- Confirm account/data deletion requirements, privacy policy and app privacy disclosures match actual SDK and backend data use.

Official references:
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Submit an app: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- Complete review information: https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review

## Evidence and final sign-off template

| Gate | Owner/verifier | Evidence | Result |
| --- | --- | --- | --- |
| Existing Apple record ID and bundle ID | Owner | App Store Connect app information | Pending |
| Approved legal/eligible iOS catalog | Owner + qualified legal/regulatory reviewer | Itemized SKU approvals, server restrictions | Pending |
| Production backend/auth/payment security | Engineering | Reviewed configs, RLS, Edge Function deployment, E2E tests | Pending |
| Native signing/TestFlight | Engineering + owner | Exact archive commit, bundle ID, build number, install proof | Pending |
| Device/accessibility/checkout QA | Testers | iPhone/iPad test results, permitted transactions, failure cases | Pending |
| Store listing, screenshots and disclosures | Owner | Complete App Store Connect record | Pending |
| Final launch approval | Owner | Explicit approval after gates pass | Pending |

**Important:** `main`, production DNS, live payment settings, database secrets and App Store submission are outside this branch-preparation step.

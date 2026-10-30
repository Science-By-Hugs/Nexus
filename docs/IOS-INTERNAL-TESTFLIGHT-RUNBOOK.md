# NEXUS 2.0 — Internal TestFlight runbook

**Current scope:** Internal testers only. Do not deploy production NEXUS, enable live payments, add external testers, or submit to public App Review. Work on `IOS-App` only.

## Current candidate and stop conditions

- GitHub branch: `Science-By-Hugs/Nexus` → `IOS-App`
- Native app name: `NEXUS Staging`
- Source bundle ID: `com.sciencebyhugs.nexus.staging` (must be compared to Apple's existing app record)
- Candidate: **2.0.0 (12)** in Xcode Debug/Release. **Provisional**: the latest Apple upload has NOT been independently checked. Previous reported build was **2.0.0 (11)**.
- App Store Connect app record reported for NEXUS: `6822648422`. This app's actual bundle ID, uploaded builds and tester access still require a live check.
- Staging backend documented for NEXUS/CORE test apps: `evyssawhlarqqhgyswhz`. Keep synthetic/tester data isolated from production.
- Non-deploying CI on `IOS-App` checks frontend build/staging isolation and the native source configuration. **CI does not archive, sign, upload or test on a phone.**

**Stop and report** if the Apple app's bundle ID differs from the source bundle ID, if its latest build number is 12 or greater, if the signing team differs, if the staging project cannot be reached with permitted tester credentials, or if a real checkout/payment is possible in the internal build. Do not invent a new app ID or bundle identifier to force an upload.

## A. Verify Apple record before building

1. Open [NEXUS in App Store Connect](https://appstoreconnect.apple.com/apps/6822648422/testflight/ios) and confirm you are viewing the existing app.
2. Open App Information and copy its **Bundle ID**. It must be the ID used by the signed iOS app. Check which Apple Developer team owns that app.
3. In **TestFlight → iOS**, inspect **Build Uploads** and the version list to find the actual latest **2.0.0** build number and status. If 12 (or higher) already exists, increase `CURRENT_PROJECT_VERSION` in **both** Debug and Release configs in `ios/App/App.xcodeproj/project.pbxproj` before archiving.
4. Verify that **Early Internal Testing** exists and whether automatic distribution is enabled. The previous workflow used **manual** assignment. Do not create duplicate groups or upload the same build twice.

## B. Prepare local staging configuration (Mac / Xcode)

```sh
git fetch origin
git checkout IOS-App
git pull --ff-only origin IOS-App
npm ci
cp .env.example .env.staging.local
```

Edit `.env.staging.local` locally with the approved staging URL and its **publishable** key, plus:
- `VITE_APP_ENV=staging`
- `VITE_EXPECTED_SUPABASE_REF=evyssawhlarqqhgyswhz`
- `VITE_SUPABASE_URL=https://evyssawhlarqqhgyswhz.supabase.co`
- `VITE_PAYMENT_ENV=sandbox`
- `VITE_ENABLE_TEST_PAYMENTS=false`

The iOS build overrides `VITE_APP_ORIGIN` to `capacitor://localhost`. Do **not** commit `.env.staging.local`, publish a service-role/secret key, or use the fake `sb_publishable_ci_build_only` CI key for a device build.

## C. Test, build and sync

```sh
npm test
npm run build
npm run verify:staging
npm run verify:ios-internal -- --code-only
npm run ios:sync
```

Then run the **pre-upload audit** with the *actual values from Apple*:

```sh
NEXUS_APP_STORE_BUNDLE_ID='<existing Apple Bundle ID>' \
NEXUS_APPLE_TEAM_ID='<Apple team ID>' \
NEXUS_LATEST_APPLE_BUILD='<actual latest build number>' \
VITE_APP_ORIGIN=capacitor://localhost \
npm run verify:ios-internal -- --preupload
```

This command **reads** project files and staging settings only; it does not sign, upload, or print the publishable key. A PASS is a source/bundle preflight, **not** proof of functioning Apple authentication or backend integration.

## D. Archive and upload to INTERNAL TestFlight

1. Run `npx cap open ios`.
2. Verify the Apple **team**, existing bundle identifier, `2.0.0` version, latest unused build number, app icon, signing profile and capabilities (Sign in with Apple, push as appropriate).
3. Run on an iPhone simulator and a real tester phone as available. Test the launch animation, safe areas, scrolling, keyboard, onboarding, sign-in/reset, Apple sign-in, biometric unlock, permissions, notifications and known error states. Keep payments disabled and catalog data synthetic/restricted.
4. Choose **Any iOS Device** in Xcode and **Product → Archive**. Inspect the archive's effective bundle ID, signed entitlements (including APNs environment), team, version, and build number.
5. From Organizer, **Distribute App → App Store Connect → Upload** to the **existing** app. Choose normal TestFlight-capable distribution if there is a reason to reuse this specific build with external testers later. Apple also offers a **TestFlight Internal Only** upload option, but builds so marked cannot later be added to external tester groups. No App Store or external beta submission is authorized here.
6. Wait for Apple processing; inspect the build's exact **Complete** or **Failed** status and any compliance/processing warnings. Do not claim upload succeeded until the build appears.
7. Select **Internal Testing → Early Internal Testing → Add Builds** (unless existing automatic distribution already handled it), choose the processed build, enter concise `What to Test` notes, and confirm an invited App Store Connect internal tester can install it from TestFlight.

## E. Internal acceptance and next release

Record:
- Exact source commit SHA, Apple app ID and bundle ID
- TestFlight version/build, uploaded/processed timestamps and tester-group assignment
- CI results; Xcode archive/signing result; one successful real-device installation
- Pass/fail for login, recovery, Apple Sign-in, biometrics, restricted catalog, sandbox reservation, orders, push, keyboard and visual acceptance
- Bugs and severity; whether a replacement build is needed

**Only after successful internal acceptance** should we consider the next phase, **external TestFlight beta**, with separate owner approval and Apple's applicable TestFlight App Review requirements. Public App Store release is a third, later phase.

Official Apple resources:
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers

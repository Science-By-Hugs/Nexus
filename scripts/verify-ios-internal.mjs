// NEXUS internal TestFlight preflight. Read-only; never signs, uploads, or deploys.
// --code-only checks repository consistency in fixture-only CI.
// --preupload additionally requires Apple's verified bundle/team IDs, actual staging
// credentials loaded locally (never printed), and a synced native web bundle.
import fs from 'node:fs'
import path from 'node:path'

const preupload = process.argv.includes('--preupload')
const codeOnly = process.argv.includes('--code-only')
if (preupload === codeOnly) {
  console.error('Use exactly one mode: --code-only or --preupload')
  process.exit(2)
}

const read = name => fs.readFileSync(name, 'utf8')
const checks = []
const check = (name, passes, fix) => checks.push({name, passes: Boolean(passes), fix})
const capacitor = read('capacitor.config.ts')
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj')
const plist = read('ios/App/App/Info.plist')
const entitlements = read('ios/App/App/App.entitlements')
const environment = read('src/environment.ts')
const backend = read('src/services/supabase.ts')
const manifest = JSON.parse(read('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json'))
const pkg = JSON.parse(read('package.json'))
const envExample = read('.env.example')

const capacitorId = capacitor.match(/appId:\s*['"]([^'"]+)['"]/)?.[1] || ''
const capacitorName = capacitor.match(/appName:\s*['"]([^'"]+)['"]/)?.[1] || ''
const nativeIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)]
  .map(m => m[1].trim().replace(/^["']|["']$/g, ''))
const buildNumbers = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+);/g)].map(m => Number(m[1]))
const versions = [...pbxproj.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)].map(m => m[1].trim())
const teamIds = [...pbxproj.matchAll(/DEVELOPMENT_TEAM\s*=\s*([^;]+);/g)].map(m => m[1].trim())
const displayName = plist.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/)?.[1] || ''

check('Staging bundle ID consistent across Capacitor and Xcode',
  capacitorId.endsWith('.staging') && nativeIds.length === 2 && nativeIds.every(id => id === capacitorId),
  'Match both Xcode configurations and Capacitor to the EXISTING Apple record; never guess an App ID.')
check('Internal app name consistent',
  capacitorName === 'NEXUS Staging' && displayName === capacitorName,
  'Preserve visible staging identity in native metadata.')
check('Native version and prospective build number valid',
  versions.length === 2 && versions.every(v => v === '2.0.0') &&
  buildNumbers.length === 2 && buildNumbers.every(n => n === buildNumbers[0]) &&
  buildNumbers[0] > 11,
  'Previous reported upload was build 11; confirm Apple\'s latest number and increase the candidate as needed.')
check('Existing signing team configured', teamIds.length === 2 && teamIds.every(id => /^[A-Z0-9]{10}$/.test(id) && id === teamIds[0]),
  'Verify Apple Developer team and archive signing in Xcode.')
check('Apple Sign-in and push entitlement declarations present',
  entitlements.includes('com.apple.developer.applesignin') && entitlements.includes('aps-environment'),
  'Check actual distribution entitlements and APNs signing with the Apple profile.')
check('iOS app icon asset declared and present',
  manifest.images?.some(entry => entry.size === '1024x1024' && entry.filename &&
    fs.existsSync(path.join('ios/App/App/Assets.xcassets/AppIcon.appiconset', entry.filename))),
  'Provide the official 1024x1024 iOS icon.')
check('Staging-only build and runtime restrictions retained',
  /--mode staging/.test(pkg.scripts.build || '') &&
  (pkg.scripts['ios:sync'] || '').includes('build:ios') &&
  (pkg.scripts['build:ios'] || '').includes('capacitor://localhost') &&
  /input\.appEnv\s*!==\s*['"]staging['"]/.test(environment) &&
  environment.includes('Production Supabase projects are blocked') &&
  environment.includes("input.paymentEnv !== 'sandbox'"),
  'Do not switch production services or remove staging validation for internal testing.')
check('Staging auth session and disabled payments remain default',
  backend.includes('sbh-nexus-v2-staging-auth') &&
  envExample.includes('VITE_PAYMENT_ENV=sandbox') &&
  envExample.includes('VITE_ENABLE_TEST_PAYMENTS=false'),
  'Retain isolated tester sessions and sandbox/disabled payment defaults.')

if (preupload) {
  const appleBundleId = String(process.env.NEXUS_APP_STORE_BUNDLE_ID || '').trim()
  const appleTeamId = String(process.env.NEXUS_APPLE_TEAM_ID || '').trim()
  const latestBuild = Number(process.env.NEXUS_LATEST_APPLE_BUILD)
  check('Bundle ID matches the existing Apple app record',
    Boolean(appleBundleId) && appleBundleId === capacitorId,
    'Supply NEXUS_APP_STORE_BUNDLE_ID from App Store Connect; do not create a new app.')
  check('Team ID matches App Store Connect / Developer account',
    Boolean(appleTeamId) && teamIds.every(id => id === appleTeamId),
    'Supply NEXUS_APPLE_TEAM_ID from Apple; never rely only on a checked-in string.')
  check('Build number exceeds the latest Apple upload',
    Number.isInteger(latestBuild) && latestBuild >= 11 && buildNumbers.every(n => n > latestBuild),
    'Supply NEXUS_LATEST_APPLE_BUILD from App Store Connect and bump the Xcode build number if required.')
  // Vite's parser reads .env.staging.local without logging publishable key values.
  const { loadEnv } = await import('vite')
  const env = loadEnv('staging', process.cwd(), 'VITE_')
  const configured = env.VITE_EXPECTED_SUPABASE_REF || ''
  let urlMatches = false
  try { urlMatches = new URL(env.VITE_SUPABASE_URL).hostname === configured + '.supabase.co' } catch {}
  check('Native bundle uses genuine approved staging project, not CI fixture',
    configured === 'evyssawhlarqqhgyswhz' && urlMatches &&
    /^https:\/\//.test(env.VITE_SUPABASE_URL || '') &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY || '') &&
    env.VITE_SUPABASE_PUBLISHABLE_KEY !== 'sb_publishable_ci_build_only' &&
    env.VITE_APP_ENV === 'staging' &&
    env.VITE_APP_ORIGIN === 'capacitor://localhost' &&
    env.VITE_PAYMENT_ENV === 'sandbox' && env.VITE_ENABLE_TEST_PAYMENTS === 'false',
    'Configure the authorized staging URL/publishable key locally; use VITE_APP_ORIGIN=capacitor://localhost and disable payments.')
  const distIndex = 'dist/index.html'
  const nativeIndex = 'ios/App/App/public/index.html'
  check('Fresh web bundle synced into iOS shell',
    fs.existsSync(distIndex) && fs.existsSync(nativeIndex) &&
    read(distIndex) === read(nativeIndex),
    'After configuring staging env, run npm run ios:sync and inspect the generated native bundle.')
  const assetDir = 'dist/assets'
  const js = fs.existsSync(assetDir) ? fs.readdirSync(assetDir)
    .filter(name => name.endsWith('.js')).map(name => read(path.join(assetDir, name))).join('\n') : ''
  check('Bundled JS uses staging backend with no fixture key',
    Boolean(js) && js.includes('INTERNAL STAGING') &&
    js.includes('sbh-nexus-v2-staging-auth') &&
    js.includes(configured + '.supabase.co') &&
    !js.includes('sb_publishable_ci_build_only'),
    'Do not upload a CI fixture or an outdated/production frontend bundle.')
}
for (const c of checks) {
  console.log((c.passes ? 'PASS' : 'BLOCKED') + ' - ' + c.name)
  if (!c.passes) console.log('  ' + c.fix)
}
const blockers = checks.filter(c => !c.passes).length
console.log('NEXUS internal TestFlight ' + (codeOnly ? 'CODE-ONLY' : 'PREUPLOAD') + ': ' + (checks.length - blockers) + '/' + checks.length + ' checks passed.')
console.log('Manual gates remain: Apple signing/archive validation, live TestFlight processing, physical-device login/push/UX and internal tester install.')
if (codeOnly) console.log('CODE-ONLY does not approve a TestFlight upload or verify live services.')
if (blockers) process.exitCode = 1

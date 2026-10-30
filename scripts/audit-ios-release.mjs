// Read-only code-level release audit. A PASS does not replace legal, device, backend or App Store Connect approval.
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const capacitor = read('capacitor.config.ts')
const xcode = read('ios/App/App.xcodeproj/project.pbxproj')
const info = read('ios/App/App/Info.plist')
const environment = read('src/environment.ts')
const client = read('src/services/supabase.ts')
const main = read('src/main.ts')
const index = read('index.html')
const packageJson = JSON.parse(read('package.json'))

const record = []
function check(title, ready, why) {
  record.push({ title, ready: Boolean(ready), why })
}
const appleBundleId = String(process.env.NEXUS_APP_STORE_BUNDLE_ID || '').trim()
const validAppleBundleId = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/.test(appleBundleId)
check('Apple bundle ID supplied for comparison', validAppleBundleId,
  'Set NEXUS_APP_STORE_BUNDLE_ID to the exact existing App Store Connect app bundle ID; do not guess it.')

const capId = capacitor.match(/appId:\s*['"]([^'"]+)['"]/)?.[1] || ''
const capName = capacitor.match(/appName:\s*['"]([^'"]+)['"]/)?.[1] || ''
check('Capacitor identity matches existing Apple record',
  validAppleBundleId && capId === appleBundleId && !/staging/i.test(capId),
  'Capacitor appId must match the existing Apple app record exactly, without changing staging apps.')

const xcodeIds = [...xcode.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map(m => m[1].trim().replace(/^["']|["']$/g, ''))
check('All native Xcode bundle identifiers match Apple',
  validAppleBundleId && xcodeIds.length > 0 && xcodeIds.every(id => id === appleBundleId),
  'Review Debug and Release settings and verify the effective Archive bundle ID in Xcode.')

const displayName = info.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || ''
check('Native app name is public-ready',
  displayName === 'NEXUS' && capName === 'NEXUS',
  'Change the display name only after confirming the App Store listing and final brand identity.')

check('Separate production build path exists',
  Boolean(packageJson.scripts['build:ios:production']) &&
  !/--mode staging|npm run build:ios(?:\s|$)/.test(packageJson.scripts['build:ios:production']),
  'Current iOS build reuses a staging-only Vite mode; add a reviewed production build pipeline.')

check('Application environment has an explicit production policy',
  !/input\.appEnv\s*!==\s*['"]staging['"]/.test(environment),
  'src/environment.ts currently forbids all non-staging builds; introduce audited production validation before release.')

check('Production session does not reuse staging auth storage',
  !client.includes('sbh-nexus-v2-staging-auth'),
  'Use an explicit, separate production auth storage namespace after validating account migration.')

check('Customer-facing build has no staging banner',
  !main.includes('INTERNAL STAGING'),
  'Remove staging-only UI from the verified production build, while retaining staging identification in staging.')

check('Native launch HTML does not claim to be staging',
  !index.includes('Internal Staging'),
  'Use accurate public-facing metadata for a production build without changing staging defaults.')

console.log('NEXUS iOS code preflight (no production changes or deployment)')
for (const item of record) {
  console.log((item.ready ? 'PASS' : 'BLOCKED') + ' - ' + item.title)
  if (!item.ready) console.log('  ' + item.why)
}
const blocked = record.filter(item => !item.ready).length
console.log('Code checks: ' + (record.length - blocked) + ' passed, ' + blocked + ' blocked.')
console.log('Additional required manual gates: Apple signing and TestFlight, approved backend and live payment flows, product eligibility/legal review, privacy disclosures, device QA, screenshots, and App Review account.')
if (blocked) process.exitCode = 1

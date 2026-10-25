const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = ts.transpileModule(fs.readFileSync('src/researchApplication.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, Date, Set }
vm.runInNewContext(source, context)
const r = context.exports
const form = (over = {}) => ({ institution_name: 'Test University', department: '', role_title: 'Postdoc',
  principal_investigator: 'Dr. Example', research_summary: 'Studying receptor binding in cultured cells, lab only.', terms: true, ...over })
const ok = { email: 'p@test.edu', emailConfirmed: true }

test('a complete institutional application passes', () => {
  assert.equal(r.applicationProblem(form(), ok), null)
  assert.equal(r.applicationProblem(form(), ok, { size: 2_000_000, type: 'application/pdf' }), null)
})

test('each rule the database enforces gets a clear message first', () => {
  assert.match(r.applicationProblem(form(), { ...ok, emailConfirmed: false }), /Confirm your email/)
  assert.match(r.applicationProblem(form(), { email: 'someone@Gmail.com', emailConfirmed: true }), /institutional email/)
  assert.match(r.applicationProblem(form({ institution_name: ' ' }), ok), /institution/)
  assert.match(r.applicationProblem(form({ role_title: 'x' }), ok), /role/)
  assert.match(r.applicationProblem(form({ principal_investigator: '' }), ok), /principal investigator/)
  assert.match(r.applicationProblem(form({ research_summary: 'too short' }), ok), /40 characters/)
  assert.match(r.applicationProblem(form({ terms: false }), ok), /terms/)
  assert.match(r.applicationProblem(form(), ok, { size: 1, type: 'text/plain' }), /PDF, JPG or PNG/)
  assert.match(r.applicationProblem(form(), ok, { size: 11 * 1024 * 1024, type: 'image/png' }), /10 MB/)
})

test('documents go in the applicant’s own folder with a safe name', () => {
  const id = '6f1c2a4e-1111-4222-8333-944455556666'
  const path = r.documentPath(id, '../../Letter Of Support.JPEG', 1700000000000)
  assert.equal(path, `${id}/supporting-1700000000000.jpg`)
  assert.match(path, /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/)
  assert.equal(r.documentPath(id, 'scan', 1), `${id}/supporting-1.pdf`)
})

test('status reflects approval expiry', () => {
  const now = Date.parse('2026-10-25T00:00:00Z')
  assert.equal(r.statusOf(null, now), 'none')
  assert.equal(r.statusOf({ status: 'approved', expires_at: '2027-10-25T00:00:00Z' }, now), 'approved')
  assert.equal(r.statusOf({ status: 'approved', expires_at: '2026-10-24T00:00:00Z' }, now), 'expired')
  assert.equal(r.statusOf({ status: 'pending', expires_at: null }, now), 'pending')
  assert.equal(r.statusOf({ status: 'something', expires_at: null }, now), 'none')
  for (const s of ['none', 'pending', 'approved', 'denied', 'withdrawn', 'expired']) assert.ok(r.statusCopy[s].title)
})

test('nothing in the app suggests personal or human use', () => {
  const text = fs.readFileSync('src/researchApplication.ts', 'utf8') + fs.readFileSync('src/main.ts', 'utf8').match(/function openResearchDialog[\s\S]*?\n}\n/)[0]
  assert.match(text, /not for human or veterinary use/)
  assert.doesNotMatch(text, /\b(dose|dosing|inject|cycle)\b/i)
})

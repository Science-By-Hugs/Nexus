// Loads TypeScript sources into a VM context for tests. Import lines are
// removed and their bindings come from the context, like the other tests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.join(__dirname, '..', '..')

function transpile(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*$/gm, '')
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

// Runs a module in its own function scope and returns its exports, so several
// modules can share one context without clashing top-level declarations.
function runModule(context, file) {
  const exports = {}
  vm.runInContext(`(function (exports) {\n${transpile(file)}\n})`, context)(exports)
  return exports
}

const shared = ['http', 'crypto', 'pricing', 'paypal', 'invoice-bridge'].map(name => `supabase/functions/_shared/${name}.ts`)

function loadShared(globals = {}) {
  const context = vm.createContext({ console, URL, URLSearchParams, Response, Request, Headers, TextEncoder, crypto, btoa, ...globals })
  for (const file of shared) Object.assign(context, runModule(context, file))
  return context
}

module.exports = { loadShared, runModule, transpile }

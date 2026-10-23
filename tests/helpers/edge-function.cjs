// Runs a supabase/functions/<name>/index.ts handler in a VM with an in-memory
// Supabase client, a scripted fetch and Deno.env, for contract tests only.
const { loadShared, runModule } = require('./load-ts.cjs')

const SUPABASE_URL = 'https://project.supabase.test'
const SECRET_KEY = 'sb_secret_test_only'
const BRIDGE_SECRET = 'bridge-secret-for-tests-0123456789abcdef'

// Minimal PostgREST-style query builder over plain arrays of rows.
function fakeDatabase(tables, failures) {
  const db = JSON.parse(JSON.stringify(tables))
  const log = []
  let nextId = 1

  const withRelations = (row, columns) => {
    const copy = { ...row }
    for (const [, relation] of String(columns || '').matchAll(/(\w+)\(/g)) {
      const foreignKey = relation.replace(/s$/, '') + '_id'
      copy[relation] = (db[relation] || []).find(candidate => candidate.id === row[foreignKey]) || null
    }
    return copy
  }

  class Query {
    constructor(table) { Object.assign(this, { table, action: 'select', filters: [], columns: '*', options: {}, returning: false, mode: null, max: null, sort: [] }) }
    select(columns = '*', options = {}) {
      if (this.action === 'select') Object.assign(this, { columns, options })
      else Object.assign(this, { columns, returning: true })
      return this
    }
    insert(values) { return Object.assign(this, { action: 'insert', values }) }
    update(values) { return Object.assign(this, { action: 'update', values }) }
    upsert(values, options = {}) { return Object.assign(this, { action: 'upsert', values, upsertOptions: options }) }
    filter(test) { this.filters.push(test); return this }
    eq(column, value) { return this.filter(row => row[column] === value) }
    in(column, values) { return this.filter(row => values.includes(row[column])) }
    is(column, value) { return this.filter(row => (row[column] ?? null) === value) }
    not(column, operator, value) { return this.filter(row => operator === 'is' ? (row[column] ?? null) !== value : row[column] !== value) }
    gte(column, value) { return this.filter(row => row[column] != null && row[column] >= value) }
    lte(column, value) { return this.filter(row => row[column] != null && row[column] <= value) }
    order(column, { ascending = true } = {}) { this.sort.push([column, ascending]); return this }
    limit(count) { this.max = count; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject) }
    run() {
      const entry = { table: this.table, action: this.action, values: this.values }
      log.push(entry)
      const failure = failures[`${this.table}.${this.action}`]
      const error = typeof failure === 'function' ? failure(entry) : failure
      if (error) return { data: null, error, count: null }

      const rows = db[this.table] ||= []
      const matches = row => this.filters.every(test => test(row))
      let result = []
      if (this.action === 'select') {
        result = rows.filter(matches)
        for (const [column, ascending] of [...this.sort].reverse()) {
          result.sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1))
        }
        if (this.max != null) result = result.slice(0, this.max)
        if (this.options.head) return { data: null, count: result.length, error: null }
      } else if (this.action === 'insert') {
        result = [].concat(this.values).map(values => ({ id: `${this.table}-${nextId++}`, created_at: new Date().toISOString(), ...values }))
        rows.push(...result)
      } else if (this.action === 'update') {
        result = rows.filter(matches)
        for (const row of result) Object.assign(row, this.values)
      } else if (this.action === 'upsert') {
        const key = this.upsertOptions.onConflict
        result = [].concat(this.values).map(values => {
          const existing = rows.find(row => row[key] === values[key])
          if (existing) return Object.assign(existing, values)
          const inserted = { id: `${this.table}-${nextId++}`, created_at: new Date().toISOString(), ...values }
          rows.push(inserted)
          return inserted
        })
      }

      if (this.action !== 'select' && !this.returning) return { data: null, error: null, count: null }
      let data = result.map(row => withRelations(row, this.columns))
      if (this.mode === 'single') {
        if (data.length !== 1) return { data: null, error: { message: 'Expected exactly one row' }, count: null }
        data = data[0]
      } else if (this.mode === 'maybe') {
        if (data.length > 1) return { data: null, error: { message: 'Expected at most one row' }, count: null }
        data = data[0] ?? null
      }
      return { data, error: null, count: this.options.count ? result.length : null }
    }
  }

  return { db, log, from: table => new Query(table) }
}

// routes: [[RegExp matching the URL, (url, init, body) => ({ status, body })]]
function scriptedFetch(routes) {
  const calls = []
  async function fetch(input, init = {}) {
    const url = String(input)
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = init.body }
    calls.push({ url, init, body })
    const route = routes.find(([pattern]) => pattern.test(url))
    if (!route) throw new Error('Unexpected fetch: ' + url)
    const reply = await route[1](new URL(url), init, body)
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {})
    return new Response(text, { status: reply.status || 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetch, calls }
}

function loadEdgeFunction(name, { tables = {}, failures = {}, user, env = {}, routes = [] } = {}) {
  const database = fakeDatabase(tables, failures)
  const network = scriptedFetch(routes)
  const environment = {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_test' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
    INVOICE_BRIDGE_SECRET: BRIDGE_SECRET,
    PAYPAL_CLIENT_ID: 'paypal-client',
    PAYPAL_CLIENT_SECRET: 'paypal-secret',
    ...env,
  }
  let handler
  const errors = []
  const context = loadShared({
    console: { ...console, error: (...args) => errors.push(args) },
    fetch: network.fetch,
    Deno: { env: { get: key => environment[key] }, serve: fn => { handler = fn } },
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: user || null }, error: user ? null : { message: 'No session' } }) },
      from: database.from,
    }),
  })
  runModule(context, `supabase/functions/${name}/index.ts`)
  const call = (body, headers = {}) => handler(new Request('https://edge.test/' + name, {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
  return { call, handler, db: database.db, log: database.log, fetchCalls: network.calls, errors, context }
}

module.exports = { loadEdgeFunction, SECRET_KEY, BRIDGE_SECRET, SUPABASE_URL }

// Research-access application: client-side checks that mirror the database
// rules (supabase/migrations/20261025200000_research_verification.sql in Core).
// The database is the authority; these only give the applicant clear messages.

export const RESEARCH_TERMS_VERSION = '2026-10-25'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

export type ResearchStatus = 'none' | 'pending' | 'approved' | 'denied' | 'withdrawn' | 'expired'

export type ResearchApplicationForm = {
  institution_name: string
  department: string
  role_title: string
  principal_investigator: string
  research_summary: string
  terms: boolean
}

// Kept in step with private.is_free_email_domain in the database.
const freeDomains = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'zoho.com', 'zohomail.com', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com',
])

export function emailDomain(email: string | null | undefined) {
  return String(email ?? '').trim().toLowerCase().split('@')[1] ?? ''
}

export function isPersonalEmail(email: string | null | undefined) {
  return freeDomains.has(emailDomain(email))
}

const within = (value: string, min: number, max: number) => {
  const length = value.trim().length
  return length >= min && length <= max
}

// Returns the first problem as a sentence the applicant can act on, or null.
export function applicationProblem(
  form: ResearchApplicationForm,
  account: { email: string | null | undefined; emailConfirmed: boolean },
  document?: { size: number; type: string } | null,
): string | null {
  if (!account.emailConfirmed) return 'Confirm your email address first, then apply.'
  if (isPersonalEmail(account.email)) return 'Sign in with your institutional email address to apply. Personal addresses like Gmail can’t be verified.'
  if (!within(form.institution_name, 2, 200)) return 'Enter your institution’s name.'
  if (form.department.trim().length > 200) return 'Department must be 200 characters or fewer.'
  if (!within(form.role_title, 2, 120)) return 'Enter your role (for example, Research associate).'
  if (!within(form.principal_investigator, 2, 160)) return 'Enter the principal investigator’s name.'
  if (!within(form.research_summary, 40, 4000)) return 'Describe your research in at least 40 characters.'
  if (document) {
    if (!(DOCUMENT_TYPES as readonly string[]).includes(document.type)) return 'Upload a PDF, JPG or PNG.'
    if (document.size > MAX_DOCUMENT_BYTES) return 'The document must be 10 MB or smaller.'
  }
  if (!form.terms) return 'Accept the research-use terms to apply.'
  return null
}

// Storage path inside the applicant's own folder, matching the database pattern.
export function documentPath(userId: string, fileName: string, now = Date.now()) {
  const extension = (fileName.toLowerCase().match(/\.(pdf|jpe?g|png)$/)?.[1] ?? 'pdf').replace('jpeg', 'jpg')
  return `${userId}/supporting-${now}.${extension}`
}

export function statusOf(
  latest: { status: string; expires_at: string | null } | null,
  now = Date.now(),
): ResearchStatus {
  if (!latest) return 'none'
  if (latest.status === 'approved') return latest.expires_at && new Date(latest.expires_at).getTime() > now ? 'approved' : 'expired'
  if (latest.status === 'pending' || latest.status === 'denied' || latest.status === 'withdrawn') return latest.status
  return 'none'
}

export const statusCopy: Record<ResearchStatus, { title: string; body: string }> = {
  none: { title: 'Research access required', body: 'Nexus is available to verified researchers only. Apply with your institutional email to see products and order.' },
  pending: { title: 'Application under review', body: 'Thanks. Your application is being reviewed. Products and ordering open once it’s approved.' },
  approved: { title: 'Research access approved', body: 'Your research access is active.' },
  denied: { title: 'Application not approved', body: 'Your application wasn’t approved. You can review the note below and apply again.' },
  withdrawn: { title: 'Application withdrawn', body: 'You withdrew your application. You can apply again at any time.' },
  expired: { title: 'Research access expired', body: 'Research access lasts one year. Apply again to renew it.' },
}

import { supabase } from './supabase'
import {
  RESEARCH_TERMS_VERSION,
  applicationProblem,
  documentPath,
  statusOf,
  type ResearchApplicationForm,
  type ResearchStatus,
} from '../researchApplication'

export type ResearchAccess = {
  status: ResearchStatus
  expiresAt: string | null
  note: string | null
  institution: string | null
}

// The signed-in user's most recent application (row security returns only their own).
export async function getResearchAccess(): Promise<ResearchAccess> {
  const { data, error } = await supabase
    .from('research_applications')
    .select('status,expires_at,decision_reason,institution_name,submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return {
    status: statusOf(data),
    expiresAt: data?.expires_at ?? null,
    note: data?.decision_reason ?? null,
    institution: data?.institution_name ?? null,
  }
}

export async function submitResearchApplication(form: ResearchApplicationForm, document: File | null) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Sign in to apply.')
  const problem = applicationProblem(form, { email: user.email, emailConfirmed: Boolean(user.email_confirmed_at) }, document)
  if (problem) throw new Error(problem)

  let path: string | null = null
  if (document) {
    path = documentPath(user.id, document.name)
    const { error: uploadError } = await supabase.storage.from('research-documents').upload(path, document, {
      contentType: document.type, upsert: false,
    })
    if (uploadError) throw new Error('Your document could not be uploaded. Try again or apply without it.')
  }

  const { error } = await supabase.rpc('submit_research_application', {
    p: {
      institution_name: form.institution_name.trim(),
      department: form.department.trim(),
      role_title: form.role_title.trim(),
      principal_investigator: form.principal_investigator.trim(),
      research_summary: form.research_summary.trim(),
      document_path: path,
      terms_version: RESEARCH_TERMS_VERSION,
    },
  })
  if (error) throw new Error(error.message || 'Your application could not be submitted. Try again.')
}

export async function withdrawResearchApplication() {
  const { error } = await supabase.rpc('withdraw_research_application')
  if (error) throw new Error('Could not withdraw the application. Try again.')
}

export interface AgentQueryResponse {
  answer: string
  generatedAt: number
  toolsUsed: string[]
  provider?: 'bailian' | 'rules'
  model?: string
  fallback?: 'bailian_unavailable'
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Incident {
  id: string
  kind: string
  priority: 'critical' | 'high' | 'medium'
  deviceId: string
  lineId: string
  title: string
  summary: string
  status: 'open' | 'acknowledged' | 'resolved'
  detectedAt: number
  lastSeenAt: number
}

export interface DiagnosticReport {
  incidentId: string
  conclusion: string
  confidence: 'high' | 'medium'
  evidence: string[]
  possibleCauses: string[]
  recommendedActions: string[]
}

export interface WorkOrderDraft {
  id: string
  incidentId: string
  title: string
  priority: 'critical' | 'high' | 'medium'
  description: string
  checklist: string[]
  status: 'draft'
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init)
  if (!response.ok) throw new Error(`request_failed_${response.status}`)
  return response.json() as Promise<T>
}

export async function listIncidents(): Promise<Incident[]> {
  const result = await requestJson<{ items: Incident[] }>('/incidents?status=open')
  return result.items
}

export async function diagnoseIncident(incidentId: string): Promise<DiagnosticReport> {
  return requestJson<DiagnosticReport>(`/incidents/${encodeURIComponent(incidentId)}/diagnose`, { method: 'POST' })
}

export async function acknowledgeIncident(incidentId: string, operatorId: string, operatorRole: 'maintenance' | 'supervisor'): Promise<Incident> {
  const result = await requestJson<{ item: Incident }>(`/incidents/${encodeURIComponent(incidentId)}/acknowledge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, operatorRole }),
  })
  return result.item
}

export async function createWorkOrderDraft(incidentId: string, operatorId: string, operatorRole: 'maintenance' | 'supervisor'): Promise<WorkOrderDraft> {
  const result = await requestJson<{ item: WorkOrderDraft }>(`/incidents/${encodeURIComponent(incidentId)}/work-order-drafts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, operatorRole }),
  })
  return result.item
}

export async function confirmWorkOrder(draftId: string, operatorId: string, operatorRole: 'maintenance' | 'supervisor', assignee?: string): Promise<WorkOrderDraft> {
  const result = await requestJson<{ item: WorkOrderDraft }>(`/work-order-drafts/${encodeURIComponent(draftId)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, operatorRole, assignee }),
  })
  return result.item
}

export async function queryAgent(question: string, history: AgentHistoryMessage[] = []): Promise<AgentQueryResponse> {
  const response = await fetch(`${apiBaseUrl}/agent/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
  })
  if (!response.ok) throw new Error('agent_query_failed')
  return response.json() as Promise<AgentQueryResponse>
}

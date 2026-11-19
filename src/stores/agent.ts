import { defineStore } from 'pinia'
import {
  acknowledgeIncident,
  confirmWorkOrder,
  createWorkOrderDraft,
  diagnoseIncident,
  listIncidents,
  queryAgent,
  type AgentHistoryMessage,
  type DiagnosticReport,
  type Incident,
  type WorkOrderDraft,
} from '../services/agentApi'
import type { AgentMessage } from '../types'

interface AgentState {
  messages: AgentMessage[]
  isResponding: boolean
  lastCommand: string | null
  error: string | null
  incidents: Incident[]
  diagnostic: DiagnosticReport | null
  workOrderDraft: WorkOrderDraft | null
  operationsBusy: boolean
}

const MAX_MESSAGES = 40

function createMessage(role: AgentMessage['role'], content: string): AgentMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  }
}

export const useAgentStore = defineStore('agent', {
  state: (): AgentState => ({
    messages: [],
    isResponding: false,
    lastCommand: null,
    error: null,
    incidents: [],
    diagnostic: null,
    workOrderDraft: null,
    operationsBusy: false,
  }),
  actions: {
    async ask(question: string) {
      const content = question.trim()
      if (!content || this.isResponding) return

      const history: AgentHistoryMessage[] = this.messages.slice(-10).map(({ role, content: previousContent }) => ({ role, content: previousContent }))
      this.messages.push(createMessage('user', content))
      this.lastCommand = content
      this.error = null
      this.isResponding = true

      try {
        const result = await queryAgent(content, history)
        this.messages.push(createMessage('assistant', result.answer))
        if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES)
      } catch {
        this.error = '助手暂时无法处理该问题，请稍后重试。'
      } finally {
        this.isResponding = false
      }
    },
    async refreshIncidents() {
      try { this.incidents = await listIncidents() } catch { /* dashboard can continue without incident polling */ }
    },
    async diagnose(incidentId: string) {
      this.operationsBusy = true
      try { this.diagnostic = await diagnoseIncident(incidentId) } catch { this.error = '诊断服务暂时不可用。' } finally { this.operationsBusy = false }
    },
    async acknowledge(incidentId: string, operatorId: string, operatorRole: 'maintenance' | 'supervisor') {
      this.operationsBusy = true
      try {
        await acknowledgeIncident(incidentId, operatorId, operatorRole)
        await this.refreshIncidents()
      } catch { this.error = '告警确认失败，请检查操作员权限。' } finally { this.operationsBusy = false }
    },
    async makeWorkOrderDraft(incidentId: string, operatorId: string, operatorRole: 'maintenance' | 'supervisor') {
      this.operationsBusy = true
      try { this.workOrderDraft = await createWorkOrderDraft(incidentId, operatorId, operatorRole) } catch { this.error = '工单草稿创建失败，请检查操作员权限。' } finally { this.operationsBusy = false }
    },
    async confirmWorkOrder(operatorId: string, operatorRole: 'maintenance' | 'supervisor', assignee?: string) {
      if (!this.workOrderDraft) return
      this.operationsBusy = true
      try { await confirmWorkOrder(this.workOrderDraft.id, operatorId, operatorRole, assignee); this.workOrderDraft = null } catch { this.error = '工单提交失败，请检查操作员权限。' } finally { this.operationsBusy = false }
    },
    clearHistory() {
      this.messages = []
      this.lastCommand = null
      this.error = null
      this.diagnostic = null
      this.workOrderDraft = null
    },
  },
})

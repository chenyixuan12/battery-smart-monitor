import { describe, expect, it } from 'vitest'
import { IncidentService, WorkOrderService } from './operations.js'
import { RealtimeState } from './realtimeState.js'

function createState() {
  const state = new RealtimeState()
  state.ingest([{
    deviceId: 'PACK-01-EQ-01', status: 'alarm', alarmSeverity: 'critical', temperature: 52, voltage: 4.16, current: 96, oee: 68,
    outputDelta: 10, qualifiedDelta: 9, reworkDelta: 1, scrapDelta: 0, energyDelta: 1.2, timestamp: Date.now(),
  }])
  return state
}

describe('IncidentService and WorkOrderService', () => {
  it('deduplicates active incidents and produces evidence-based diagnosis', () => {
    const state = createState()
    const incidents = new IncidentService()
    incidents.evaluate(state)
    incidents.evaluate(state)

    const active = incidents.list('open')
    expect(active).toHaveLength(3)
    const report = incidents.diagnose(active[0]!.id, state)
    expect(report).toMatchObject({ incidentId: active[0]!.id, confidence: 'high' })
    expect(report?.recommendedActions.length).toBeGreaterThan(0)
  })

  it('requires an explicit confirmation step to open a work order', () => {
    const state = createState()
    const incidents = new IncidentService()
    incidents.evaluate(state)
    const incident = incidents.list('open')[0]!
    const report = incidents.diagnose(incident.id, state)!
    const workOrders = new WorkOrderService()
    const draft = workOrders.createDraft(incident, report)

    expect(workOrders.listOrders()).toHaveLength(0)
    const order = workOrders.confirmDraft(draft.id, 'shift-supervisor')
    expect(order).toMatchObject({ status: 'open', confirmedBy: 'shift-supervisor' })
    expect(workOrders.listDrafts()).toHaveLength(0)
  })
})

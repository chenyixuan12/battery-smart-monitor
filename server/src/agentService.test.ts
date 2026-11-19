import { describe, expect, it } from 'vitest'
import { AgentService } from './agentService.js'
import { RealtimeAgentTools } from './agentTools.js'
import { RealtimeState } from './realtimeState.js'
import { TelemetrySimulator } from './telemetrySimulator.js'

describe('AgentService', () => {
  it('answers from the server-side realtime state', () => {
    const state = new RealtimeState()
    state.ingest([
      {
        deviceId: 'PACK-02-EQ-01', status: 'normal', temperature: 30, voltage: 3.8, current: 80, oee: 82.4,
        outputDelta: 1_900, qualifiedDelta: 1_864, reworkDelta: 30, scrapDelta: 6, energyDelta: 610, timestamp: Date.now(),
      },
    ])
    const agent = new AgentService(new RealtimeAgentTools(state, new TelemetrySimulator(), () => 0))

    const result = agent.query('查看 L02 的良率')

    expect(result.answer).toContain('PACK 02')
    expect(result.answer).toContain('98.11%')
    expect(result.toolsUsed).toEqual(['getOverview', 'getLineMetrics'])
  })
})

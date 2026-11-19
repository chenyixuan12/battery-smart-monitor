import { describe, expect, it } from 'vitest'
import { RealtimeAgentTools } from './agentTools.js'
import { RealtimeState } from './realtimeState.js'
import { TelemetrySimulator } from './telemetrySimulator.js'

function createTools() {
  const state = new RealtimeState()
  state.ingest([
    {
      deviceId: 'PACK-01-EQ-01', status: 'normal', temperature: 30, voltage: 3.8, current: 80, oee: 90,
      outputDelta: 100, qualifiedDelta: 99, reworkDelta: 1, scrapDelta: 0, energyDelta: 20, timestamp: 100,
    },
    {
      deviceId: 'PACK-02-EQ-01', status: 'alarm', alarmSeverity: 'critical', temperature: 42, voltage: 4.1, current: 100, oee: 80,
      outputDelta: 80, qualifiedDelta: 76, reworkDelta: 3, scrapDelta: 1, energyDelta: 40, timestamp: 100,
    },
  ])
  return new RealtimeAgentTools(state, new TelemetrySimulator({ profile: 'load', seed: 7 }), () => 2)
}

describe('RealtimeAgentTools', () => {
  it('provides read-only realtime data with filtering and comparisons', () => {
    const tools = createTools()

    expect(tools.list()).toHaveLength(8)
    expect(tools.execute('getAlarms', { severity: 'critical', limit: 1 })).toMatchObject({ total: 1, items: [{ deviceId: 'PACK-02-EQ-01' }] })
    expect(tools.execute('getDevice', { deviceId: 'pack-01-eq-01' }).item).toMatchObject({ status: 'normal', oee: 90 })
    expect(tools.execute('compareLines', { metric: 'energyKwh', direction: 'highest' }).line).toMatchObject({ lineId: 'PACK-02' })
    expect(tools.execute('getRuntimeStats', {})).toMatchObject({ websocketClients: 2, simulator: { profile: 'load' } })
  })

  it('rejects unsafe or unsupported input', () => {
    const tools = createTools()

    expect(() => tools.execute('getDevice', { deviceId: '' })).toThrow('invalid device id')
    expect(() => tools.execute('compareLines', { metric: 'invalid' as never })).toThrow('invalid comparison input')
  })
})

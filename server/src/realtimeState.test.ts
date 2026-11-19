import { describe, expect, it } from 'vitest'
import { RealtimeState } from './realtimeState.js'

describe('RealtimeState', () => {
  it('aggregates device, line, quality and energy metrics from event batches', () => {
    const state = new RealtimeState()
    state.ingest([
      {
        deviceId: 'PACK-01-EQ-01', status: 'normal', temperature: 30, voltage: 3.8, current: 80, oee: 90,
        outputDelta: 2, qualifiedDelta: 1, reworkDelta: 1, scrapDelta: 0, energyDelta: 0.5, timestamp: 100,
        defectType: '焊接不良',
      },
      {
        deviceId: 'PACK-01-EQ-02', status: 'alarm', alarmSeverity: 'critical', temperature: 42, voltage: 4.1, current: 100, oee: 80,
        outputDelta: 1, qualifiedDelta: 1, reworkDelta: 0, scrapDelta: 0, energyDelta: 0.2, timestamp: 100,
      },
    ])

    const overview = state.getOverview()
    expect(overview.deviceCount).toBe(2)
    expect(overview.statusCounts).toEqual({ normal: 1, idle: 0, alarm: 1 })
    expect(overview.totalOutput).toBe(3)
    expect(overview.quality).toEqual({ qualified: 2, rework: 1, scrap: 0 })
    expect(overview.totalEnergyKwh).toBeCloseTo(0.7)
    expect(overview.defects.find((item) => item.category === '焊接不良')?.count).toBe(1)
    expect(overview.lineMetrics[0]).toMatchObject({ lineId: 'PACK-01', output: 3, deviceCount: 2 })
    expect(state.getAlarms()[0]).toMatchObject({ deviceId: 'PACK-01-EQ-02', alarmSeverity: 'critical' })
    expect(state.getDevice('missing')).toBeNull()
  })

  it('caps dynamic device state to prevent unbounded map growth', () => {
    const state = new RealtimeState({ maxDevices: 2 })
    const event = (deviceId: string, timestamp: number) => ({
      deviceId, status: 'normal' as const, temperature: 30, voltage: 3.8, current: 80, oee: 90,
      outputDelta: 0, qualifiedDelta: 0, reworkDelta: 0, scrapDelta: 0, energyDelta: 0, timestamp,
    })

    state.ingest([event('PACK-01-EQ-01', 1), event('PACK-01-EQ-02', 2)])
    state.ingest([event('PACK-01-EQ-03', 3)])

    expect(state.getOverview().deviceCount).toBe(2)
    expect(state.getDevice('PACK-01-EQ-01')).toBeNull()
    expect(state.getDevice('PACK-01-EQ-03')).not.toBeNull()
  })

  it('ignores malformed device identifiers', () => {
    const state = new RealtimeState()
    state.ingest([{
      deviceId: 'untrusted-device-id', status: 'normal', temperature: 30, voltage: 3.8, current: 80, oee: 90,
      outputDelta: 1, qualifiedDelta: 1, reworkDelta: 0, scrapDelta: 0, energyDelta: 0, timestamp: 1,
    }])

    expect(state.getOverview().deviceCount).toBe(0)
    expect(state.getOverview().totalEvents).toBe(0)
  })
})

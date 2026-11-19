import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamScheduler } from '../../src/core/realtime/StreamScheduler'
import type { DeviceTelemetryEvent } from '../../src/types'

function event(deviceId: string, status: DeviceTelemetryEvent['status'], timestamp = 1): DeviceTelemetryEvent {
  return {
    deviceId, status, alarmSeverity: status === 'alarm' ? 'critical' : undefined,
    temperature: 30, voltage: 3.8, current: 80, oee: 88,
    outputDelta: 1, qualifiedDelta: 1, reworkDelta: 0, scrapDelta: 0, timestamp,
    energyDelta: 0.001,
  }
}

describe('StreamScheduler', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps only the latest state per device in one frame', () => {
    vi.useFakeTimers()
    const batches: Array<readonly unknown[]> = []
    const scheduler = new StreamScheduler({
      onSceneBatch: (patches) => batches.push(patches),
      onMetrics: () => undefined,
      onChartPoint: () => undefined,
    })
    scheduler.enqueueBatch([
      event('PACK-01-EQ-01', 'normal'),
      event('PACK-01-EQ-01', 'idle'),
      event('PACK-01-EQ-01', 'alarm'),
    ])
    vi.advanceTimersByTime(0)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual([{ deviceId: 'PACK-01-EQ-01', status: 'alarm', alarmSeverity: 'critical' }])
    scheduler.dispose()
  })

  it('emits metrics at 250ms, charts at 1s and suppresses repeated critical state', () => {
    vi.useFakeTimers()
    const sceneBatches: Array<readonly unknown[]> = []
    const metrics = vi.fn()
    const charts = vi.fn()
    const performance = vi.fn()
    const scheduler = new StreamScheduler({ onSceneBatch: (batch) => sceneBatches.push(batch), onMetrics: metrics, onChartPoint: charts, onPerformance: performance })

    scheduler.enqueueBatch([event('PACK-01-EQ-01', 'alarm')])
    vi.advanceTimersByTime(0)
    scheduler.enqueueBatch([event('PACK-01-EQ-01', 'alarm', 2)])
    vi.advanceTimersByTime(250)
    expect(sceneBatches).toHaveLength(1)
    expect(metrics).toHaveBeenCalledTimes(1)
    expect(metrics.mock.calls[0]?.[0].lineMetrics).toHaveLength(6)

    vi.advanceTimersByTime(750)
    expect(charts).toHaveBeenCalledTimes(1)
    expect(performance).toHaveBeenCalledTimes(1)
    expect(performance.mock.calls[0]?.[0]).toMatchObject({
      eventsPerSecond: 2,
      sceneBatchesPerSecond: 1,
      gpuUploadsPerSecond: 2,
      kpiUpdatesPerSecond: 4,
      chartUpdatesPerSecond: 1,
    })

    scheduler.enqueueBatch([event('PACK-01-EQ-01', 'normal', 3)])
    vi.advanceTimersByTime(0)
    scheduler.enqueueBatch([event('PACK-01-EQ-01', 'alarm', 4)])
    vi.advanceTimersByTime(0)
    expect(sceneBatches).toHaveLength(3)
    scheduler.dispose()
  })
})

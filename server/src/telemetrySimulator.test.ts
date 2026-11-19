import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSimulatorFromEnvironment, TelemetrySimulator } from './telemetrySimulator.js'

describe('TelemetrySimulator', () => {
  afterEach(() => vi.useRealTimers())

  it('emits a bounded batch with the shared telemetry shape', () => {
    vi.useFakeTimers()
    const simulator = new TelemetrySimulator({ deviceCount: 6, batchSize: 4, intervalMs: 50 })
    const batches: Array<readonly unknown[]> = []
    simulator.subscribe((events) => batches.push(events))

    simulator.start()
    vi.advanceTimersByTime(50)
    simulator.stop()

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(4)
    expect(batches[0]?.[0]).toMatchObject({
      deviceId: expect.stringMatching(/^PACK-01-EQ-/),
      status: expect.stringMatching(/^(normal|idle|alarm)$/),
      timestamp: expect.any(Number),
    })
  })

  it('applies a periodic burst without reallocating the normal batch size', () => {
    vi.useFakeTimers()
    const simulator = new TelemetrySimulator({
      deviceCount: 6, batchSize: 2, intervalMs: 50, seed: 7,
      burstEveryMs: 100, burstDurationMs: 50, burstMultiplier: 3,
    })
    const batchSizes: number[] = []
    simulator.subscribe((events) => batchSizes.push(events.length))

    simulator.start()
    vi.advanceTimersByTime(100)
    const stats = simulator.getStats()
    simulator.stop()

    expect(batchSizes).toEqual([2, 6])
    expect(stats).toMatchObject({ emittedEvents: 8, emittedBatches: 2, burstActive: true })
  })

  it('loads a repeatable load profile from environment settings', () => {
    const simulator = createSimulatorFromEnvironment({
      SIMULATOR_PROFILE: 'load', SIMULATOR_SEED: '42', SIMULATOR_BATCH_SIZE: '400',
    })

    expect(simulator.getStats()).toMatchObject({
      profile: 'load', deviceCount: 1_000, batchSize: 400, intervalMs: 50, seed: 42,
    })
  })
})

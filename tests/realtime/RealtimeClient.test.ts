import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockWebSocket } from '../../src/core/realtime/MockWebSocket'
import { RealtimeClient } from '../../src/core/realtime/RealtimeClient'
import { StreamScheduler } from '../../src/core/realtime/StreamScheduler'
import type { RealtimeConnectionStatus } from '../../src/types'

describe('RealtimeClient', () => {
  afterEach(() => vi.useRealTimers())

  it('reconnects after an unclean automatic disconnect and stops permanently', () => {
    vi.useFakeTimers()
    const statuses: RealtimeConnectionStatus[] = []
    const scheduler = new StreamScheduler({
      onSceneBatch: () => undefined,
      onMetrics: () => undefined,
      onChartPoint: () => undefined,
    })
    const client = new RealtimeClient({
      scheduler,
      onStatusChange: (status) => statuses.push(status),
      socketFactory: () => new MockWebSocket({ connectDelayMs: 0, disconnectAfterMs: 100 }),
      reconnectDelaysMs: [1_000, 2_000, 4_000, 8_000],
    })

    client.start()
    vi.advanceTimersByTime(1)
    expect(statuses.at(-1)).toBe('connected')
    vi.advanceTimersByTime(100)
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(1_000)
    expect(statuses.at(-1)).toBe('connected')

    client.stop()
    const statusCountAfterStop = statuses.length
    vi.advanceTimersByTime(10_000)
    expect(statuses).toHaveLength(statusCountAfterStop)
    expect(statuses.at(-1)).toBe('disconnected')
    scheduler.dispose()
  })
})

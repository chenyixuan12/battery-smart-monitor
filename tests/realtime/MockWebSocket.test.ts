import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockMessageEvent, MockWebSocket } from '../../src/core/realtime/MockWebSocket'

describe('MockWebSocket', () => {
  afterEach(() => vi.useRealTimers())

  it('emits about 4000 telemetry events per second with a reused buffer', () => {
    vi.useFakeTimers()
    const socket = new MockWebSocket({ connectDelayMs: 0, disconnectAfterMs: 0 })
    let eventCount = 0
    let firstBuffer: unknown = null
    let reusedBuffer = false
    socket.addEventListener('message', (event) => {
      const buffer = (event as MockMessageEvent).data
      eventCount += buffer.length
      if (!firstBuffer) firstBuffer = buffer
      else reusedBuffer ||= firstBuffer === buffer
    })

    socket.connect()
    vi.advanceTimersByTime(1_000)

    expect(eventCount).toBe(4_000)
    expect(reusedBuffer).toBe(true)
    socket.close()
  })
})

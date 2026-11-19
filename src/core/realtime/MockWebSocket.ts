import type { AlarmSeverity, DefectCategory, DeviceStatus, DeviceTelemetryEvent } from '../../types'
import { RealtimeCloseEvent, RealtimeMessageEvent } from './RealtimeSocket'

export { RealtimeCloseEvent as MockCloseEvent, RealtimeMessageEvent as MockMessageEvent } from './RealtimeSocket'

const defectCategories: DefectCategory[] = ['焊接不良', '气密不良', '尺寸异常', '电压异常', '外观缺陷']

export interface MockWebSocketOptions {
  deviceCount?: number
  batchSize?: number
  intervalMs?: number
  connectDelayMs?: number
  disconnectAfterMs?: number
}

interface MockDeviceState {
  deviceId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
  temperature: number
  voltage: number
  current: number
  oee: number
}

/** In-memory WebSocket-compatible device gateway with a reusable message buffer. */
export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = MockWebSocket.CLOSED

  private readonly deviceStates: MockDeviceState[]
  private readonly eventBuffer: DeviceTelemetryEvent[]
  private readonly batchSize: number
  private readonly intervalMs: number
  private readonly connectDelayMs: number
  private readonly disconnectAfterMs: number
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private streamTimer: ReturnType<typeof setInterval> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private deviceCursor = 0

  constructor(options: MockWebSocketOptions = {}) {
    super()
    const deviceCount = options.deviceCount ?? 180
    this.batchSize = options.batchSize ?? 200
    this.intervalMs = options.intervalMs ?? 50
    this.connectDelayMs = options.connectDelayMs ?? 350
    this.disconnectAfterMs = options.disconnectAfterMs ?? 30_000
    this.deviceStates = this.createDeviceStates(deviceCount)
    this.eventBuffer = Array.from({ length: this.batchSize }, () => ({
      deviceId: '', status: 'normal', temperature: 25, voltage: 3.7, current: 80,
      oee: 86, outputDelta: 0, qualifiedDelta: 0, reworkDelta: 0,
      scrapDelta: 0, energyDelta: 0, timestamp: 0,
    }))
  }

  connect(): void {
    if (this.readyState === MockWebSocket.CONNECTING || this.readyState === MockWebSocket.OPEN) return
    this.readyState = MockWebSocket.CONNECTING
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (this.readyState !== MockWebSocket.CONNECTING) return
      this.readyState = MockWebSocket.OPEN
      this.dispatchEvent(new Event('open'))
      this.streamTimer = setInterval(() => this.emitBatch(), this.intervalMs)
      if (this.disconnectAfterMs > 0) {
        this.disconnectTimer = setTimeout(() => this.dropConnection(), this.disconnectAfterMs)
      }
    }, this.connectDelayMs)
  }

  close(code = 1000, reason = 'client closed'): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSING
    this.clearTimers()
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new RealtimeCloseEvent(code, reason, code === 1000))
  }

  private emitBatch(): void {
    if (this.readyState !== MockWebSocket.OPEN) return
    const timestamp = Date.now()
    for (let index = 0; index < this.batchSize; index += 1) {
      const state = this.deviceStates[this.deviceCursor % this.deviceStates.length]!
      this.deviceCursor += 1
      this.maybeTransitionStatus(state)
      state.temperature = this.clamp(state.temperature + (Math.random() - 0.5) * 0.28, 20, 58)
      state.voltage = this.clamp(state.voltage + (Math.random() - 0.5) * 0.018, 3.2, 4.25)
      state.current = this.clamp(state.current + (Math.random() - 0.5) * 1.6, 45, 130)
      state.oee = this.clamp(state.oee + (Math.random() - 0.5) * 0.45, 68, 99.5)

      const outputDelta = Math.random() < 0.07 ? 1 : 0
      const qualityRoll = Math.random()
      const event = this.eventBuffer[index]!
      event.deviceId = state.deviceId
      event.status = state.status
      event.alarmSeverity = state.alarmSeverity
      event.temperature = state.temperature
      event.voltage = state.voltage
      event.current = state.current
      event.oee = state.oee
      event.outputDelta = outputDelta
      event.qualifiedDelta = outputDelta && qualityRoll < 0.9862 ? 1 : 0
      event.reworkDelta = outputDelta && qualityRoll >= 0.9862 && qualityRoll < 0.997 ? 1 : 0
      event.scrapDelta = outputDelta && qualityRoll >= 0.997 ? 1 : 0
      event.energyDelta = state.status === 'normal' ? 0.0007 + Math.random() * 0.0005 : 0.0002
      event.defectType = event.reworkDelta || event.scrapDelta
        ? defectCategories[Math.floor(Math.random() * defectCategories.length)]
        : undefined
      event.timestamp = timestamp
    }
    this.dispatchEvent(new RealtimeMessageEvent(this.eventBuffer))
  }

  private maybeTransitionStatus(state: MockDeviceState): void {
    if (Math.random() >= 0.002) return
    const roll = Math.random()
    state.status = roll < 0.94 ? 'normal' : roll < 0.98 ? 'idle' : 'alarm'
    state.alarmSeverity = state.status === 'alarm'
      ? (Math.random() < 0.2 ? 'critical' : 'warning')
      : undefined
  }

  private createDeviceStates(count: number): MockDeviceState[] {
    return Array.from({ length: count }, (_, index) => {
      const lineIndex = Math.floor(index / 30)
      const stationIndex = index % 30
      const status: DeviceStatus = lineIndex === 2 && stationIndex === 3
        ? 'alarm'
        : (lineIndex + stationIndex) % 9 === 0 ? 'idle' : 'normal'
      return {
        deviceId: `PACK-${String(lineIndex + 1).padStart(2, '0')}-EQ-${String(stationIndex + 1).padStart(2, '0')}`,
        status,
        alarmSeverity: status === 'alarm' ? 'critical' : undefined,
        temperature: 28 + Math.random() * 8,
        voltage: 3.55 + Math.random() * 0.35,
        current: 70 + Math.random() * 25,
        oee: 82 + Math.random() * 10,
      }
    })
  }

  private dropConnection(): void {
    if (this.readyState !== MockWebSocket.OPEN) return
    this.clearTimers()
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new RealtimeCloseEvent(1006, 'simulated network interruption', false))
  }

  private clearTimers(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.streamTimer) clearInterval(this.streamTimer)
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer)
    this.connectTimer = null
    this.streamTimer = null
    this.disconnectTimer = null
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }
}

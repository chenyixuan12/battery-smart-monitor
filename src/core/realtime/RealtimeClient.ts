import type { RealtimeConnectionStatus } from '../../types'
import { BrowserWebSocket } from './BrowserWebSocket'
import { RealtimeCloseEvent, RealtimeMessageEvent } from './RealtimeSocket'
import type { RealtimeSocket } from './RealtimeSocket'
import type { StreamScheduler } from './StreamScheduler'

export interface RealtimeClientOptions {
  scheduler: StreamScheduler
  onStatusChange: (status: RealtimeConnectionStatus) => void
  onReconnectCount?: (count: number) => void
  socketFactory?: () => RealtimeSocket
  reconnectDelaysMs?: readonly number[]
}

/** Owns socket replacement and bounded exponential reconnect scheduling. */
export class RealtimeClient {
  private readonly scheduler: StreamScheduler
  private readonly onStatusChange: RealtimeClientOptions['onStatusChange']
  private readonly socketFactory: () => RealtimeSocket
  private readonly onReconnectCount: RealtimeClientOptions['onReconnectCount']
  private readonly reconnectDelaysMs: readonly number[]
  private socket: RealtimeSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private stopped = true
  private reconnectCount = 0

  constructor(options: RealtimeClientOptions) {
    this.scheduler = options.scheduler
    this.onStatusChange = options.onStatusChange
    this.socketFactory = options.socketFactory ?? (() => new BrowserWebSocket(import.meta.env.VITE_REALTIME_URL ?? 'ws://localhost:3001/ws/telemetry'))
    this.onReconnectCount = options.onReconnectCount
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [1_000, 2_000, 4_000, 8_000]
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.reconnectAttempt = 0
    this.reconnectCount = 0
    this.onReconnectCount?.(0)
    this.openSocket('connecting')
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.detachSocket()
    this.socket?.close(1000, 'realtime client stopped')
    this.socket = null
    this.onStatusChange('disconnected')
  }

  private openSocket(status: RealtimeConnectionStatus): void {
    if (this.stopped) return
    this.onStatusChange(status)
    const socket = this.socketFactory()
    this.socket = socket
    socket.addEventListener('open', this.handleOpen)
    socket.addEventListener('message', this.handleMessage)
    socket.addEventListener('close', this.handleClose)
    socket.addEventListener('error', this.handleError)
    socket.connect()
  }

  private readonly handleOpen = (): void => {
    this.reconnectAttempt = 0
    this.onStatusChange('connected')
  }

  private readonly handleMessage = (event: Event): void => {
    this.scheduler.enqueueBatch((event as RealtimeMessageEvent).data)
  }

  private readonly handleClose = (event: Event): void => {
    const closeEvent = event as RealtimeCloseEvent
    this.detachSocket()
    this.socket = null
    if (this.stopped || closeEvent.wasClean) return
    this.scheduleReconnect()
  }

  private readonly handleError = (): void => {
    if (this.stopped) return
    this.socket?.close(1006, 'mock transport error')
  }

  private scheduleReconnect(): void {
    this.onStatusChange('reconnecting')
    this.reconnectCount += 1
    this.onReconnectCount?.(this.reconnectCount)
    const delayIndex = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
    const delay = this.reconnectDelaysMs[delayIndex] ?? 8_000
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket('reconnecting')
    }, delay)
  }

  private detachSocket(): void {
    this.socket?.removeEventListener('open', this.handleOpen)
    this.socket?.removeEventListener('message', this.handleMessage)
    this.socket?.removeEventListener('close', this.handleClose)
    this.socket?.removeEventListener('error', this.handleError)
  }
}

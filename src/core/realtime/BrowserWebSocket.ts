import type { DeviceTelemetryEvent } from '../../../shared/telemetry'
import { RealtimeCloseEvent, RealtimeMessageEvent } from './RealtimeSocket'
import type { RealtimeSocket } from './RealtimeSocket'

/** Adapts the browser WebSocket API to the transport used by RealtimeClient. */
export class BrowserWebSocket extends EventTarget implements RealtimeSocket {
  private socket: WebSocket | null = null

  constructor(private readonly url: string) {
    super()
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.addEventListener('open', () => this.dispatchEvent(new Event('open')))
    socket.addEventListener('message', (event) => this.handleMessage(event))
    socket.addEventListener('close', (event) => {
      this.socket = null
      this.dispatchEvent(new RealtimeCloseEvent(event.code, event.reason, event.wasClean))
    })
    socket.addEventListener('error', () => this.dispatchEvent(new Event('error')))
  }

  close(code = 1000, reason = 'client closed'): void {
    this.socket?.close(code, reason)
    this.socket = null
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (!Array.isArray(data)) return
      this.dispatchEvent(new RealtimeMessageEvent(data as DeviceTelemetryEvent[]))
    } catch {
      this.dispatchEvent(new Event('error'))
    }
  }
}

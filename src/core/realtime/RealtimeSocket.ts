import type { DeviceTelemetryEvent } from '../../../shared/telemetry'

export interface RealtimeSocket extends EventTarget {
  connect(): void
  close(code?: number, reason?: string): void
}

export class RealtimeMessageEvent extends Event {
  constructor(readonly data: readonly DeviceTelemetryEvent[]) {
    super('message')
  }
}

export class RealtimeCloseEvent extends Event {
  constructor(readonly code: number, readonly reason: string, readonly wasClean: boolean) {
    super('close')
  }
}

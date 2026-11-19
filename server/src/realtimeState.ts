import type { AlarmSeverity, DefectCategory, DeviceStatus, DeviceTelemetryEvent } from '../../shared/telemetry.js'

export interface DeviceSnapshot {
  deviceId: string
  lineId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
  temperature: number
  voltage: number
  current: number
  oee: number
  lastSeenAt: number
}

export interface LineMetrics {
  lineId: string
  lineName: string
  output: number
  yieldRate: number
  averageOee: number
  energyKwh: number
  deviceCount: number
}

export interface AlarmSnapshot extends DeviceSnapshot {
  ageMs: number
}

export interface RealtimeOverview {
  deviceCount: number
  statusCounts: Record<DeviceStatus, number>
  alarmCount: number
  averageOee: number
  yieldRate: number
  totalOutput: number
  quality: { qualified: number; rework: number; scrap: number }
  totalEnergyKwh: number
  defects: Array<{ category: DefectCategory; count: number }>
  lineMetrics: LineMetrics[]
  eventRate: number
  totalEvents: number
  lastSyncAt: number | null
}

export interface RuntimeStats {
  eventRate: number
  totalEvents: number
  lastSyncAt: number | null
  deviceCount: number
  broadcastBatchCount: number
  slowClientSkippedBatches: number
  lastBatchSize: number
  lastIngestMs: number
  maxIngestMs: number
}

export interface RealtimeStateOptions {
  maxDevices?: number
  maxLines?: number
}

const defectCategories: readonly DefectCategory[] = ['焊接不良', '气密不良', '尺寸异常', '电压异常', '外观缺陷']

interface MutableLineState {
  output: number
  qualified: number
  rework: number
  scrap: number
  energyKwh: number
  oeeTotal: number
  oeeSamples: number
  deviceIds: Set<string>
}

export class RealtimeState {
  private readonly maxDevices: number
  private readonly maxLines: number
  private readonly devices = new Map<string, DeviceSnapshot>()
  private readonly lines = new Map<string, MutableLineState>()
  private readonly defects = new Map<DefectCategory, number>(defectCategories.map((category) => [category, 0]))
  private totalOutput = 0
  private qualified = 0
  private rework = 0
  private scrap = 0
  private totalEnergyKwh = 0
  private totalEvents = 0
  private rateWindowEvents = 0
  private rateWindowStartedAt = Date.now()
  private lastSyncAt: number | null = null
  private broadcastBatchCount = 0
  private slowClientSkippedBatches = 0
  private lastBatchSize = 0
  private lastIngestMs = 0
  private maxIngestMs = 0

  constructor(options: RealtimeStateOptions = {}) {
    this.maxDevices = options.maxDevices ?? 10_000
    this.maxLines = options.maxLines ?? 500
  }

  ingest(events: readonly DeviceTelemetryEvent[]): void {
    const startedAt = performance.now()
    for (const event of events) {
      const lineId = event.deviceId.slice(0, 7)
      if (!/^PACK-\d+-EQ-\d+$/.test(event.deviceId) || event.deviceId.length > 40) continue
      if (!this.devices.has(event.deviceId) && this.devices.size >= this.maxDevices) {
        this.evictOldestDevice()
      }
      if (!this.lines.has(lineId) && this.lines.size >= this.maxLines) continue
      const snapshot: DeviceSnapshot = {
        deviceId: event.deviceId,
        lineId,
        status: event.status,
        alarmSeverity: event.alarmSeverity,
        temperature: event.temperature,
        voltage: event.voltage,
        current: event.current,
        oee: event.oee,
        lastSeenAt: event.timestamp,
      }
      this.devices.set(event.deviceId, snapshot)

      const line = this.lines.get(lineId) ?? {
        output: 0, qualified: 0, rework: 0, scrap: 0, energyKwh: 0,
        oeeTotal: 0, oeeSamples: 0, deviceIds: new Set<string>(),
      }
      line.deviceIds.add(event.deviceId)
      line.output += event.outputDelta
      line.qualified += event.qualifiedDelta
      line.rework += event.reworkDelta
      line.scrap += event.scrapDelta
      line.energyKwh += event.energyDelta
      line.oeeTotal += event.oee
      line.oeeSamples += 1
      this.lines.set(lineId, line)

      this.totalOutput += event.outputDelta
      this.qualified += event.qualifiedDelta
      this.rework += event.reworkDelta
      this.scrap += event.scrapDelta
      this.totalEnergyKwh += event.energyDelta
      if (event.defectType) this.defects.set(event.defectType, (this.defects.get(event.defectType) ?? 0) + 1)
      this.totalEvents += 1
      this.rateWindowEvents += 1
      this.lastSyncAt = event.timestamp
    }
    this.lastBatchSize = events.length
    this.lastIngestMs = performance.now() - startedAt
    this.maxIngestMs = Math.max(this.maxIngestMs, this.lastIngestMs)
  }

  markBroadcastBatch(): void {
    this.broadcastBatchCount += 1
  }

  markSlowClientSkippedBatches(count: number): void {
    this.slowClientSkippedBatches += count
  }

  getOverview(): RealtimeOverview {
    const statusCounts: Record<DeviceStatus, number> = { normal: 0, idle: 0, alarm: 0 }
    let oeeTotal = 0
    for (const device of this.devices.values()) {
      statusCounts[device.status] += 1
      oeeTotal += device.oee
    }
    const totalQuality = this.qualified + this.rework + this.scrap
    return {
      deviceCount: this.devices.size,
      statusCounts,
      alarmCount: statusCounts.alarm,
      averageOee: this.devices.size > 0 ? oeeTotal / this.devices.size : 0,
      yieldRate: totalQuality > 0 ? this.qualified / totalQuality * 100 : 100,
      totalOutput: this.totalOutput,
      quality: { qualified: this.qualified, rework: this.rework, scrap: this.scrap },
      totalEnergyKwh: this.totalEnergyKwh,
      defects: defectCategories.map((category) => ({ category, count: this.defects.get(category) ?? 0 })),
      lineMetrics: this.getLineMetrics(),
      eventRate: this.getEventRate(),
      totalEvents: this.totalEvents,
      lastSyncAt: this.lastSyncAt,
    }
  }

  getLineMetrics(lineId?: string): LineMetrics[] {
    const entries = Array.from(this.lines.entries())
      .filter(([id]) => !lineId || id === lineId)
      .sort(([left], [right]) => left.localeCompare(right))
    return entries.map(([id, line]) => {
      const qualityTotal = line.qualified + line.rework + line.scrap
      return {
        lineId: id,
        lineName: id.replace('-', ' '),
        output: line.output,
        yieldRate: qualityTotal > 0 ? line.qualified / qualityTotal * 100 : 100,
        averageOee: line.oeeSamples > 0 ? line.oeeTotal / line.oeeSamples : 0,
        energyKwh: line.energyKwh,
        deviceCount: line.deviceIds.size,
      }
    })
  }

  getDevice(deviceId: string): DeviceSnapshot | null {
    return this.devices.get(deviceId) ?? null
  }

  /** Read-only device snapshots for anomaly detection and diagnostics. */
  getDevices(): readonly DeviceSnapshot[] {
    return [...this.devices.values()]
  }

  getAlarms(): AlarmSnapshot[] {
    const now = Date.now()
    return Array.from(this.devices.values())
      .filter((device) => device.status === 'alarm')
      .sort((left, right) => (right.alarmSeverity === 'critical' ? 1 : 0) - (left.alarmSeverity === 'critical' ? 1 : 0))
      .map((device) => ({ ...device, ageMs: Math.max(0, now - device.lastSeenAt) }))
  }

  getRuntimeStats(): RuntimeStats {
    return {
      eventRate: this.getEventRate(),
      totalEvents: this.totalEvents,
      lastSyncAt: this.lastSyncAt,
      deviceCount: this.devices.size,
      broadcastBatchCount: this.broadcastBatchCount,
      slowClientSkippedBatches: this.slowClientSkippedBatches,
      lastBatchSize: this.lastBatchSize,
      lastIngestMs: this.lastIngestMs,
      maxIngestMs: this.maxIngestMs,
    }
  }

  private getEventRate(): number {
    const elapsedMs = Math.max(Date.now() - this.rateWindowStartedAt, 1)
    return Math.round(this.rateWindowEvents * 1_000 / elapsedMs)
  }

  private evictOldestDevice(): void {
    let oldestId: string | null = null
    let oldestTimestamp = Number.POSITIVE_INFINITY
    for (const [deviceId, device] of this.devices) {
      if (device.lastSeenAt < oldestTimestamp) {
        oldestId = deviceId
        oldestTimestamp = device.lastSeenAt
      }
    }
    if (!oldestId) return
    const lineId = this.devices.get(oldestId)?.lineId
    this.devices.delete(oldestId)
    if (!lineId) return
    const line = this.lines.get(lineId)
    if (!line) return
    line.deviceIds.delete(oldestId)
  }
}

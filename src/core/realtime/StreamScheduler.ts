import type {
  AlarmSeverity,
  CapacityTrendPoint,
  DefectCategory,
  DeviceHistoryPoint,
  DeviceStatus,
  DeviceStatusPatch,
  DeviceTelemetryEvent,
  RealtimeMetricsSnapshot,
  StreamPerformanceSample,
} from '../../types'

interface DeviceRealtimeState {
  deviceId: string
  lineId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
  temperature: number
  voltage: number
  current: number
  oee: number
  timestamp: number
}

export interface StreamSchedulerOptions {
  onSceneBatch: (patches: readonly DeviceStatusPatch[]) => void
  onMetrics: (snapshot: RealtimeMetricsSnapshot) => void
  onChartPoint: (point: CapacityTrendPoint) => void
  onOeePoint?: (point: CapacityTrendPoint) => void
  onEnergyPoint?: (point: CapacityTrendPoint) => void
  getSelectedDeviceId?: () => string | null
  onDeviceHistoryPoint?: (point: DeviceHistoryPoint) => void
  onPerformance?: (sample: StreamPerformanceSample) => void
  metricsIntervalMs?: number
  chartIntervalMs?: number
  initialOutput?: number
  initialQuality?: { qualified: number; rework: number; scrap: number }
}

/** Latest-wins scheduler that keeps high-frequency device state outside Vue reactivity. */
export class StreamScheduler {
  private readonly states = new Map<string, DeviceRealtimeState>()
  private readonly pendingDeviceIds = new Set<string>()
  private readonly renderedStatus = new Map<string, string>()
  private readonly onSceneBatch: StreamSchedulerOptions['onSceneBatch']
  private readonly onMetrics: StreamSchedulerOptions['onMetrics']
  private readonly onChartPoint: StreamSchedulerOptions['onChartPoint']
  private readonly onOeePoint: StreamSchedulerOptions['onOeePoint']
  private readonly onEnergyPoint: StreamSchedulerOptions['onEnergyPoint']
  private readonly getSelectedDeviceId: StreamSchedulerOptions['getSelectedDeviceId']
  private readonly onDeviceHistoryPoint: StreamSchedulerOptions['onDeviceHistoryPoint']
  private readonly onPerformance: StreamSchedulerOptions['onPerformance']
  private readonly metricsTimer: ReturnType<typeof setInterval>
  private readonly chartTimer: ReturnType<typeof setInterval>
  private readonly performanceTimer: ReturnType<typeof setInterval>
  private frameId: number | ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private eventCountWindow = 0
  private eventRate = 0
  private rateWindowStartedAt = performance.now()
  private lastSyncAt: number | null = null
  private totalOutput: number
  private intervalOutput = 0
  private totalEnergyKwh = 3_260
  private intervalEnergyKwh = 0
  private qualified: number
  private rework: number
  private scrap: number
  private mergedDeviceCountWindow = 0
  private statusUpdateCountWindow = 0
  private sceneBatchCountWindow = 0
  private kpiUpdateCountWindow = 0
  private chartUpdateCountWindow = 0
  private maxPendingDevicesWindow = 0
  private latestAverageOee = 86.4
  private readonly lineOutput = new Map<string, number>()
  private readonly lineEnergy = new Map<string, number>()
  private readonly lineQuality = new Map<string, { qualified: number; rework: number; scrap: number }>()
  private readonly defectCounts = new Map<DefectCategory, number>([
    ['焊接不良', 42], ['气密不良', 28], ['尺寸异常', 18], ['电压异常', 14], ['外观缺陷', 9],
  ])

  constructor(options: StreamSchedulerOptions) {
    this.onSceneBatch = options.onSceneBatch
    this.onMetrics = options.onMetrics
    this.onChartPoint = options.onChartPoint
    this.onOeePoint = options.onOeePoint
    this.onEnergyPoint = options.onEnergyPoint
    this.getSelectedDeviceId = options.getSelectedDeviceId
    this.onDeviceHistoryPoint = options.onDeviceHistoryPoint
    this.onPerformance = options.onPerformance
    this.totalOutput = options.initialOutput ?? 12_486
    this.qualified = options.initialQuality?.qualified ?? 9_862
    this.rework = options.initialQuality?.rework ?? 108
    this.scrap = options.initialQuality?.scrap ?? 30
    for (let index = 0; index < 6; index += 1) {
      const lineId = `PACK-${String(index + 1).padStart(2, '0')}`
      this.lineOutput.set(lineId, Math.floor(this.totalOutput / 6) + (index < this.totalOutput % 6 ? 1 : 0))
      this.lineEnergy.set(lineId, this.totalEnergyKwh / 6)
      this.lineQuality.set(lineId, {
        qualified: Math.floor(this.qualified / 6) + (index < this.qualified % 6 ? 1 : 0),
        rework: Math.floor(this.rework / 6) + (index < this.rework % 6 ? 1 : 0),
        scrap: Math.floor(this.scrap / 6) + (index < this.scrap % 6 ? 1 : 0),
      })
    }
    this.metricsTimer = setInterval(() => this.emitMetrics(), options.metricsIntervalMs ?? 250)
    this.chartTimer = setInterval(() => this.emitChartPoint(), options.chartIntervalMs ?? 1_000)
    this.performanceTimer = setInterval(() => this.emitPerformance(), 1_000)
  }

  enqueueBatch(events: readonly DeviceTelemetryEvent[]): void {
    if (this.disposed) return
    for (const event of events) {
      let state = this.states.get(event.deviceId)
      if (!state) {
        state = {
          deviceId: event.deviceId, lineId: event.deviceId.slice(0, 7), status: event.status, temperature: event.temperature,
          voltage: event.voltage, current: event.current, oee: event.oee, timestamp: event.timestamp,
        }
        this.states.set(event.deviceId, state)
      }
      state.status = event.status
      state.alarmSeverity = event.alarmSeverity
      state.temperature = event.temperature
      state.voltage = event.voltage
      state.current = event.current
      state.oee = event.oee
      state.timestamp = event.timestamp
      this.pendingDeviceIds.add(event.deviceId)
      this.totalOutput += event.outputDelta
      this.intervalOutput += event.outputDelta
      this.qualified += event.qualifiedDelta
      this.rework += event.reworkDelta
      this.scrap += event.scrapDelta
      this.totalEnergyKwh += event.energyDelta
      this.intervalEnergyKwh += event.energyDelta
      const lineId = state.lineId
      this.lineOutput.set(lineId, (this.lineOutput.get(lineId) ?? 0) + event.outputDelta)
      this.lineEnergy.set(lineId, (this.lineEnergy.get(lineId) ?? 0) + event.energyDelta)
      const lineQuality = this.lineQuality.get(lineId) ?? { qualified: 0, rework: 0, scrap: 0 }
      lineQuality.qualified += event.qualifiedDelta
      lineQuality.rework += event.reworkDelta
      lineQuality.scrap += event.scrapDelta
      this.lineQuality.set(lineId, lineQuality)
      if (event.defectType) this.defectCounts.set(event.defectType, (this.defectCounts.get(event.defectType) ?? 0) + 1)
      this.lastSyncAt = event.timestamp
      this.eventCountWindow += 1
    }
    this.maxPendingDevicesWindow = Math.max(this.maxPendingDevicesWindow, this.pendingDeviceIds.size)
    this.scheduleFrame()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.metricsTimer)
    clearInterval(this.chartTimer)
    clearInterval(this.performanceTimer)
    if (this.frameId !== null) this.cancelFrame(this.frameId)
    this.frameId = null
    this.pendingDeviceIds.clear()
    this.states.clear()
  }

  private scheduleFrame(): void {
    if (this.frameId !== null) return
    if (typeof requestAnimationFrame === 'function') {
      this.frameId = requestAnimationFrame(() => this.flushScene())
    } else {
      this.frameId = setTimeout(() => this.flushScene(), 0)
    }
  }

  private flushScene(): void {
    this.frameId = null
    if (this.disposed) return
    const patches: DeviceStatusPatch[] = []
    this.mergedDeviceCountWindow += this.pendingDeviceIds.size
    for (const deviceId of this.pendingDeviceIds) {
      const state = this.states.get(deviceId)
      if (!state) continue
      const signature = `${state.status}:${state.alarmSeverity ?? ''}`
      if (this.renderedStatus.get(deviceId) === signature) continue
      this.renderedStatus.set(deviceId, signature)
      patches.push({ deviceId, status: state.status, alarmSeverity: state.alarmSeverity })
    }
    this.pendingDeviceIds.clear()
    this.statusUpdateCountWindow += patches.length
    if (patches.length > 0) {
      this.sceneBatchCountWindow += 1
      this.onSceneBatch(patches)
    }
  }

  private emitMetrics(): void {
    if (this.disposed || this.states.size === 0) return
    const statusCounts: Record<DeviceStatus, number> = { normal: 0, idle: 0, alarm: 0 }
    let oeeTotal = 0
    const lineOee = new Map<string, { total: number; count: number }>()
    for (const state of this.states.values()) {
      statusCounts[state.status] += 1
      oeeTotal += state.oee
      const aggregate = lineOee.get(state.lineId) ?? { total: 0, count: 0 }
      aggregate.total += state.oee
      aggregate.count += 1
      lineOee.set(state.lineId, aggregate)
    }
    this.latestAverageOee = oeeTotal / this.states.size
    const qualityTotal = this.qualified + this.rework + this.scrap
    const lineMetrics = Array.from({ length: 6 }, (_, index) => {
      const lineId = `PACK-${String(index + 1).padStart(2, '0')}`
      const quality = this.lineQuality.get(lineId) ?? { qualified: 0, rework: 0, scrap: 0 }
      const lineQualityTotal = quality.qualified + quality.rework + quality.scrap
      const oee = lineOee.get(lineId)
      return {
        lineId,
        lineName: `PACK ${String(index + 1).padStart(2, '0')}`,
        output: this.lineOutput.get(lineId) ?? 0,
        yieldRate: lineQualityTotal > 0 ? quality.qualified / lineQualityTotal * 100 : 100,
        averageOee: oee ? oee.total / oee.count : 0,
        energyKwh: this.lineEnergy.get(lineId) ?? 0,
      }
    })
    this.onMetrics({
      statusCounts,
      averageOee: this.latestAverageOee,
      yieldRate: qualityTotal > 0 ? this.qualified / qualityTotal * 100 : 100,
      totalOutput: this.totalOutput,
      quality: { qualified: this.qualified, rework: this.rework, scrap: this.scrap },
      lineMetrics,
      totalEnergyKwh: this.totalEnergyKwh,
      defects: Array.from(this.defectCounts, ([category, count]) => ({ category, count })),
      eventRate: this.eventRate,
      lastSyncAt: this.lastSyncAt,
    })
    this.kpiUpdateCountWindow += 1
  }

  private emitChartPoint(): void {
    if (this.disposed) return
    const timestamp = Date.now()
    this.onChartPoint({ timestamp, value: this.intervalOutput })
    this.onOeePoint?.({ timestamp, value: this.latestAverageOee })
    this.onEnergyPoint?.({ timestamp, value: this.intervalEnergyKwh })
    const selectedDeviceId = this.getSelectedDeviceId?.()
    const selectedState = selectedDeviceId ? this.states.get(selectedDeviceId) : undefined
    if (selectedState) {
      this.onDeviceHistoryPoint?.({
        deviceId: selectedState.deviceId,
        timestamp,
        oee: selectedState.oee,
        temperature: selectedState.temperature,
        voltage: selectedState.voltage,
        current: selectedState.current,
      })
    }
    this.intervalOutput = 0
    this.intervalEnergyKwh = 0
    this.chartUpdateCountWindow += 1
  }

  private emitPerformance(): void {
    if (this.disposed) return
    const now = performance.now()
    const elapsed = Math.max(now - this.rateWindowStartedAt, 1)
    const rateFactor = 1_000 / elapsed
    this.eventRate = Math.round(this.eventCountWindow * rateFactor)
    const mergedDevicesPerSecond = Math.round(this.mergedDeviceCountWindow * rateFactor)
    const sceneBatchesPerSecond = Math.round(this.sceneBatchCountWindow * rateFactor)
    this.onPerformance?.({
      eventsPerSecond: this.eventRate,
      mergedDevicesPerSecond,
      statusUpdatesPerSecond: Math.round(this.statusUpdateCountWindow * rateFactor),
      sceneBatchesPerSecond,
      gpuUploadsPerSecond: sceneBatchesPerSecond * 2,
      kpiUpdatesPerSecond: Math.round(this.kpiUpdateCountWindow * rateFactor),
      chartUpdatesPerSecond: Math.round(this.chartUpdateCountWindow * rateFactor),
      pendingDevices: this.pendingDeviceIds.size,
      maxPendingDevices: this.maxPendingDevicesWindow,
      mergeRatio: this.eventCountWindow > 0
        ? Math.max(0, 1 - this.mergedDeviceCountWindow / this.eventCountWindow)
        : 0,
    })
    this.eventCountWindow = 0
    this.mergedDeviceCountWindow = 0
    this.statusUpdateCountWindow = 0
    this.sceneBatchCountWindow = 0
    this.kpiUpdateCountWindow = 0
    this.chartUpdateCountWindow = 0
    this.maxPendingDevicesWindow = this.pendingDeviceIds.size
    this.rateWindowStartedAt = now
  }

  private cancelFrame(frameId: number | ReturnType<typeof setTimeout>): void {
    if (typeof cancelAnimationFrame === 'function' && typeof frameId === 'number') {
      cancelAnimationFrame(frameId)
    } else {
      clearTimeout(frameId)
    }
  }
}

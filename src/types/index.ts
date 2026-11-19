import type { AlarmSeverity, DefectCategory, DeviceStatus } from '../../shared/telemetry'

export type { AlarmSeverity, DefectCategory, DeviceStatus, DeviceTelemetryEvent } from '../../shared/telemetry'

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface DeviceStatusPatch {
  deviceId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
}

export interface CapacityTrendPoint {
  timestamp: number
  value: number
}

export interface QualityComposition {
  qualified: number
  rework: number
  scrap: number
}

export interface DefectStat {
  category: DefectCategory
  count: number
}

export interface LineRealtimeMetrics {
  lineId: string
  lineName: string
  output: number
  yieldRate: number
  averageOee: number
  energyKwh: number
}

export interface DeviceHistoryPoint {
  deviceId: string
  timestamp: number
  oee: number
  temperature: number
  voltage: number
  current: number
}

export interface RealtimeMetricsSnapshot {
  statusCounts: Record<DeviceStatus, number>
  averageOee: number
  yieldRate: number
  totalOutput: number
  quality: QualityComposition
  lineMetrics: LineRealtimeMetrics[]
  totalEnergyKwh: number
  defects: DefectStat[]
  eventRate: number
  lastSyncAt: number | null
}

export interface ScenePerformanceSample {
  fps: number
  averageFrameMs: number
  maxFrameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
}

export interface StreamPerformanceSample {
  eventsPerSecond: number
  mergedDevicesPerSecond: number
  statusUpdatesPerSecond: number
  sceneBatchesPerSecond: number
  gpuUploadsPerSecond: number
  kpiUpdatesPerSecond: number
  chartUpdatesPerSecond: number
  pendingDevices: number
  maxPendingDevices: number
  mergeRatio: number
}

export type ChartKind = 'capacity' | 'yield' | 'oee' | 'energy' | 'defects'

export interface KpiSummary {
  label: string
  value: string
  unit: string
  change: string
  tone: 'positive' | 'warning' | 'critical' | 'neutral'
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}


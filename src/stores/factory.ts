import { defineStore } from 'pinia'
import type {
  CapacityTrendPoint,
  DefectStat,
  DeviceHistoryPoint,
  DeviceStatus,
  KpiSummary,
  LineRealtimeMetrics,
  QualityComposition,
  RealtimeConnectionStatus,
  RealtimeMetricsSnapshot,
} from '../types'

interface FactoryState {
  connectionStatus: RealtimeConnectionStatus
  deviceCount: number
  alarmCount: number
  shift: string
  kpis: KpiSummary[]
  statusCounts: Record<DeviceStatus, number>
  selectedDeviceId: string | null
  eventRate: number
  lastSyncAt: number | null
  totalOutput: number
  yieldRate: number
  averageOee: number
  quality: QualityComposition
  capacityTrend: CapacityTrendPoint[]
  oeeTrend: CapacityTrendPoint[]
  energyTrend: CapacityTrendPoint[]
  lineMetrics: LineRealtimeMetrics[]
  defects: DefectStat[]
  totalEnergyKwh: number
  selectedDeviceHistoryId: string | null
  selectedDeviceHistory: DeviceHistoryPoint[]
}

const now = Date.now()
const initialCapacityValues = [12, 14, 13, 15, 12, 16, 14, 15]

export const useFactoryStore = defineStore('factory', {
  state: (): FactoryState => ({
    connectionStatus: 'connecting',
    deviceCount: 180,
    alarmCount: 3,
    shift: '白班 · A 班',
    kpis: [
      { label: '综合良率', value: '98.62', unit: '%', change: '+0.34%', tone: 'positive' },
      { label: '设备 OEE', value: '86.4', unit: '%', change: '+1.2%', tone: 'positive' },
      { label: '今日产能', value: '12,486', unit: '件', change: '目标 15,000', tone: 'neutral' },
      { label: '待处理告警', value: '03', unit: '项', change: '1 项高优先级', tone: 'critical' },
    ],
    statusCounts: { normal: 164, idle: 13, alarm: 3 },
    selectedDeviceId: null,
    eventRate: 0,
    lastSyncAt: null,
    totalOutput: 12_486,
    yieldRate: 98.62,
    averageOee: 86.4,
    quality: { qualified: 9_862, rework: 108, scrap: 30 },
    capacityTrend: initialCapacityValues.map((value, index) => ({
      timestamp: now - (initialCapacityValues.length - index - 1) * 1_000,
      value,
    })),
    oeeTrend: [],
    energyTrend: [],
    lineMetrics: Array.from({ length: 6 }, (_, index) => ({
      lineId: `PACK-${String(index + 1).padStart(2, '0')}`,
      lineName: `PACK ${String(index + 1).padStart(2, '0')}`,
      output: 0,
      yieldRate: 98.62,
      averageOee: 86.4,
      energyKwh: 0,
    })),
    defects: [
      { category: '焊接不良', count: 42 },
      { category: '气密不良', count: 28 },
      { category: '尺寸异常', count: 18 },
      { category: '电压异常', count: 14 },
      { category: '外观缺陷', count: 9 },
    ],
    totalEnergyKwh: 3_260,
    selectedDeviceHistoryId: null,
    selectedDeviceHistory: [],
  }),
  actions: {
    setConnectionStatus(status: RealtimeConnectionStatus) {
      this.connectionStatus = status
    },
    applyRealtimeSnapshot(snapshot: RealtimeMetricsSnapshot) {
      const alarmCount = snapshot.statusCounts.alarm
      this.$patch({
        statusCounts: snapshot.statusCounts,
        alarmCount,
        eventRate: snapshot.eventRate,
        lastSyncAt: snapshot.lastSyncAt,
        totalOutput: snapshot.totalOutput,
        yieldRate: snapshot.yieldRate,
        averageOee: snapshot.averageOee,
        quality: snapshot.quality,
        lineMetrics: snapshot.lineMetrics,
        totalEnergyKwh: snapshot.totalEnergyKwh,
        defects: snapshot.defects,
        kpis: [
          { label: '综合良率', value: snapshot.yieldRate.toFixed(2), unit: '%', change: '实时质量汇总', tone: 'positive' },
          { label: '设备 OEE', value: snapshot.averageOee.toFixed(1), unit: '%', change: '180 台设备均值', tone: 'positive' },
          { label: '今日产能', value: Math.round(snapshot.totalOutput).toLocaleString('en-US'), unit: '件', change: '目标 15,000', tone: 'neutral' },
          { label: '待处理告警', value: String(alarmCount).padStart(2, '0'), unit: '项', change: '实时设备状态', tone: alarmCount > 0 ? 'critical' : 'positive' },
        ],
      })
    },
    appendCapacityPoint(point: CapacityTrendPoint) {
      this.capacityTrend.push(point)
      if (this.capacityTrend.length > 60) this.capacityTrend.splice(0, this.capacityTrend.length - 60)
    },
    appendOeePoint(point: CapacityTrendPoint) {
      this.oeeTrend.push(point)
      if (this.oeeTrend.length > 60) this.oeeTrend.splice(0, this.oeeTrend.length - 60)
    },
    appendEnergyPoint(point: CapacityTrendPoint) {
      this.energyTrend.push(point)
      if (this.energyTrend.length > 60) this.energyTrend.splice(0, this.energyTrend.length - 60)
    },
    appendDeviceHistory(point: DeviceHistoryPoint) {
      if (this.selectedDeviceHistoryId !== point.deviceId) {
        this.selectedDeviceHistoryId = point.deviceId
        this.selectedDeviceHistory = Array.from({ length: 12 }, (_, index) => ({
          ...point,
          timestamp: point.timestamp - (11 - index) * 1_000,
          oee: Math.max(0, Math.min(100, point.oee + Math.sin(index * 0.8) * 1.4)),
          temperature: point.temperature + Math.cos(index * 0.65) * 0.7,
        }))
        return
      }
      this.selectedDeviceHistory.push(point)
      if (this.selectedDeviceHistory.length > 60) this.selectedDeviceHistory.splice(0, this.selectedDeviceHistory.length - 60)
    },
    clearDeviceHistory() {
      this.selectedDeviceHistoryId = null
      this.selectedDeviceHistory = []
    },
  },
})

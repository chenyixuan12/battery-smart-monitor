export type DeviceStatus = 'normal' | 'idle' | 'alarm'

export type AlarmSeverity = 'warning' | 'critical'

export type DefectCategory = '焊接不良' | '气密不良' | '尺寸异常' | '电压异常' | '外观缺陷'

export interface DeviceTelemetryEvent {
  deviceId: string
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
  temperature: number
  voltage: number
  current: number
  oee: number
  outputDelta: number
  qualifiedDelta: number
  reworkDelta: number
  scrapDelta: number
  energyDelta: number
  defectType?: DefectCategory
  timestamp: number
}

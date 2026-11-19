import type { Group, Vector3 } from 'three'
import type { AlarmSeverity, DeviceStatus } from '../../types'

export interface FactoryDevice {
  id: string
  name: string
  lineId: string
  stationIndex: number
  position: Vector3
  status: DeviceStatus
  alarmSeverity?: AlarmSeverity
}

export interface FactoryLine {
  id: string
  name: string
  z: number
  length: number
}

export interface FactoryBuildResult {
  root: Group
  devices: FactoryDevice[]
  lines: FactoryLine[]
  lineGroups: Map<string, Group>
}

export interface DevicePickedEvent {
  deviceId: string
  lineId: string
}

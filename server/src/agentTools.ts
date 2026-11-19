import type { AlarmSeverity } from '../../shared/telemetry.js'
import type { AlarmSnapshot, DeviceSnapshot, LineMetrics, RealtimeOverview, RealtimeState, RuntimeStats } from './realtimeState.js'
import type { SimulatorStats, TelemetrySimulator } from './telemetrySimulator.js'
import type { DiagnosticReport, IncidentService, OperationalIncident } from './operations.js'

export type ComparisonMetric = 'output' | 'yieldRate' | 'averageOee' | 'energyKwh'
export type ComparisonDirection = 'highest' | 'lowest'
export type AgentToolName = 'getOverview' | 'getAlarms' | 'getLineMetrics' | 'getDevice' | 'getRuntimeStats' | 'compareLines' | 'getIncidents' | 'diagnoseIncident'

type EmptyInput = Record<string, never>

export interface AgentToolInputs {
  getOverview: EmptyInput
  getAlarms: { severity?: AlarmSeverity; limit?: number }
  getLineMetrics: { lineId?: string }
  getDevice: { deviceId: string }
  getRuntimeStats: EmptyInput
  compareLines: { metric: ComparisonMetric; direction?: ComparisonDirection }
  getIncidents: { status?: 'open' | 'acknowledged' | 'resolved' }
  diagnoseIncident: { incidentId: string }
}

export interface RuntimeToolResult extends RuntimeStats {
  websocketClients: number
  simulator: SimulatorStats
}

export interface LineComparisonResult {
  metric: ComparisonMetric
  direction: ComparisonDirection
  line: LineMetrics | null
}

export interface AgentToolResults {
  getOverview: RealtimeOverview
  getAlarms: { items: AlarmSnapshot[]; total: number }
  getLineMetrics: { items: LineMetrics[] }
  getDevice: { item: DeviceSnapshot | null }
  getRuntimeStats: RuntimeToolResult
  compareLines: LineComparisonResult
  getIncidents: { items: OperationalIncident[] }
  diagnoseIncident: DiagnosticReport | { error: string }
}

export interface AgentToolDefinition {
  name: AgentToolName
  description: string
  input: Record<string, string>
}

const toolDefinitions: readonly AgentToolDefinition[] = [
  { name: 'getOverview', description: '读取工厂实时概览、质量、能耗和缺陷统计。', input: {} },
  { name: 'getAlarms', description: '读取当前待处理告警，可按严重级别筛选。', input: { severity: 'optional: warning | critical', limit: 'optional: 1..50' } },
  { name: 'getLineMetrics', description: '读取全部或指定产线的实时指标。', input: { lineId: 'optional: PACK-01' } },
  { name: 'getDevice', description: '读取指定设备的实时状态和传感器读数。', input: { deviceId: 'required: PACK-01-EQ-01' } },
  { name: 'getRuntimeStats', description: '读取模拟器吞吐、批处理耗时和慢客户端指标。', input: {} },
  { name: 'compareLines', description: '找出产出、良率、OEE 或能耗最高/最低的产线。', input: { metric: 'required: output | yieldRate | averageOee | energyKwh', direction: 'optional: highest | lowest' } },
  { name: 'getIncidents', description: '读取主动异常检测事件，可按状态筛选。', input: { status: 'optional: open | acknowledged | resolved' } },
  { name: 'diagnoseIncident', description: '基于设备、产线和告警上下文生成多步诊断报告。', input: { incidentId: 'required: INC-...' } },
]

function normalizeLineId(lineId: string): string {
  return lineId.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 20
  return Math.min(Math.max(Math.floor(limit), 1), 50)
}

function isAlarmSeverity(value: unknown): value is AlarmSeverity {
  return value === 'warning' || value === 'critical'
}

function isComparisonMetric(value: unknown): value is ComparisonMetric {
  return value === 'output' || value === 'yieldRate' || value === 'averageOee' || value === 'energyKwh'
}

function isComparisonDirection(value: unknown): value is ComparisonDirection {
  return value === 'highest' || value === 'lowest'
}

/** Read-only tools exposed to the assistant and future model function-calling adapters. */
export class RealtimeAgentTools {
  constructor(
    private readonly state: RealtimeState,
    private readonly simulator: TelemetrySimulator,
    private readonly getWebsocketClients: () => number,
    private readonly incidentService?: IncidentService,
  ) {}

  list(): readonly AgentToolDefinition[] {
    return toolDefinitions
  }

  execute<TName extends AgentToolName>(name: TName, input: AgentToolInputs[TName]): AgentToolResults[TName] {
    switch (name) {
      case 'getOverview':
        return this.state.getOverview() as AgentToolResults[TName]
      case 'getAlarms': {
        const { severity, limit } = input as AgentToolInputs['getAlarms']
        if (severity !== undefined && !isAlarmSeverity(severity)) throw new Error('invalid alarm severity')
        const alarms = this.state.getAlarms()
          .filter((alarm) => !severity || alarm.alarmSeverity === severity)
        return { items: alarms.slice(0, normalizeLimit(limit)), total: alarms.length } as AgentToolResults[TName]
      }
      case 'getLineMetrics': {
        const { lineId } = input as AgentToolInputs['getLineMetrics']
        if (lineId !== undefined && typeof lineId !== 'string') throw new Error('invalid line id')
        return { items: this.state.getLineMetrics(lineId ? normalizeLineId(lineId) : undefined) } as AgentToolResults[TName]
      }
      case 'getDevice': {
        const { deviceId } = input as AgentToolInputs['getDevice']
        if (typeof deviceId !== 'string' || !deviceId.trim()) throw new Error('invalid device id')
        return { item: this.state.getDevice(normalizeDeviceId(deviceId)) } as AgentToolResults[TName]
      }
      case 'getRuntimeStats':
        return {
          ...this.state.getRuntimeStats(),
          websocketClients: this.getWebsocketClients(),
          simulator: this.simulator.getStats(),
        } as AgentToolResults[TName]
      case 'compareLines': {
        const { metric, direction = 'lowest' } = input as AgentToolInputs['compareLines']
        if (!isComparisonMetric(metric) || !isComparisonDirection(direction)) throw new Error('invalid comparison input')
        const multiplier = direction === 'highest' ? -1 : 1
        const line = [...this.state.getLineMetrics()].sort((left, right) => multiplier * (left[metric] - right[metric]))[0] ?? null
        return { metric, direction, line } as AgentToolResults[TName]
      }
      case 'getIncidents': {
        const { status } = input as AgentToolInputs['getIncidents']
        if (status !== undefined && status !== 'open' && status !== 'acknowledged' && status !== 'resolved') throw new Error('invalid incident status')
        return { items: this.incidentService?.list(status) ?? [] } as AgentToolResults[TName]
      }
      case 'diagnoseIncident': {
        const incidentId = (input as AgentToolInputs['diagnoseIncident']).incidentId
        if (typeof incidentId !== 'string' || !incidentId.trim()) throw new Error('invalid incident id')
        const report = this.incidentService?.diagnose(incidentId, this.state)
        return (report ?? { error: 'incident_not_found' }) as AgentToolResults[TName]
      }
    }
  }
}

export function isAgentToolName(value: string): value is AgentToolName {
  return toolDefinitions.some((tool) => tool.name === value)
}

import type { AlarmSeverity } from '../../shared/telemetry.js'
import type { DeviceSnapshot, LineMetrics, RealtimeState } from './realtimeState.js'

export type IncidentKind = 'critical_alarm' | 'temperature_high' | 'voltage_high' | 'low_oee'
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved'
export type IncidentPriority = 'critical' | 'high' | 'medium'

export interface IncidentEvidence {
  deviceId: string
  lineId: string
  temperature: number
  voltage: number
  current: number
  oee: number
  observedAt: number
}

export interface OperationalIncident {
  id: string
  fingerprint: string
  kind: IncidentKind
  priority: IncidentPriority
  deviceId: string
  lineId: string
  title: string
  summary: string
  status: IncidentStatus
  detectedAt: number
  lastSeenAt: number
  acknowledgedAt?: number
  acknowledgedBy?: string
  evidence: IncidentEvidence
}

export interface DiagnosticReport {
  incidentId: string
  generatedAt: number
  conclusion: string
  confidence: 'high' | 'medium'
  evidence: string[]
  possibleCauses: string[]
  recommendedActions: string[]
  relatedAlarmCount: number
  lineMetrics: Pick<LineMetrics, 'lineId' | 'output' | 'yieldRate' | 'averageOee' | 'energyKwh'> | null
}

export interface WorkOrderDraft {
  id: string
  incidentId: string
  title: string
  priority: IncidentPriority
  description: string
  checklist: string[]
  createdAt: number
  status: 'draft'
}

export interface WorkOrder extends Omit<WorkOrderDraft, 'status'> {
  status: 'open'
  confirmedAt: number
  confirmedBy: string
  assignee?: string
}

const TEMPERATURE_LIMIT = 48
const VOLTAGE_LIMIT = 4.12
const LOW_OEE_LIMIT = 72

function incidentDefinition(device: DeviceSnapshot): Array<Omit<OperationalIncident, 'id' | 'status' | 'detectedAt' | 'lastSeenAt' | 'acknowledgedAt' | 'acknowledgedBy' | 'evidence'>> {
  const result: Array<Omit<OperationalIncident, 'id' | 'status' | 'detectedAt' | 'lastSeenAt' | 'acknowledgedAt' | 'acknowledgedBy' | 'evidence'>> = []
  const base = { deviceId: device.deviceId, lineId: device.lineId }
  if (device.status === 'alarm' && device.alarmSeverity === 'critical') {
    result.push({ ...base, fingerprint: `critical_alarm:${device.deviceId}`, kind: 'critical_alarm', priority: 'critical', title: '设备高优先级告警', summary: `${device.deviceId} 处于高优先级告警状态。` })
  }
  if (device.temperature >= TEMPERATURE_LIMIT) {
    result.push({ ...base, fingerprint: `temperature_high:${device.deviceId}`, kind: 'temperature_high', priority: device.temperature >= 54 ? 'critical' : 'high', title: '设备温度超限', summary: `${device.deviceId} 温度 ${device.temperature.toFixed(1)}°C，阈值 ${TEMPERATURE_LIMIT}°C。` })
  }
  if (device.voltage >= VOLTAGE_LIMIT) {
    result.push({ ...base, fingerprint: `voltage_high:${device.deviceId}`, kind: 'voltage_high', priority: 'high', title: '设备电压偏高', summary: `${device.deviceId} 电压 ${device.voltage.toFixed(3)} V，阈值 ${VOLTAGE_LIMIT} V。` })
  }
  if (device.oee <= LOW_OEE_LIMIT && device.status !== 'alarm') {
    result.push({ ...base, fingerprint: `low_oee:${device.deviceId}`, kind: 'low_oee', priority: 'medium', title: '设备 OEE 偏低', summary: `${device.deviceId} OEE ${device.oee.toFixed(1)}%，阈值 ${LOW_OEE_LIMIT}%。` })
  }
  return result
}

/** Turns raw telemetry into de-duplicated operational events. */
export class IncidentService {
  private readonly incidents = new Map<string, OperationalIncident>()
  private sequence = 0

  evaluate(state: RealtimeState): void {
    const now = Date.now()
    const activeFingerprints = new Set<string>()
    for (const device of state.getDevices()) {
      for (const definition of incidentDefinition(device)) {
        activeFingerprints.add(definition.fingerprint)
        const evidence = this.createEvidence(device)
        const existing = [...this.incidents.values()].find((incident) => incident.fingerprint === definition.fingerprint && incident.status !== 'resolved')
        if (existing) {
          existing.lastSeenAt = now
          existing.summary = definition.summary
          existing.priority = definition.priority
          existing.evidence = evidence
          continue
        }
        const id = `INC-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${String(++this.sequence).padStart(4, '0')}`
        this.incidents.set(id, { id, ...definition, status: 'open', detectedAt: now, lastSeenAt: now, evidence })
      }
    }
    for (const incident of this.incidents.values()) {
      if (incident.status !== 'resolved' && !activeFingerprints.has(incident.fingerprint)) incident.status = 'resolved'
    }
  }

  list(status?: IncidentStatus): OperationalIncident[] {
    return [...this.incidents.values()]
      .filter((incident) => !status || incident.status === status)
      .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority) || right.lastSeenAt - left.lastSeenAt)
  }

  get(id: string): OperationalIncident | null {
    return this.incidents.get(id) ?? null
  }

  acknowledge(id: string, operatorId: string): OperationalIncident | null {
    const incident = this.incidents.get(id)
    if (!incident || incident.status === 'resolved') return null
    incident.status = 'acknowledged'
    incident.acknowledgedAt = Date.now()
    incident.acknowledgedBy = operatorId
    return incident
  }

  diagnose(id: string, state: RealtimeState): DiagnosticReport | null {
    const incident = this.get(id)
    if (!incident) return null
    const device = state.getDevice(incident.deviceId)
    const line = state.getLineMetrics(incident.lineId)[0] ?? null
    const relatedAlarms = state.getAlarms().filter((alarm) => alarm.lineId === incident.lineId)
    const evidence = device
      ? [`设备状态：${formatDeviceStatus(device.alarmSeverity)}，温度 ${device.temperature.toFixed(1)}°C，电压 ${device.voltage.toFixed(3)} V，电流 ${device.current.toFixed(1)} A，OEE ${device.oee.toFixed(1)}%。`]
      : ['当前设备快照已过期，建议现场确认设备在线状态。']
    if (line) evidence.push(`产线 ${line.lineName}：良率 ${line.yieldRate.toFixed(2)}%，平均 OEE ${line.averageOee.toFixed(1)}%，当前告警 ${relatedAlarms.length} 项。`)

    const diagnosis = diagnosisFor(incident.kind, device, relatedAlarms.length)
    return {
      incidentId: id,
      generatedAt: Date.now(),
      confidence: device ? 'high' : 'medium',
      evidence,
      relatedAlarmCount: relatedAlarms.length,
      lineMetrics: line && { lineId: line.lineId, output: line.output, yieldRate: line.yieldRate, averageOee: line.averageOee, energyKwh: line.energyKwh },
      ...diagnosis,
    }
  }

  private createEvidence(device: DeviceSnapshot): IncidentEvidence {
    return {
      deviceId: device.deviceId,
      lineId: device.lineId,
      temperature: device.temperature,
      voltage: device.voltage,
      current: device.current,
      oee: device.oee,
      observedAt: device.lastSeenAt,
    }
  }
}

/** Keeps risky write actions as explicit drafts until an operator confirms them. */
export class WorkOrderService {
  private readonly drafts = new Map<string, WorkOrderDraft>()
  private readonly orders = new Map<string, WorkOrder>()
  private sequence = 0

  createDraft(incident: OperationalIncident, report: DiagnosticReport): WorkOrderDraft {
    const existing = [...this.drafts.values()].find((draft) => draft.incidentId === incident.id)
    if (existing) return existing
    const id = `WOD-${String(++this.sequence).padStart(5, '0')}`
    const draft: WorkOrderDraft = {
      id,
      incidentId: incident.id,
      title: `${incident.deviceId} - ${incident.title}`,
      priority: incident.priority,
      description: `${incident.summary}\n诊断结论：${report.conclusion}`,
      checklist: report.recommendedActions,
      createdAt: Date.now(),
      status: 'draft',
    }
    this.drafts.set(id, draft)
    return draft
  }

  listDrafts(): WorkOrderDraft[] {
    return [...this.drafts.values()].sort((left, right) => right.createdAt - left.createdAt)
  }

  listOrders(): WorkOrder[] {
    return [...this.orders.values()].sort((left, right) => right.confirmedAt - left.confirmedAt)
  }

  confirmDraft(draftId: string, operatorId: string, assignee?: string): WorkOrder | null {
    const draft = this.drafts.get(draftId)
    if (!draft) return null
    const order: WorkOrder = { ...draft, status: 'open', confirmedAt: Date.now(), confirmedBy: operatorId, assignee }
    this.orders.set(order.id.replace('WOD-', 'WO-'), { ...order, id: order.id.replace('WOD-', 'WO-') })
    this.drafts.delete(draftId)
    return this.orders.get(order.id.replace('WOD-', 'WO-')) ?? null
  }
}

function priorityRank(priority: IncidentPriority): number {
  return priority === 'critical' ? 3 : priority === 'high' ? 2 : 1
}

function formatDeviceStatus(severity: AlarmSeverity | undefined): string {
  return severity === 'critical' ? '高优先级告警' : severity === 'warning' ? '一般告警' : '正常或待机'
}

function diagnosisFor(kind: IncidentKind, device: DeviceSnapshot | null, relatedAlarmCount: number): Pick<DiagnosticReport, 'conclusion' | 'possibleCauses' | 'recommendedActions'> {
  const concurrentAlarmText = relatedAlarmCount > 1 ? `同产线同时存在 ${relatedAlarmCount} 项告警，需先排查共因。` : '当前为单设备异常，优先从设备本体与工位连接检查。'
  switch (kind) {
    case 'temperature_high':
      return { conclusion: `温度超限可能影响电芯装配一致性。${concurrentAlarmText}`, possibleCauses: ['冷却或散热回路效率下降', '工位负载异常或摩擦升高', '温度传感器漂移'], recommendedActions: ['现场确认散热风道、冷却液和风机状态', '复核温度传感器与备用测温值', '检查本工位最近的节拍和负载变化', '确认后创建维修工单并安排复检'] }
    case 'voltage_high':
      return { conclusion: `电压读数偏高，需先确认采集链路与工位参数。${concurrentAlarmText}`, possibleCauses: ['电压采样校准偏差', '接触电阻或连接器异常', '工艺参数设置偏离'], recommendedActions: ['使用校准仪复测电压', '检查治具、连接器和线束接触状态', '核对当前工艺配方与参数版本', '确认后创建维修工单并记录复测结果'] }
    case 'low_oee':
      return { conclusion: `设备 OEE 持续偏低，建议结合停机记录和产线节拍确认瓶颈。${concurrentAlarmText}`, possibleCauses: ['设备待机或微停频繁', '上游供料节拍波动', '换型或参数调整时间偏长'], recommendedActions: ['核对最近 30 分钟停机和待机原因', '检查上游工位供料与下游缓存', '对比同产线相邻设备的 OEE', '确认改善责任人后创建跟踪工单'] }
    case 'critical_alarm':
    default:
      return { conclusion: `设备处于高优先级告警状态${device ? `，当前温度 ${device.temperature.toFixed(1)}°C` : ''}。${concurrentAlarmText}`, possibleCauses: ['设备安全联锁触发', '传感器或执行器异常', '工艺阈值越界'], recommendedActions: ['按现场 SOP 确认设备安全状态', '检查告警代码、传感器读数和执行器反馈', '确认是否影响在制品并隔离风险批次', '由值班人员确认后创建高优先级维修工单'] }
  }
}

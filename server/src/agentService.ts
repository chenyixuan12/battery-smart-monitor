import type { AgentToolName, ComparisonMetric, RealtimeAgentTools } from './agentTools.js'
import type { LineMetrics } from './realtimeState.js'

export interface AgentQueryResult {
  answer: string
  generatedAt: number
  toolsUsed: AgentToolName[]
  provider?: 'bailian' | 'rules'
}

function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits })
}

function findLineId(question: string, lines: LineMetrics[]): string | undefined {
  const normalized = question.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return lines.find((line) => {
    const id = line.lineId.replace(/[^A-Z0-9]/g, '')
    return normalized.includes(id) || normalized.includes(id.replace('PACK', 'L'))
  })?.lineId
}

function findDeviceId(question: string): string | undefined {
  const match = question.toUpperCase().match(/PACK[-\s]?(\d{2})[-\s]?EQ[-\s]?(\d{2})/)
  return match ? `PACK-${match[1]}-EQ-${match[2]}` : undefined
}

function findComparisonMetric(question: string): ComparisonMetric | undefined {
  const normalized = question.toLowerCase()
  if (/能耗|耗电|电量|能源/.test(normalized)) return 'energyKwh'
  if (/良率|质量|不良|缺陷|返工|报废/.test(normalized)) return 'yieldRate'
  if (/oee|设备效率|综合效率/.test(normalized)) return 'averageOee'
  if (/产能|产出|生产/.test(normalized)) return 'output'
  return undefined
}

function formatLineComparison(line: LineMetrics, metric: ComparisonMetric, direction: string): string {
  const label = metric === 'output' ? '产出' : metric === 'yieldRate' ? '良率' : metric === 'averageOee' ? 'OEE' : '能耗'
  const value = metric === 'output'
    ? `${formatNumber(line.output)} 件`
    : metric === 'energyKwh'
      ? `${formatNumber(line.energyKwh, 1)} kWh`
      : `${line[metric].toFixed(metric === 'yieldRate' ? 2 : 1)}%`
  return `${line.lineName} 的${label}${direction === 'highest' ? '最高' : '最低'}，当前为 ${value}。`
}

/** Translates operational questions into read-only realtime tool calls. */
export class AgentService {
  constructor(private readonly tools: RealtimeAgentTools) {}

  query(question: string): AgentQueryResult {
    const normalized = question.toLowerCase()
    const overview = this.tools.execute('getOverview', {})
    const deviceId = findDeviceId(question)
    const lineId = findLineId(question, overview.lineMetrics)
    const comparisonMetric = findComparisonMetric(question)
    const isComparison = /哪条|对比|比较|最高|最低|最大|最小/.test(question)

    if (deviceId) {
      const { item } = this.tools.execute('getDevice', { deviceId })
      if (!item) return this.result(`未找到设备 ${deviceId}，请确认设备编号。`, ['getOverview', 'getDevice'])
      const status = item.status === 'alarm' ? '处于告警状态' : item.status === 'idle' ? '处于待机状态' : '运行正常'
      return this.result(`${item.deviceId} 当前${status}，温度 ${item.temperature.toFixed(1)}°C，电压 ${item.voltage.toFixed(3)} V，电流 ${item.current.toFixed(1)} A，OEE ${item.oee.toFixed(1)}%。`, ['getOverview', 'getDevice'])
    }

    if (isComparison && comparisonMetric) {
      const direction = /最高|最大/.test(question) ? 'highest' : 'lowest'
      const comparison = this.tools.execute('compareLines', { metric: comparisonMetric, direction })
      if (!comparison.line) return this.result('当前尚未收到可供比较的产线实时数据。', ['getOverview', 'compareLines'])
      return this.result(formatLineComparison(comparison.line, comparison.metric, comparison.direction), ['getOverview', 'compareLines'])
    }

    if (/诊断|根因|维修|异常分析|主动异常|排查|怎么处理/.test(question)) {
      const incidents = this.tools.execute('getIncidents', { status: 'open' }).items
      const incident = incidents[0]
      if (!incident) return this.result('当前没有开放的主动异常事件，建议继续观察实时告警和设备趋势。', ['getOverview', 'getIncidents'])
      const report = this.tools.execute('diagnoseIncident', { incidentId: incident.id })
      if ('error' in report) return this.result(`已发现 ${incident.title}，但暂时无法生成诊断报告。`, ['getOverview', 'getIncidents', 'diagnoseIncident'])
      return this.result(`${incident.id}：${report.conclusion} 证据：${report.evidence.join(' ')} 建议：${report.recommendedActions.slice(0, 3).join('；')}。如需闭环处理，可在确认身份后生成维修工单草稿。`, ['getOverview', 'getIncidents', 'diagnoseIncident'])
    }

    if (lineId) {
      const { items } = this.tools.execute('getLineMetrics', { lineId })
      const line = items[0]
      if (!line) return this.result(`未找到产线 ${lineId} 的实时数据。`, ['getOverview', 'getLineMetrics'])
      return this.result(`${line.lineName} 当前产出 ${formatNumber(line.output)} 件，良率 ${line.yieldRate.toFixed(2)}%，OEE ${line.averageOee.toFixed(1)}%，能耗 ${formatNumber(line.energyKwh, 1)} kWh。`, ['getOverview', 'getLineMetrics'])
    }

    if (/告警|报警|异常|故障/.test(normalized)) {
      const severity = /高优|严重|critical/.test(normalized) ? 'critical' : undefined
      const { items, total } = this.tools.execute('getAlarms', { severity, limit: 3 })
      if (total === 0) return this.result('当前没有待处理告警，所有设备均处于正常或待机状态。', ['getOverview', 'getAlarms'])
      return this.result(`当前有 ${total} 项${severity ? '高优先级' : '待处理'}告警。涉及设备：${items.map((alarm) => alarm.deviceId).join('、')}。建议优先检查温度与电压趋势。`, ['getOverview', 'getAlarms'])
    }

    if (/吞吐|性能|运行指标|延迟|慢客户端|处理耗时/.test(normalized)) {
      const runtime = this.tools.execute('getRuntimeStats', {})
      return this.result(`当前模拟器 ${runtime.simulator.profile} 档位，吞吐 ${formatNumber(runtime.simulator.eventsPerSecond)} events/s；服务端最近批次 ${runtime.lastBatchSize} 条，处理耗时 ${runtime.lastIngestMs.toFixed(3)} ms；慢客户端跳过 ${runtime.slowClientSkippedBatches} 批。`, ['getOverview', 'getRuntimeStats'])
    }

    if (/能耗|耗电|电量|能源/.test(normalized)) {
      const comparison = this.tools.execute('compareLines', { metric: 'energyKwh', direction: 'highest' })
      return this.result(`当前累计能耗 ${formatNumber(overview.totalEnergyKwh, 1)} kWh，${comparison.line?.lineName ?? '当前产线'} 能耗最高（${formatNumber(comparison.line?.energyKwh ?? 0, 1)} kWh）。`, ['getOverview', 'compareLines'])
    }

    if (/良率|质量|不良|缺陷|返工|报废/.test(normalized)) {
      const topDefect = [...overview.defects].sort((left, right) => right.count - left.count)[0]
      const totalDefects = overview.defects.reduce((sum, defect) => sum + defect.count, 0)
      return this.result(`当前综合良率 ${overview.yieldRate.toFixed(2)}%。累计不良 ${formatNumber(totalDefects)} 项，主要问题为${topDefect?.category ?? '暂无分类'}（${topDefect?.count ?? 0} 项）。`, ['getOverview'])
    }

    if (/oee|设备效率|综合效率/.test(normalized)) {
      const comparison = this.tools.execute('compareLines', { metric: 'averageOee', direction: 'lowest' })
      return this.result(`当前平均 OEE ${overview.averageOee.toFixed(1)}%，${comparison.line?.lineName ?? '当前产线'} OEE 最低（${comparison.line?.averageOee.toFixed(1) ?? '0.0'}%），可优先检查停机和换型记录。`, ['getOverview', 'compareLines'])
    }

    if (/产能|产出|生产|完成|目标/.test(normalized)) {
      const target = 15_000
      const progress = Math.min(100, overview.totalOutput / target * 100)
      return this.result(`今日累计产出 ${formatNumber(overview.totalOutput)} 件，完成目标 ${progress.toFixed(1)}%（目标 ${formatNumber(target)} 件）。`, ['getOverview'])
    }

    if (/设备|运行状态|在线|待机/.test(normalized)) {
      return this.result(`设备状态：${overview.statusCounts.normal} 台正常、${overview.statusCounts.idle} 台待机、${overview.statusCounts.alarm} 台告警，共 ${formatNumber(overview.deviceCount)} 台。`, ['getOverview'])
    }

    return this.result('我可以查询服务端实时状态中的产能、良率、OEE、能耗、设备、告警和运行性能。试试输入“查看 PACK-01 良率”或“哪条产线 OEE 最低”。', ['getOverview'])
  }

  private result(answer: string, toolsUsed: AgentToolName[]): AgentQueryResult {
    return { answer, generatedAt: Date.now(), toolsUsed, provider: 'rules' }
  }
}

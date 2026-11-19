import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import type { AgentQueryResult } from './agentService.js'
import { isAgentToolName, type AgentToolName, type RealtimeAgentTools } from './agentTools.js'

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen-plus'
const MAX_TOOL_ROUNDS = 6

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BailianAgentOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface BailianAgentQueryResult extends AgentQueryResult {
  provider: 'bailian'
  model: string
}

function jsonResult(value: unknown): string {
  return JSON.stringify(value)
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : typeof part === 'string' ? part : '')
      .join('')
      .trim()
  }
  return ''
}

function historyToMessages(history: readonly AgentHistoryMessage[]): BaseMessage[] {
  return history.map((message) => message.role === 'user'
    ? new HumanMessage(message.content)
    : new AIMessage(message.content))
}

function createTools(realtimeTools: RealtimeAgentTools): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getOverview',
      description: '读取工厂实时概览，包括产能、良率、OEE、能耗、设备状态和缺陷统计。回答工厂整体问题前优先调用。',
      schema: z.object({}),
      func: async () => jsonResult(realtimeTools.execute('getOverview', {})),
    }),
    new DynamicStructuredTool({
      name: 'getAlarms',
      description: '读取当前待处理设备告警。可按 warning 或 critical 严重级别过滤，limit 最大 50。',
      schema: z.object({
        severity: z.enum(['warning', 'critical']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      func: async (input) => jsonResult(realtimeTools.execute('getAlarms', input)),
    }),
    new DynamicStructuredTool({
      name: 'getLineMetrics',
      description: '读取全部或指定 PACK 产线的产出、良率、OEE 和能耗。lineId 示例：PACK-01。',
      schema: z.object({ lineId: z.string().max(20).optional() }),
      func: async (input) => jsonResult(realtimeTools.execute('getLineMetrics', input)),
    }),
    new DynamicStructuredTool({
      name: 'getDevice',
      description: '读取指定设备的实时状态、温度、电压、电流和 OEE。deviceId 示例：PACK-01-EQ-01。',
      schema: z.object({ deviceId: z.string().min(1).max(40) }),
      func: async (input) => jsonResult(realtimeTools.execute('getDevice', input)),
    }),
    new DynamicStructuredTool({
      name: 'getRuntimeStats',
      description: '读取遥测模拟器吞吐、批处理耗时、WebSocket 客户端数和慢客户端统计。',
      schema: z.object({}),
      func: async () => jsonResult(realtimeTools.execute('getRuntimeStats', {})),
    }),
    new DynamicStructuredTool({
      name: 'compareLines',
      description: '按产出、良率、OEE 或能耗找出表现最高或最低的产线。',
      schema: z.object({
        metric: z.enum(['output', 'yieldRate', 'averageOee', 'energyKwh']),
        direction: z.enum(['highest', 'lowest']).optional(),
      }),
      func: async (input) => jsonResult(realtimeTools.execute('compareLines', input)),
    }),
    new DynamicStructuredTool({
      name: 'getIncidents',
      description: '读取系统主动检测到的异常事件，可按 open、acknowledged、resolved 状态筛选。用户询问风险、异常诊断或维修时优先调用。',
      schema: z.object({ status: z.enum(['open', 'acknowledged', 'resolved']).optional() }),
      func: async (input) => jsonResult(realtimeTools.execute('getIncidents', input)),
    }),
    new DynamicStructuredTool({
      name: 'diagnoseIncident',
      description: '基于设备遥测、产线指标和同线告警生成诊断结论、可能原因与推荐排查步骤。必须先使用 getIncidents 获得 incidentId。',
      schema: z.object({ incidentId: z.string().min(1).max(40) }),
      func: async (input) => jsonResult(realtimeTools.execute('diagnoseIncident', input)),
    }),
  ]
}

/** A read-only LangChain tool-calling agent backed by Alibaba Cloud Bailian. */
export class BailianAgentService {
  private readonly model: string
  private readonly runnable
  private readonly toolsByName: Map<string, DynamicStructuredTool>

  constructor(realtimeTools: RealtimeAgentTools, options: BailianAgentOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? process.env.BAILIAN_API_KEY
    if (!apiKey) throw new Error('bailian_api_key_missing')

    this.model = options.model ?? process.env.BAILIAN_MODEL ?? DEFAULT_MODEL
    const chatModel = new ChatOpenAI({
      apiKey,
      model: this.model,
      temperature: 0.1,
      timeout: 25_000,
      maxRetries: 1,
      configuration: { baseURL: options.baseUrl ?? process.env.BAILIAN_BASE_URL ?? DEFAULT_BASE_URL },
    })
    const tools = createTools(realtimeTools)
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
    this.runnable = chatModel.bindTools(tools)
  }

  async query(question: string, history: readonly AgentHistoryMessage[] = []): Promise<BailianAgentQueryResult> {
    const messages: BaseMessage[] = [
      new SystemMessage(`你是动力电池 PACK 智能制造中心的运维助手。必须使用工具读取实时数据后再回答数据类问题；不得编造实时数值。异常诊断必须先读取主动事件，再调用 diagnoseIncident 获取证据和建议。工具均为只读工具，不能执行控制、写入或删除操作；用户要求创建工单时，说明系统会先生成草稿，且必须由具备角色权限的值班人员在界面中确认。使用简洁中文回答，给出明确结论；告警或异常问题应提示风险与优先检查项。`),
      ...historyToMessages(history),
      new HumanMessage(question),
    ]
    const toolsUsed = new Set<AgentToolName>()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.runnable.invoke(messages)
      messages.push(response)
      const toolCalls = response.tool_calls ?? []

      if (toolCalls.length === 0) {
        const answer = messageContentToText(response.content)
        return {
          answer: answer || '未能生成有效回答，请换一种方式描述问题。',
          generatedAt: Date.now(),
          toolsUsed: [...toolsUsed],
          provider: 'bailian',
          model: this.model,
        }
      }

      for (const call of toolCalls) {
        const tool = this.toolsByName.get(call.name)
        const toolCallId = call.id ?? `${call.name}-${round}`
        if (!tool || !isAgentToolName(call.name)) {
          messages.push(new ToolMessage({ content: jsonResult({ error: 'tool_not_available' }), tool_call_id: toolCallId, name: call.name }))
          continue
        }

        try {
          const output = await tool.invoke(call.args)
          toolsUsed.add(call.name)
          messages.push(new ToolMessage({ content: String(output), tool_call_id: toolCallId, name: call.name }))
        } catch {
          messages.push(new ToolMessage({ content: jsonResult({ error: 'tool_input_invalid' }), tool_call_id: toolCallId, name: call.name }))
        }
      }
    }

    return {
      answer: '查询步骤超过上限，请缩小问题范围后重试。',
      generatedAt: Date.now(),
      toolsUsed: [...toolsUsed],
      provider: 'bailian',
      model: this.model,
    }
  }
}

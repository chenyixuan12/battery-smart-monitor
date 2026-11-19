import cors from 'cors'
import express, { type Express } from 'express'
import { createServer, type Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { AgentService } from './agentService.js'
import { BailianAgentService, type AgentHistoryMessage } from './bailianAgentService.js'
import { isAgentToolName, RealtimeAgentTools } from './agentTools.js'
import { IncidentService, WorkOrderService } from './operations.js'
import { RealtimeState } from './realtimeState.js'
import { createSimulatorFromEnvironment, TelemetrySimulator } from './telemetrySimulator.js'

export interface RealtimeServerOptions {
  port?: number
  simulator?: TelemetrySimulator
  state?: RealtimeState
}

export function createRealtimeServer(options: RealtimeServerOptions = {}) {
  const app: Express = express()
  const server: Server = createServer(app)
  const websocketServer = new WebSocketServer({ server, path: '/ws/telemetry' })
  const simulator = options.simulator ?? createSimulatorFromEnvironment()
  const state = options.state ?? new RealtimeState()
  const incidents = new IncidentService()
  const workOrders = new WorkOrderService()
  const tools = new RealtimeAgentTools(state, simulator, () => websocketServer.clients.size, incidents)
  const agent = new AgentService(tools)
  const bailianAgent = createBailianAgent(tools)
  let heartbeatTimer: NodeJS.Timeout | null = null
  let started = false
  let stopping = false
  let stopPromise: Promise<void> | null = null

  app.use(cors())
  app.use(express.json({ limit: '32kb' }))
  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'pack-smart-factory-server',
      timestamp: Date.now(),
      websocketClients: websocketServer.clients.size,
      overview: state.getOverview(),
    })
  })
  app.get('/api/overview', (_request, response) => {
    response.json(state.getOverview())
  })
  app.get('/api/alarms', (_request, response) => {
    const items = state.getAlarms()
    response.json({ items, total: items.length })
  })
  app.get('/api/lines', (_request, response) => {
    response.json({ items: state.getLineMetrics() })
  })
  app.get('/api/lines/:lineId', (request, response) => {
    const line = state.getLineMetrics(request.params.lineId)[0]
    if (!line) {
      response.status(404).json({ error: 'line_not_found', lineId: request.params.lineId })
      return
    }
    response.json(line)
  })
  app.get('/api/devices/:deviceId', (request, response) => {
    const device = state.getDevice(request.params.deviceId)
    if (!device) {
      response.status(404).json({ error: 'device_not_found', deviceId: request.params.deviceId })
      return
    }
    response.json(device)
  })
  app.get('/api/runtime', (_request, response) => {
    response.json({
      ...state.getRuntimeStats(),
      websocketClients: websocketServer.clients.size,
      simulator: simulator.getStats(),
    })
  })
  app.get('/api/incidents', (request, response) => {
    const status = request.query.status
    if (status !== undefined && status !== 'open' && status !== 'acknowledged' && status !== 'resolved') {
      response.status(400).json({ error: 'invalid_incident_status' })
      return
    }
    response.json({ items: incidents.list(status) })
  })
  app.post('/api/incidents/:incidentId/diagnose', (request, response) => {
    const report = incidents.diagnose(request.params.incidentId, state)
    if (!report) {
      response.status(404).json({ error: 'incident_not_found' })
      return
    }
    response.json(report)
  })
  app.post('/api/incidents/:incidentId/acknowledge', (request, response) => {
    const operator = parseOperator(request)
    if (!operator) {
      response.status(403).json({ error: 'operator_role_required', message: 'maintenance or supervisor role required' })
      return
    }
    const incident = incidents.acknowledge(request.params.incidentId, operator.id)
    if (!incident) {
      response.status(404).json({ error: 'active_incident_not_found' })
      return
    }
    response.json({ item: incident, audit: { action: 'acknowledge_incident', operator, at: Date.now() } })
  })
  app.post('/api/incidents/:incidentId/work-order-drafts', (request, response) => {
    const operator = parseOperator(request)
    if (!operator) {
      response.status(403).json({ error: 'operator_role_required', message: 'maintenance or supervisor role required' })
      return
    }
    const incident = incidents.get(request.params.incidentId)
    const report = incidents.diagnose(request.params.incidentId, state)
    if (!incident || !report) {
      response.status(404).json({ error: 'incident_not_found' })
      return
    }
    const draft = workOrders.createDraft(incident, report)
    response.status(201).json({ item: draft, audit: { action: 'create_work_order_draft', operator, at: Date.now() } })
  })
  app.get('/api/work-order-drafts', (_request, response) => {
    response.json({ items: workOrders.listDrafts() })
  })
  app.get('/api/work-orders', (_request, response) => {
    response.json({ items: workOrders.listOrders() })
  })
  app.post('/api/work-order-drafts/:draftId/confirm', (request, response) => {
    const operator = parseOperator(request)
    if (!operator) {
      response.status(403).json({ error: 'operator_role_required', message: 'maintenance or supervisor role required' })
      return
    }
    const assignee = typeof request.body?.assignee === 'string' ? request.body.assignee.trim().slice(0, 80) : undefined
    const order = workOrders.confirmDraft(request.params.draftId, operator.id, assignee || undefined)
    if (!order) {
      response.status(404).json({ error: 'work_order_draft_not_found' })
      return
    }
    response.status(201).json({ item: order, audit: { action: 'confirm_work_order', operator, at: Date.now() } })
  })
  app.post('/api/agent/query', async (request, response) => {
    const question = typeof request.body?.question === 'string' ? request.body.question.trim() : ''
    if (!question || question.length > 120) {
      response.status(400).json({ error: 'invalid_question', message: 'question must contain 1 to 120 characters' })
      return
    }
    const history = parseAgentHistory(request.body?.history)
    if (!bailianAgent) {
      response.json(agent.query(question))
      return
    }
    try {
      response.json(await bailianAgent.query(question, history))
    } catch {
      response.json({ ...agent.query(question), fallback: 'bailian_unavailable' })
    }
  })
  app.get('/api/agent/tools', (_request, response) => {
    response.json({ items: tools.list() })
  })
  app.post('/api/agent/tools/:toolName', (request, response) => {
    if (!isAgentToolName(request.params.toolName)) {
      response.status(404).json({ error: 'agent_tool_not_found', toolName: request.params.toolName })
      return
    }
    const input = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {}
    try {
      response.json(tools.execute(request.params.toolName, input as never))
    } catch {
      response.status(400).json({ error: 'invalid_tool_input', toolName: request.params.toolName })
    }
  })

  simulator.subscribe((events) => {
    state.ingest(events)
    incidents.evaluate(state)
    state.markBroadcastBatch()
    const payload = JSON.stringify(events)
    let skippedClients = 0
    websocketServer.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return
      if (client.bufferedAmount >= 2_000_000) {
        skippedClients += 1
        return
      }
      client.send(payload)
    })
    if (skippedClients > 0) state.markSlowClientSkippedBatches(skippedClients)
  })

  websocketServer.on('connection', (client) => {
    const socket = client as WebSocket & { isAlive?: boolean }
    socket.isAlive = true
    socket.on('pong', () => { socket.isAlive = true })
  })

  heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      const socket = client as WebSocket & { isAlive?: boolean }
      if (socket.isAlive === false) {
        socket.terminate()
        return
      }
      socket.isAlive = false
      socket.ping()
    })
  }, 30_000)
  heartbeatTimer.unref()

  const port = options.port ?? Number(process.env.PORT ?? 3001)
  return {
    app,
    server,
    websocketServer,
    simulator,
    start: () => {
      if (started || stopping) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, () => {
          server.removeListener('error', reject)
          started = true
          simulator.start()
          resolve()
        })
      })
    },
    stop: () => {
      if (stopPromise) return stopPromise
      if (!started && !server.listening) {
        simulator.stop()
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        heartbeatTimer = null
        return Promise.resolve()
      }
      stopping = true
      stopPromise = new Promise<void>((resolve, reject) => {
        simulator.stop()
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        heartbeatTimer = null
        websocketServer.clients.forEach((client) => client.close(1000, 'server stopping'))
        websocketServer.close((websocketError) => {
          if (websocketError) {
            reject(websocketError)
            return
          }
          server.close((error) => {
            started = false
            stopping = false
            if (error) reject(error)
            else resolve()
          })
        })
      })
      return stopPromise
    },
  }
}

function parseOperator(request: express.Request): { id: string; role: 'maintenance' | 'supervisor' } | null {
  const id = typeof request.body?.operatorId === 'string' ? request.body.operatorId.trim() : ''
  const role = request.body?.operatorRole
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(id) || (role !== 'maintenance' && role !== 'supervisor')) return null
  return { id, role }
}

function createBailianAgent(tools: RealtimeAgentTools): BailianAgentService | null {
  if (!process.env.DASHSCOPE_API_KEY && !process.env.BAILIAN_API_KEY) return null
  return new BailianAgentService(tools)
}

function parseAgentHistory(value: unknown): AgentHistoryMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(-10).flatMap((message): AgentHistoryMessage[] => {
    if (!message || typeof message !== 'object') return []
    const { role, content } = message as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return []
    const normalizedContent = content.trim()
    return normalizedContent && normalizedContent.length <= 2_000 ? [{ role, content: normalizedContent }] : []
  })
}

if (process.env.NODE_ENV !== 'test') {
  void createRealtimeServer().start()
}

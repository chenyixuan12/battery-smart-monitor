import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { queryAgent } from '../../src/services/agentApi'
import { useAgentStore } from '../../src/stores/agent'

vi.mock('../../src/services/agentApi', () => ({ queryAgent: vi.fn() }))
const queryAgentMock = vi.mocked(queryAgent)

describe('agent store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    queryAgentMock.mockReset()
  })

  it('asks the server-side agent and keeps the conversation', async () => {
    queryAgentMock.mockResolvedValue({ answer: '服务端实时产出 12,486 件。', generatedAt: 123 })
    const store = useAgentStore()
    const request = store.ask('今日产能达成情况如何？')

    expect(store.isResponding).toBe(true)
    await request

    expect(store.messages).toHaveLength(2)
    expect(store.messages[0].role).toBe('user')
    expect(store.messages[1].content).toContain('服务端实时产出')
    expect(store.lastCommand).toBe('今日产能达成情况如何？')
    expect(queryAgentMock).toHaveBeenCalledWith('今日产能达成情况如何？', [])
  })

  it('shows an error when the server-side agent request fails', async () => {
    queryAgentMock.mockRejectedValue(new Error('agent_query_failed'))
    const store = useAgentStore()
    await store.ask('查看 L02 的良率')

    expect(store.messages).toHaveLength(1)
    expect(store.error).toBe('助手暂时无法处理该问题，请稍后重试。')
  })

  it('clears messages and command state', async () => {
    queryAgentMock.mockResolvedValue({ answer: '当前有 1 项告警。', generatedAt: 123 })
    const store = useAgentStore()
    await store.ask('有哪些告警？')

    store.clearHistory()

    expect(store.messages).toEqual([])
    expect(store.lastCommand).toBeNull()
    expect(store.error).toBeNull()
  })
})

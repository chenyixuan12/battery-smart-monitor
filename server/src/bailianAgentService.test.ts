import { describe, expect, it } from 'vitest'
import { BailianAgentService } from './bailianAgentService.js'
import { RealtimeAgentTools } from './agentTools.js'
import { RealtimeState } from './realtimeState.js'
import { TelemetrySimulator } from './telemetrySimulator.js'

function createTools() {
  return new RealtimeAgentTools(new RealtimeState(), new TelemetrySimulator(), () => 0)
}

describe('BailianAgentService', () => {
  it('requires a server-side Bailian key', () => {
    expect(() => new BailianAgentService(createTools(), { apiKey: '' })).toThrow('bailian_api_key_missing')
  })

  it('accepts an explicit model configuration without connecting during construction', () => {
    expect(() => new BailianAgentService(createTools(), {
      apiKey: 'test-key',
      model: 'qwen-plus',
      baseUrl: 'https://example.invalid/v1',
    })).not.toThrow()
  })
})

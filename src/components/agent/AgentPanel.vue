<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAgentStore } from '../../stores/agent'

const agent = useAgentStore()
const draft = ref('')
const transcript = ref<HTMLElement | null>(null)
const quickPrompts = ['今日产能达成情况如何？', '当前有哪些待处理告警？', '分析当前主动异常并给出排查步骤', '哪条产线 OEE 最低？']
const canSend = computed(() => draft.value.trim().length > 0 && !agent.isResponding)
const operatorId = ref('operator-demo')
const operatorRole = ref<'maintenance' | 'supervisor'>('supervisor')
let incidentTimer: ReturnType<typeof setInterval> | null = null

async function send(question = draft.value) {
  const content = question.trim()
  if (!content || agent.isResponding) return
  draft.value = ''
  await agent.ask(content)
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

watch(() => agent.messages.length, async () => {
  await nextTick()
  if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
})

onMounted(() => {
  void agent.refreshIncidents()
  incidentTimer = setInterval(() => void agent.refreshIncidents(), 5_000)
})
onBeforeUnmount(() => { if (incidentTimer) clearInterval(incidentTimer) })

function priorityLabel(priority: string) {
  return priority === 'critical' ? '高优先级' : priority === 'high' ? '高' : '中'
}

function formatIncidentTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section class="panel agent-panel" aria-labelledby="agent-title">
    <div class="panel-heading compact-heading">
      <div>
        <p class="eyebrow">INDUSTRIAL COPILOT</p>
        <h2 id="agent-title">运维助手</h2>
      </div>
      <div class="agent-actions">
        <button v-if="agent.messages.length" type="button" class="agent-clear" title="清空对话" aria-label="清空对话" @click="agent.clearHistory">×</button>
        <span class="agent-state" :class="{ responding: agent.isResponding }"><i></i>{{ agent.isResponding ? ' THINKING' : ' READY' }}</span>
      </div>
    </div>
    <div class="agent-intro">
      <div class="agent-avatar">AI</div>
      <div><strong>你好，我是工厂运维助手</strong><p>可查询产线运行数据与设备状态</p></div>
    </div>
    <div v-if="agent.incidents.length" class="incident-list" aria-label="主动异常事件">
      <div class="incident-list-heading"><span>主动异常</span><strong>{{ agent.incidents.length }}</strong></div>
      <article v-for="incident in agent.incidents.slice(0, 3)" :key="incident.id" class="incident-item">
        <div class="incident-item-top"><span class="incident-priority" :class="`priority-${incident.priority}`">{{ priorityLabel(incident.priority) }}</span><code>{{ incident.id }}</code><time>{{ formatIncidentTime(incident.lastSeenAt) }}</time></div>
        <strong>{{ incident.title }}</strong><p>{{ incident.summary }}</p>
        <div class="incident-actions">
          <button type="button" :disabled="agent.operationsBusy" @click="agent.diagnose(incident.id)">诊断</button>
          <button type="button" :disabled="agent.operationsBusy" @click="agent.acknowledge(incident.id, operatorId, operatorRole)">确认</button>
          <button type="button" :disabled="agent.operationsBusy" @click="agent.makeWorkOrderDraft(incident.id, operatorId, operatorRole)">生成工单草稿</button>
        </div>
      </article>
    </div>
    <div v-if="agent.diagnostic" class="diagnostic-result">
      <div class="diagnostic-heading"><strong>诊断报告 · {{ agent.diagnostic.incidentId }}</strong><span>{{ agent.diagnostic.confidence === 'high' ? '高置信度' : '中置信度' }}</span></div>
      <p>{{ agent.diagnostic.conclusion }}</p>
      <small>证据：{{ agent.diagnostic.evidence.join(' ') }}</small>
      <ol><li v-for="action in agent.diagnostic.recommendedActions.slice(0, 3)" :key="action">{{ action }}</li></ol>
    </div>
    <div v-if="agent.workOrderDraft" class="work-order-confirm">
      <strong>维修工单草稿待确认</strong><p>{{ agent.workOrderDraft.title }}</p>
      <label>操作员 <input v-model="operatorId" aria-label="操作员编号" /></label>
      <label>角色 <select v-model="operatorRole" aria-label="操作员角色"><option value="supervisor">主管</option><option value="maintenance">维修</option></select></label>
      <button type="button" :disabled="agent.operationsBusy" @click="agent.confirmWorkOrder(operatorId, operatorRole)">确认提交工单</button>
    </div>
    <div ref="transcript" class="agent-transcript" role="log" aria-live="polite" aria-label="运维助手对话记录">
      <div v-if="!agent.messages.length" class="agent-empty">选择一个问题开始分析实时数据</div>
      <article v-for="message in agent.messages" :key="message.id" class="agent-message" :class="`message-${message.role}`">
        <div class="message-meta"><span>{{ message.role === 'user' ? '你' : 'AI' }}</span><time>{{ formatTime(message.timestamp) }}</time></div>
        <p>{{ message.content }}</p>
      </article>
      <div v-if="agent.isResponding" class="agent-typing"><i></i><i></i><i></i><span>正在分析实时数据</span></div>
    </div>
    <div class="prompt-list" aria-label="快捷问题">
      <button v-for="prompt in quickPrompts" :key="prompt" type="button" :disabled="agent.isResponding" @click="send(prompt)">{{ prompt }} <span>↗</span></button>
    </div>
    <p v-if="agent.error" class="agent-error" role="alert">{{ agent.error }}</p>
    <form class="agent-input" @submit.prevent="send()">
      <input v-model="draft" aria-label="输入运维问题" placeholder="输入问题，例如：查看一号线良率" :disabled="agent.isResponding" maxlength="120" />
      <button type="submit" aria-label="发送问题" title="发送" :disabled="!canSend">↑</button>
    </form>
  </section>
</template>

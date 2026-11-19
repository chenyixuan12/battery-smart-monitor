<script setup lang="ts">
import { computed } from 'vue'
import { useFactoryStore } from '../../stores/factory'

const factory = useFactoryStore()
const now = new Date()
const timeLabel = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
const connectionLabel = computed(() => ({
  connecting: '数据链路连接中',
  connected: '数据链路正常',
  reconnecting: '链路重连中',
  disconnected: '数据链路断开',
}[factory.connectionStatus]))
const lastSyncLabel = computed(() => factory.lastSyncAt
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(factory.lastSyncAt)
  : '--:--:--')
</script>

<template>
  <footer class="status-bar">
    <div class="status-brand"><span class="brand-mark">S</span><span>PACK 制造执行中心</span></div>
    <div class="status-items">
      <span class="connection" :class="`connection-${factory.connectionStatus}`"><i></i>{{ connectionLabel }}</span>
      <span>流速 <strong class="text-normal">{{ factory.eventRate.toLocaleString() }} evt/s</strong></span>
      <span>同步 <strong>{{ lastSyncLabel }}</strong></span>
      <span>当前班次 <strong>{{ factory.shift }}</strong></span>
      <span>设备总数 <strong>{{ factory.deviceCount }}</strong></span>
      <span>在线 <strong class="text-normal">{{ factory.statusCounts.normal }}</strong></span>
      <span>告警 <strong class="text-alarm">{{ factory.alarmCount }}</strong></span>
    </div>
    <time>{{ timeLabel }}</time>
  </footer>
</template>

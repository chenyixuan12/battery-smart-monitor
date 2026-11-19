<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDashboardStore } from '../../stores/dashboard'
import { useFactoryStore } from '../../stores/factory'

const expanded = ref(false)
const dashboard = useDashboardStore()
const factory = useFactoryStore()
const scene = computed(() => dashboard.scenePerformance)
const stream = computed(() => dashboard.streamPerformance)

const connectionLabel = computed(() => ({
  connecting: 'CONNECTING',
  connected: 'CONNECTED',
  reconnecting: 'RECONNECTING',
  disconnected: 'OFFLINE',
}[factory.connectionStatus]))

function integer(value: number) {
  return Math.round(value).toLocaleString('en-US')
}
</script>

<template>
  <aside class="performance-panel" :class="{ expanded }" aria-label="实时性能监控">
    <button class="performance-toggle" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="perf-live-dot"></span>
      <strong>PERF</strong>
      <span>{{ scene.fps.toFixed(0) }} FPS</span>
      <span>{{ integer(stream.eventsPerSecond) }} evt/s</span>
      <span class="perf-chevron">{{ expanded ? '−' : '+' }}</span>
    </button>

    <div v-if="expanded" class="performance-content">
      <section>
        <h3>RENDER</h3>
        <dl>
          <div><dt>帧率</dt><dd>{{ scene.fps.toFixed(1) }} FPS</dd></div>
          <div><dt>平均 / 峰值</dt><dd>{{ scene.averageFrameMs.toFixed(1) }} / {{ scene.maxFrameMs.toFixed(1) }} ms</dd></div>
          <div><dt>Draw calls</dt><dd>{{ integer(scene.drawCalls) }}</dd></div>
          <div><dt>Triangles</dt><dd>{{ integer(scene.triangles) }}</dd></div>
          <div><dt>Geometry / Texture</dt><dd>{{ scene.geometries }} / {{ scene.textures }}</dd></div>
        </dl>
      </section>

      <section>
        <h3>STREAM</h3>
        <dl>
          <div><dt>输入事件</dt><dd>{{ integer(stream.eventsPerSecond) }}/s</dd></div>
          <div><dt>帧内合并</dt><dd>{{ integer(stream.mergedDevicesPerSecond) }}/s · {{ (stream.mergeRatio * 100).toFixed(1) }}%</dd></div>
          <div><dt>状态变化</dt><dd>{{ integer(stream.statusUpdatesPerSecond) }}/s</dd></div>
          <div><dt>场景批次 / GPU上传</dt><dd>{{ stream.sceneBatchesPerSecond }} / {{ stream.gpuUploadsPerSecond }}</dd></div>
          <div><dt>KPI / Chart</dt><dd>{{ stream.kpiUpdatesPerSecond }} / {{ stream.chartUpdatesPerSecond }} Hz</dd></div>
          <div><dt>Pending / Max</dt><dd>{{ stream.pendingDevices }} / {{ stream.maxPendingDevices }}</dd></div>
        </dl>
      </section>

      <section>
        <h3>LINK</h3>
        <dl>
          <div><dt>连接</dt><dd :class="`perf-${factory.connectionStatus}`">{{ connectionLabel }}</dd></div>
          <div><dt>重连次数</dt><dd>{{ dashboard.reconnectCount }}</dd></div>
        </dl>
      </section>
    </div>
  </aside>
</template>

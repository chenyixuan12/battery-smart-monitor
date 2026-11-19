<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDashboardStore } from '../../stores/dashboard'
import { useFactoryStore } from '../../stores/factory'
import { FactorySceneManager } from '../../core/scene/FactorySceneManager'
import { useRealtimeStream } from '../../composables/useRealtimeStream'
import PerformancePanel from './PerformancePanel.vue'

const canvasContainer = ref<HTMLElement | null>(null)
const dashboard = useDashboardStore()
const factory = useFactoryStore()
const sceneManager = new FactorySceneManager()
const realtime = useRealtimeStream(sceneManager)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!canvasContainer.value) return
  const syncDeviceSelection = ({ deviceId, lineId }: { deviceId: string; lineId: string }) => {
    if (factory.selectedDeviceHistoryId !== deviceId) factory.clearDeviceHistory()
    dashboard.selectedDeviceId = deviceId
    dashboard.selectedLineId = lineId
    dashboard.activeChart = 'oee'
    factory.selectedDeviceId = deviceId
  }
  sceneManager.onDevicePicked = syncDeviceSelection
  sceneManager.onAlarmFocused = syncDeviceSelection
  sceneManager.onPerformanceSample = (sample) => dashboard.applyScenePerformance(sample)
  sceneManager.init(canvasContainer.value)
  realtime.start()
  resizeObserver = new ResizeObserver(() => sceneManager.resize())
  resizeObserver.observe(canvasContainer.value)
})

watch(() => dashboard.selectedDeviceId, (deviceId) => {
  sceneManager.setSelectedDevice(deviceId)
  if (deviceId) sceneManager.focusOnDevice(deviceId)
})

watch(() => dashboard.selectedLineId, (lineId) => sceneManager.highlightLine(lineId))

onBeforeUnmount(() => {
  realtime.stop()
  resizeObserver?.disconnect()
  resizeObserver = null
  sceneManager.destroy()
})
</script>

<template>
  <section class="panel scene-panel" aria-label="PACK 三维车间预览区域">
    <div class="scene-header">
      <div>
        <p class="eyebrow">3D WORKSHOP VIEW</p>
        <h2>PACK 智能车间</h2>
      </div>
      <div class="scene-tools"><span class="scene-chip">6 条产线</span><span class="scene-chip">180 台设备</span></div>
    </div>
    <div ref="canvasContainer" class="scene-canvas" aria-label="PACK 智能车间三维视图">
      <PerformancePanel />
      <div class="scene-axis"><span>X</span><span>Y</span><span>Z</span></div>
    </div>
    <div class="scene-legend">
      <span><i class="legend-normal"></i>运行</span>
      <span><i class="legend-idle"></i>待机</span>
      <span><i class="legend-alarm"></i>告警</span>
      <span class="scene-hint">场景交互区域</span>
    </div>
  </section>
</template>

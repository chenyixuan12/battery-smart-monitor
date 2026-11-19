import { defineStore } from 'pinia'
import type { ChartKind, ScenePerformanceSample, StreamPerformanceSample } from '../types'

interface DashboardState {
  selectedDeviceId: string | null
  selectedLineId: string | null
  activeChart: ChartKind
  scenePerformance: ScenePerformanceSample
  streamPerformance: StreamPerformanceSample
  reconnectCount: number
}

export const useDashboardStore = defineStore('dashboard', {
  state: (): DashboardState => ({
    selectedDeviceId: null,
    selectedLineId: null,
    activeChart: 'capacity',
    scenePerformance: {
      fps: 0, averageFrameMs: 0, maxFrameMs: 0, drawCalls: 0,
      triangles: 0, geometries: 0, textures: 0,
    },
    streamPerformance: {
      eventsPerSecond: 0, mergedDevicesPerSecond: 0, statusUpdatesPerSecond: 0,
      sceneBatchesPerSecond: 0, gpuUploadsPerSecond: 0, kpiUpdatesPerSecond: 0,
      chartUpdatesPerSecond: 0, pendingDevices: 0, maxPendingDevices: 0, mergeRatio: 0,
    },
    reconnectCount: 0,
  }),
  actions: {
    applyScenePerformance(sample: ScenePerformanceSample) {
      this.scenePerformance = sample
    },
    applyStreamPerformance(sample: StreamPerformanceSample) {
      this.streamPerformance = sample
    },
    setReconnectCount(count: number) {
      this.reconnectCount = count
    },
  },
})

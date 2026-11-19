import { onBeforeUnmount } from 'vue'
import type { FactorySceneManager } from '../core/scene/FactorySceneManager'
import { RealtimeClient } from '../core/realtime/RealtimeClient'
import { StreamScheduler } from '../core/realtime/StreamScheduler'
import { useFactoryStore } from '../stores/factory'
import { useDashboardStore } from '../stores/dashboard'

/** Connects the framework-agnostic realtime pipeline to Three.js and low-frequency Pinia state. */
export function useRealtimeStream(sceneManager: FactorySceneManager) {
  const factory = useFactoryStore()
  const dashboard = useDashboardStore()
  const scheduler = new StreamScheduler({
    initialOutput: factory.totalOutput,
    initialQuality: factory.quality,
    onSceneBatch: (patches) => sceneManager.updateDeviceStatuses(patches),
    onMetrics: (snapshot) => factory.applyRealtimeSnapshot(snapshot),
    onChartPoint: (point) => factory.appendCapacityPoint(point),
    onOeePoint: (point) => factory.appendOeePoint(point),
    onEnergyPoint: (point) => factory.appendEnergyPoint(point),
    getSelectedDeviceId: () => dashboard.selectedDeviceId,
    onDeviceHistoryPoint: (point) => factory.appendDeviceHistory(point),
    onPerformance: (sample) => dashboard.applyStreamPerformance(sample),
  })
  const client = new RealtimeClient({
    scheduler,
    onStatusChange: (status) => factory.setConnectionStatus(status),
    onReconnectCount: (count) => dashboard.setReconnectCount(count),
  })
  let disposed = false

  function start() {
    if (!disposed) client.start()
  }

  function stop() {
    if (disposed) return
    disposed = true
    client.stop()
    scheduler.dispose()
  }

  onBeforeUnmount(stop)
  return { start, stop }
}

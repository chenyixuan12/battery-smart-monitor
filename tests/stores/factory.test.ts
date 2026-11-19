import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFactoryStore } from '../../src/stores/factory'

describe('factory store realtime state', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps status totals and caps capacity history at 60 points', () => {
    const store = useFactoryStore()
    store.applyRealtimeSnapshot({
      statusCounts: { normal: 164, idle: 13, alarm: 3 },
      averageOee: 88.2,
      yieldRate: 98.7,
      totalOutput: 13_000,
      quality: { qualified: 9_870, rework: 100, scrap: 30 },
      lineMetrics: Array.from({ length: 6 }, (_, index) => ({
        lineId: `PACK-0${index + 1}`, lineName: `PACK 0${index + 1}`,
        output: 2_000, yieldRate: 98.7, averageOee: 88.2, energyKwh: 500,
      })),
      totalEnergyKwh: 3_000,
      defects: [{ category: '焊接不良', count: 42 }],
      eventRate: 4_000,
      lastSyncAt: 123,
    })
    for (let index = 0; index < 70; index += 1) {
      store.appendCapacityPoint({ timestamp: index, value: index })
      store.appendDeviceHistory({ deviceId: 'PACK-01-EQ-01', timestamp: index, oee: 88, temperature: 31, voltage: 3.8, current: 80 })
    }

    expect(Object.values(store.statusCounts).reduce((sum, value) => sum + value, 0)).toBe(180)
    expect(store.capacityTrend).toHaveLength(60)
    expect(store.selectedDeviceHistory).toHaveLength(60)
    expect(store.eventRate).toBe(4_000)
  })
})

import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts, EChartsOption } from 'echarts'

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/** Owns one ECharts instance and keeps it sized with its container. */
export function useEChart(container: Ref<HTMLElement | null>) {
  const chart = shallowRef<ECharts | null>(null)
  let resizeObserver: ResizeObserver | null = null

  // The container is only available after mount; initialize the chart once it exists.
  onMounted(() => {
    if (!container.value) return

    chart.value = echarts.init(container.value, undefined, { renderer: 'canvas' })
    resizeObserver = new ResizeObserver(() => chart.value?.resize())
    resizeObserver.observe(container.value)
  })

  function setOption(option: EChartsOption) {
    chart.value?.setOption(option, { notMerge: true })
  }

  // Release observers and canvas resources when the owning Vue component unmounts.
  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    chart.value?.dispose()
    chart.value = null
  })

  return { chart, setOption }
}

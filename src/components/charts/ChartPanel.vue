<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import type { ChartKind, LineRealtimeMetrics } from '../../types'
import { useDashboardStore } from '../../stores/dashboard'
import { useFactoryStore } from '../../stores/factory'
import { useEChart } from '../../composables/useEChart'

const dashboard = useDashboardStore()
const factory = useFactoryStore()
const chartElement = ref<HTMLElement | null>(null)
const { chart, setOption } = useEChart(chartElement)

const tabs: Array<{ id: ChartKind; label: string }> = [
  { id: 'capacity', label: '产能' }, { id: 'yield', label: '良率' },
  { id: 'oee', label: 'OEE' }, { id: 'energy', label: '能耗' },
  { id: 'defects', label: '不良' },
]
const visibleLines = computed(() => dashboard.selectedLineId
  ? factory.lineMetrics.filter((line) => line.lineId === dashboard.selectedLineId)
  : factory.lineMetrics)
const axisStyle = { axisLabel: { color: '#70848b', fontSize: 9 }, axisLine: { lineStyle: { color: '#26373c' } }, axisTick: { show: false } }
const grid = { left: 42, right: 18, top: 26, bottom: 27 }
const tooltip = { trigger: 'axis' as const, backgroundColor: '#101a20', borderColor: '#273941', textStyle: { color: '#e6f0f1' } }

function lineData(metric: keyof Pick<LineRealtimeMetrics, 'output' | 'yieldRate' | 'averageOee' | 'energyKwh'>) {
  return visibleLines.value.map((line) => ({ value: Number(line[metric].toFixed(2)), name: line.lineName, lineId: line.lineId }))
}

function barOption(metric: 'output' | 'yieldRate' | 'averageOee' | 'energyKwh', name: string, color: string, max?: number): EChartsOption {
  return {
    grid, tooltip,
    xAxis: { type: 'category', data: visibleLines.value.map((line) => line.lineName.replace('PACK ', 'L')), ...axisStyle },
    yAxis: { type: 'value', min: 0, max, splitNumber: 3, axisLabel: { color: '#70848b', fontSize: 9 }, splitLine: { lineStyle: { color: '#1d2a30', type: 'dashed' } } },
    series: [{ name, type: 'bar', barMaxWidth: 24, data: lineData(metric), itemStyle: { color, borderRadius: [2, 2, 0, 0] } }],
  }
}

const option = computed<EChartsOption>(() => {
  if (dashboard.activeChart === 'capacity') return barOption('output', '累计产出', '#44d6b1')
  if (dashboard.activeChart === 'yield') return barOption('yieldRate', '良率', '#5db8d2', 100)
  if (dashboard.activeChart === 'energy') return barOption('energyKwh', '能耗 kWh', '#f3b653')
  if (dashboard.activeChart === 'defects') {
    return {
      grid: { left: 66, right: 22, top: 18, bottom: 20 }, tooltip,
      xAxis: { type: 'value', splitNumber: 3, axisLabel: { color: '#70848b', fontSize: 9 }, splitLine: { lineStyle: { color: '#1d2a30', type: 'dashed' } } },
      yAxis: { type: 'category', data: factory.defects.map((item) => item.category), ...axisStyle },
      series: [{ name: '不良数', type: 'bar', data: factory.defects.map((item) => item.count), barMaxWidth: 13, itemStyle: { color: '#ef6d68', borderRadius: [0, 2, 2, 0] } }],
    }
  }
  if (dashboard.selectedDeviceId && factory.selectedDeviceHistory.length > 0) {
    const history = factory.selectedDeviceHistory
    return {
      grid, tooltip,
      legend: { top: 0, right: 4, itemWidth: 9, itemHeight: 5, textStyle: { color: '#829599', fontSize: 8 } },
      xAxis: { type: 'category', boundaryGap: false, data: history.map((point) => new Date(point.timestamp).toLocaleTimeString('zh-CN', { minute: '2-digit', second: '2-digit' })), ...axisStyle },
      yAxis: [
        { type: 'value', min: 60, max: 100, splitNumber: 3, axisLabel: { color: '#70848b', fontSize: 8 }, splitLine: { lineStyle: { color: '#1d2a30', type: 'dashed' } } },
        { type: 'value', min: 20, max: 60, show: false },
      ],
      series: [
        { name: 'OEE %', type: 'line', smooth: true, symbol: 'none', data: history.map((point) => point.oee.toFixed(1)), lineStyle: { color: '#44d6b1', width: 2 } },
        { name: '温度 °C', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'none', data: history.map((point) => point.temperature.toFixed(1)), lineStyle: { color: '#f3b653', width: 1.5 } },
      ],
    }
  }
  return barOption('averageOee', 'OEE', '#44d6b1', 100)
})

const summary = computed(() => {
  if (dashboard.activeChart === 'capacity') return { label: '当班累计产出', value: factory.totalOutput.toLocaleString('en-US'), unit: '件' }
  if (dashboard.activeChart === 'yield') return { label: '综合良率', value: factory.yieldRate.toFixed(2), unit: '%' }
  if (dashboard.activeChart === 'oee') {
    const deviceOee = factory.selectedDeviceHistory.at(-1)?.oee
    return { label: dashboard.selectedDeviceId ?? '设备平均 OEE', value: (deviceOee ?? factory.averageOee).toFixed(1), unit: '%' }
  }
  if (dashboard.activeChart === 'energy') return { label: '累计能耗', value: factory.totalEnergyKwh.toFixed(1), unit: 'kWh' }
  return { label: '累计不良', value: factory.defects.reduce((sum, item) => sum + item.count, 0).toString(), unit: '项' }
})

function selectChart(id: ChartKind) { dashboard.activeChart = id }
function selectLine(lineId: string | null) {
  dashboard.selectedLineId = lineId
  dashboard.selectedDeviceId = null
  factory.selectedDeviceId = null
  factory.clearDeviceHistory()
}

onMounted(async () => {
  await nextTick()
  setOption(option.value)
  chart.value?.on('click', (params) => {
    const data = params.data as { lineId?: string } | undefined
    if (data?.lineId) selectLine(data.lineId)
  })
})
watch(option, (nextOption) => setOption(nextOption))
</script>

<template>
  <section class="panel chart-panel" aria-labelledby="chart-title">
    <div class="chart-header">
      <div><p class="eyebrow">PRODUCTION ANALYTICS</p><h2 id="chart-title">数据分析</h2></div>
      <div class="chart-tabs" role="tablist" aria-label="图表类型">
        <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="dashboard.activeChart === tab.id" :class="{ active: dashboard.activeChart === tab.id }" @click="selectChart(tab.id)">{{ tab.label }}</button>
      </div>
    </div>
    <div class="chart-line-filter" aria-label="产线筛选">
      <button type="button" :class="{ active: !dashboard.selectedLineId }" @click="selectLine(null)">全厂</button>
      <button v-for="line in factory.lineMetrics" :key="line.lineId" type="button" :class="{ active: dashboard.selectedLineId === line.lineId }" @click="selectLine(line.lineId)">{{ line.lineId.replace('PACK-', 'L') }}</button>
    </div>
    <div class="chart-summary">
      <span>{{ summary.label }}</span><strong>{{ summary.value }}<small> {{ summary.unit }}</small></strong>
      <span class="chart-change">{{ dashboard.selectedLineId ?? 'ALL LINES' }}</span>
    </div>
    <div ref="chartElement" class="chart-canvas" aria-label="ECharts 实时工业图表"></div>
  </section>
</template>

<script setup lang="ts">
import { useFactoryStore } from '../../stores/factory'

const factory = useFactoryStore()
</script>

<template>
  <section class="panel kpi-panel" aria-labelledby="kpi-title">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">FACTORY OVERVIEW</p>
        <h2 id="kpi-title">生产总览</h2>
      </div>
      <span class="live-mark"><i></i> LIVE</span>
    </div>

    <div class="kpi-list">
      <article v-for="(item, index) in factory.kpis" :key="item.label" class="kpi-item">
        <div class="kpi-topline">
          <span class="kpi-index">0{{ index + 1 }}</span>
          <span class="kpi-label">{{ item.label }}</span>
          <span v-if="item.tone === 'critical'" class="alarm-dot"></span>
        </div>
        <div class="kpi-value-line">
          <strong :class="`tone-${item.tone}`">{{ item.value }}</strong>
          <span class="kpi-unit">{{ item.unit }}</span>
        </div>
        <div class="kpi-foot" :class="`tone-${item.tone}`">{{ item.change }}</div>
        <div class="kpi-track"><span :class="`track-${item.tone}`" :style="{ width: `${[86, 72, 83, 22][index]}%` }"></span></div>
      </article>
    </div>

    <div class="line-summary">
      <div class="summary-heading"><span>设备运行状态</span><span>180 台</span></div>
      <div class="status-strip"><span class="status-normal"></span><span class="status-idle"></span><span class="status-alarm"></span></div>
      <div class="status-legend">
        <span><i class="legend-normal"></i>正常 {{ factory.statusCounts.normal }}</span>
        <span><i class="legend-idle"></i>待机 {{ factory.statusCounts.idle }}</span>
        <span><i class="legend-alarm"></i>告警 {{ factory.statusCounts.alarm }}</span>
      </div>
    </div>
  </section>
</template>

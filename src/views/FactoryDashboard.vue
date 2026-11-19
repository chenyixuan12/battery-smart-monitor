<script setup lang="ts">
import KpiPanel from '../components/dashboard/KpiPanel.vue'
import StatusBar from '../components/dashboard/StatusBar.vue'
import ScenePlaceholder from '../components/scene/ScenePlaceholder.vue'
import AgentPanel from '../components/agent/AgentPanel.vue'
import ChartPanel from '../components/charts/ChartPanel.vue'
</script>

<template>
  <main class="dashboard-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-symbol"><span></span><span></span><span></span></div>
        <div><p class="eyebrow">SMART MANUFACTURING / POWER BATTERY</p><h1>动力电池 PACK 智能制造中心</h1></div>
      </div>
      <div class="topbar-meta"><span class="plant-select">华东制造基地 <span>⌄</span></span><span class="date-block"><small>生产日期</small><strong>2026 / 11 / 09</strong></span><span class="topbar-divider"></span><span class="weather"><span>☼</span> 22°C <small>晴</small></span></div>
    </header>

    <div class="dashboard-grid">
      <KpiPanel />
      <ScenePlaceholder />
      <aside class="right-column">
        <AgentPanel />
        <ChartPanel />
      </aside>
    </div>

    <StatusBar />
  </main>
</template>

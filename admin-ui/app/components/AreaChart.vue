<script setup>
// Multi-series responsive area chart: gradient fills, dashed grid, max label, live end-point marker.
const props = defineProps({ series: { type: Array, required: true }, height: { type: Number, default: 170 }, unit: { type: String, default: '' }, minMax: { type: Number, default: 1 } })
const id = useId()
const W = 600, H = computed(() => props.height)
const max = computed(() => Math.max(props.minMax, ...props.series.flatMap(s => s.data)) * 1.15)
const path = (d) => d.length < 2 ? '' : d.map((v, i) => (i ? 'L' : 'M') + (i / (d.length - 1) * W).toFixed(1) + ' ' + (H.value - 6 - v / max.value * (H.value - 14)).toFixed(1)).join(' ')
const last = s => { const d = s.data; if (d.length < 2) return null; return [W, H.value - 6 - d[d.length - 1] / max.value * (H.value - 14)] }
const fmt = v => v >= 100 ? v.toFixed(0) : v.toFixed(1)
</script>
<template>
  <div class="ac">
    <div class="ac-max mono">{{ fmt(max) }}{{ unit }}</div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" width="100%" :height="H" role="img" aria-label="chart">
      <defs><linearGradient v-for="(s, i) in series" :id="`ac${id}${i}`" :key="i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="s.color" :stop-opacity="s.fill === false ? 0 : .32" /><stop offset="1" :stop-color="s.color" stop-opacity="0" /></linearGradient></defs>
      <line v-for="g in 4" :key="g" x1="0" x2="600" :y1="(H - 6) * g / 4" :y2="(H - 6) * g / 4" stroke="rgba(255,255,255,.06)" stroke-dasharray="3 5" vector-effect="non-scaling-stroke" />
      <template v-for="(s, i) in series" :key="'s' + i">
        <path v-if="s.fill !== false && s.data.length > 1" :d="path(s.data) + ` L${W} ${H} L0 ${H} Z`" :fill="`url(#ac${id}${i})`" />
        <path :d="path(s.data)" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </template>
    </svg>
    <div class="ac-leg"><span v-for="(s, i) in series" :key="i"><i :style="{ background: s.color }" />{{ s.label }}<b class="mono">{{ s.data.length ? fmt(s.data[s.data.length - 1]) : 0 }}{{ unit }}</b></span></div>
  </div>
</template>
<style scoped>
.ac { position: relative }
.ac-max { position: absolute; top: 0; left: 2px; font-size: 10.5px; color: var(--dim) }
.ac-leg { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--mut) }
.ac-leg span { display: inline-flex; align-items: center; gap: 6px } .ac-leg i { width: 8px; height: 8px; border-radius: 3px } .ac-leg b { color: var(--txt); font-weight: 600 }
</style>

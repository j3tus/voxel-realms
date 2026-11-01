<script setup>
const props = defineProps({ data: { type: Array, default: () => [] }, color: { type: String, default: '#6ee7a8' }, height: { type: Number, default: 38 }, min: { type: Number, default: 0 } })
const id = useId()
const W = 120
const pts = computed(() => {
  const d = props.data.length > 1 ? props.data : [0, 0]
  const lo = Math.min(props.min, ...d), hi = Math.max(...d, lo + 1e-6), H = props.height - 4
  return d.map((v, i) => [i / (d.length - 1) * W, 2 + H - (v - lo) / (hi - lo) * H])
})
const line = computed(() => pts.value.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '))
const area = computed(() => line.value + ` L${W} ${props.height} L0 ${props.height} Z`)
</script>
<template>
  <svg :viewBox="`0 0 ${W} ${height}`" preserveAspectRatio="none" :height="height" width="100%" aria-hidden="true" style="display:block">
    <defs><linearGradient :id="'sp' + id" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color" stop-opacity=".35" /><stop offset="1" :stop-color="color" stop-opacity="0" /></linearGradient></defs>
    <path :d="area" :fill="`url(#sp${id})`" /><path :d="line" fill="none" :stroke="color" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
</template>

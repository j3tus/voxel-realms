<script setup>
const props = defineProps({ items: { type: Array, default: () => [] }, size: { type: Number, default: 150 }, label: { type: String, default: '' } })
const total = computed(() => props.items.reduce((a, i) => a + i.value, 0))
const R = 52, C = 2 * Math.PI * R
const segs = computed(() => { let off = 0; return props.items.filter(i => i.value > 0).map(i => { const len = total.value ? i.value / total.value * C : 0; const s = { ...i, len, off }; off += len; return s }) })
</script>
<template>
  <div class="dn" :style="{ width: size + 'px', height: size + 'px' }">
    <svg viewBox="0 0 140 140" :width="size" :height="size" role="img" aria-label="breakdown">
      <circle cx="70" cy="70" :r="R" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="13" />
      <circle v-for="(s, i) in segs" :key="i" cx="70" cy="70" :r="R" fill="none" :stroke="s.color" stroke-width="13" stroke-linecap="round" :stroke-dasharray="`${Math.max(0, s.len - 5)} ${C}`" :stroke-dashoffset="-s.off" transform="rotate(-90 70 70)" />
    </svg>
    <div class="dn-c"><b class="num">{{ total }}</b><span>{{ label }}</span></div>
  </div>
</template>
<style scoped>
.dn { position: relative; flex: none } .dn-c { position: absolute; inset: 0; display: grid; place-content: center; text-align: center }
.dn-c b { font: 700 28px var(--head); line-height: 1 } .dn-c span { font-size: 11.5px; color: var(--mut); margin-top: 3px }
</style>

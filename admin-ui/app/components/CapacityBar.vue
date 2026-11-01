<script setup>
// Server capacity: how many "player slots" the Pi can still carry, why it is limited, and how big the next custom game may be.
const s = useAdmin()
const c = computed(() => (s.status && s.status.capacity) || { level: 'ok', used: 0, budget: 0, free: 0, maxRoom: 0, reasons: [], botDensity: 1, scale: 1 })
const pct = computed(() => c.value.budget ? Math.min(100, Math.round(c.value.used / c.value.budget * 100)) : 0)
const cls = computed(() => c.value.level === 'full' ? 'bad' : c.value.level === 'busy' ? 'warn' : 'ok')
</script>
<template>
  <div class="cap">
    <div class="row between wrap"><div class="row gap-sm"><span class="pill" :class="cls"><i />{{ c.level === 'ok' ? 'Plenty of room' : c.level === 'busy' ? 'Getting busy' : 'At capacity' }}</span>
      <span class="mut sm"><b class="num" style="color:var(--txt)">{{ c.used }}</b> of <b class="num" style="color:var(--txt)">{{ c.budget }}</b> player slots in use · <b class="num" style="color:var(--txt)">{{ c.free }}</b> free</span></div>
      <span class="mut xs">next custom game up to <b class="num" style="color:var(--txt)">{{ c.maxRoom }}</b> players · bot fill ×{{ c.botDensity }}</span></div>
    <div class="bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :class="cls" :style="{ width: Math.max(2, pct) + '%' }" /></div>
    <p v-if="c.reasons && c.reasons.length" class="mut xs" style="margin:8px 0 0">Reduced by: {{ c.reasons.join(', ') }} — the server shrinks rooms and bot fill automatically while this lasts.</p>
  </div>
</template>
<style scoped>
.bar { height: 10px; border-radius: 99px; background: rgba(255, 255, 255, .07); overflow: hidden; margin-top: 12px; box-shadow: 0 1px 2px rgba(0, 0, 0, .5) inset }
.bar i { display: block; height: 100%; border-radius: 99px; transition: width .6s var(--ease); background: var(--acc-grad); box-shadow: 0 0 14px rgba(110, 231, 168, .5) } .bar i.warn { background: linear-gradient(90deg, #fbbf24, #fb923c); box-shadow: 0 0 14px rgba(251, 191, 36, .5) } .bar i.bad { background: linear-gradient(90deg, #fb7185, #f43f5e); box-shadow: 0 0 14px rgba(251, 113, 133, .5) }
</style>

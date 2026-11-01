<script setup>
const s = useAdmin(), world = ref(''), text = ref(''), box = ref(null), hist = ref([])
const load = async () => { hist.value = await api('GET', '/chat' + (world.value ? '?world=' + world.value : '') + (world.value ? '&n=150' : '?n=150')) }
onMounted(load); watch(world, load)
const lines = computed(() => {
  const seen = new Set(), all = [...hist.value, ...s.chat].filter(c => !world.value || c.world === world.value)
  return all.filter(c => { const k = c.at + '|' + c.name + '|' + c.text; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => a.at - b.at).slice(-200)
})
watch(() => lines.value.length, () => nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight }))
onMounted(() => nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight }))
const wn = id => (s.worlds.find(w => w.id === id) || {}).name || id
const send = act(async () => { const t = text.value.trim(); if (!t) return; await api('POST', '/announce', { text: t }); text.value = ''; toast('Announcement sent to every world') })
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Chat</h1><p>Live chat from every world</p></div><div class="actions"><select v-model="world" class="select" style="width:210px" aria-label="World"><option value="">All worlds</option><option v-for="w in s.worlds" :key="w.id" :value="w.id">{{ w.name }}</option></select></div></div>
    <div class="card flush">
      <div ref="box" class="msgs"><div v-for="(c, i) in lines" :key="i" class="m" :class="{ sys: c.sys }"><span class="t mono">{{ clock(c.at) }}</span><span class="w pill">{{ wn(c.world) }}</span><b>{{ c.sys ? 'system' : c.name }}</b><span class="x">{{ c.text }}</span></div>
        <div v-if="!lines.length" class="empty"><b>No messages yet</b>Chat from players shows up here live.</div></div>
      <form class="send" @submit.prevent="send"><input v-model="text" class="input" maxlength="200" placeholder="Broadcast an announcement to every world…" aria-label="Announcement"><button class="btn primary" :disabled="!text.trim()"><Icon name="send" />Announce</button></form>
    </div>
  </div>
</template>
<style scoped>
.msgs { height: min(60vh, 560px); overflow: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 3px }
.m { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; font-size: 13.5px; flex-wrap: wrap } .m .t { color: var(--dim); font-size: 11.5px } .m b { color: var(--acc2) } .m.sys b { color: var(--amb) } .m .x { color: var(--txt); word-break: break-word }
.m .w { height: 18px; font-size: 10.5px }
.send { display: flex; gap: 10px; padding: 14px; border-top: 1px solid var(--line); background: rgba(0, 0, 0, .2) }
</style>

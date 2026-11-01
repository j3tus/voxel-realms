<script setup>
const s = useAdmin(), world = ref(''), cmd = ref(''), out = ref([]), tab = ref('console'), term = ref(null), hist = [], hi = ref(0)
onMounted(() => { world.value = (s.worlds[0] || {}).id || 'main' })
const QUICK = ['help admin', 'list all', 'rooms', 'capacity', 'status', 'bot list', 'bot add 2', 'round restart', 'time day', 'weather clear', 'save']
const scroll = () => nextTick(() => { if (term.value) term.value.scrollTop = term.value.scrollHeight })
const run = act(async (c) => {
  c = (c ?? cmd.value).trim(); if (!c) return
  hist.unshift(c); hi.value = -1; cmd.value = ''; out.value.push({ k: 'cmd', t: `${world.value} › ${c}` })
  const r = await api('POST', `/worlds/${world.value}/command`, { cmd: c }); out.value.push({ k: 'out', t: r.output }); scroll()
})
const key = e => { if (e.key === 'ArrowUp') { e.preventDefault(); hi.value = Math.min(hist.length - 1, hi.value + 1); cmd.value = hist[hi.value] || '' } else if (e.key === 'ArrowDown') { e.preventDefault(); hi.value = Math.max(-1, hi.value - 1); cmd.value = hist[hi.value] || '' } }
watch(() => s.logs.length, () => { if (tab.value === 'log') scroll() })
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Console</h1><p>Run server commands and watch the live log</p></div>
      <div class="actions"><select v-model="world" class="select" style="width:210px" aria-label="World"><option v-for="w in s.worlds" :key="w.id" :value="w.id">{{ w.name }}</option></select></div></div>
    <div class="chips" style="margin-bottom:14px"><button class="chip" :class="{ on: tab === 'console' }" @click="tab = 'console'">Console</button><button class="chip" :class="{ on: tab === 'log' }" @click="tab = 'log'; scroll()">Server log</button></div>
    <div class="card flush">
      <div ref="term" class="term big">
        <template v-if="tab === 'console'"><div v-if="!out.length" class="t">Type a command below, e.g. <span class="cmd">help</span> or <span class="cmd">list</span>.</div><div v-for="(o, i) in out" :key="i" :class="o.k === 'cmd' ? 'cmd' : ''" style="white-space:pre-wrap">{{ o.t }}</div></template>
        <template v-else><div v-for="(e, i) in s.logs" :key="i" :class="e.level"><span class="t">{{ clock(e.at) }}</span>  {{ e.msg }}</div></template>
      </div>
      <form v-if="tab === 'console'" class="send" @submit.prevent="run()"><span class="prompt mono">›</span><input v-model="cmd" class="input mono" placeholder="command…" aria-label="Command" autocomplete="off" @keydown="key"><button class="btn primary">Run</button></form>
      <div v-if="tab === 'console'" class="chips quick"><button v-for="c in QUICK" :key="c" class="chip" @click="run(c)">{{ c }}</button></div>
    </div>
  </div>
</template>
<style scoped>
.term.big { height: min(58vh, 520px); border: 0; border-radius: 0; background: rgba(0, 0, 0, .3) }
.send { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line) } .prompt { color: var(--acc); font-size: 18px }
.quick { padding: 0 14px 14px }
</style>

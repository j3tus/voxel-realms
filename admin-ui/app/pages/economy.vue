<script setup>
const s = useAdmin(), wid = ref(''), e = ref(null), loading = ref(false)
const b = reactive({ id: 5, qty: 8, reward: 50 })
const ecoWorlds = computed(() => s.worlds.filter(w => w.economy))
onMounted(async () => { await loadWorlds().catch(() => {}); wid.value = (ecoWorlds.value[0] || s.worlds[0] || {}).id || ''; })
const load = async () => { if (!wid.value) return; loading.value = true; try { e.value = await api('GET', `/worlds/${wid.value}/economy`) } finally { loading.value = false } }
watch(wid, act(load))
const prices = computed(() => e.value ? Object.entries(e.value.prices).map(([id, m]) => ({ id, name: blockName(+id), m, hist: (e.value.history && e.value.history[id]) || [m] })).sort((a, c) => c.m - a.m) : [])
const addBounty = act(async () => { await api('POST', `/worlds/${wid.value}/bounties`, { id: +b.id, qty: +b.qty, reward: +b.reward }); toast('Bounty added'); await load() })
const rmBounty = act(async x => { await api('DELETE', `/worlds/${wid.value}/bounties/${x.uid}`); toast('Bounty removed'); await load() })
const reroll = act(async () => { await api('POST', `/worlds/${wid.value}/economy/reroll`); toast('Bounties re-rolled'); await load() })
const wallet = act(async () => { const n = await promptBox('Adjust wallet', 'Player name'); if (!n) return; const d = await promptBox('Adjust wallet', 'Coins to add (negative removes)', '100', 'number'); if (d == null || d === '') return; const r = await api('POST', `/worlds/${wid.value}/wallet`, { name: n, delta: parseInt(d) || 0 }); toast(`${n} now has ${r.coins} coins`); await load() })
const override = act(async p => { const v = await promptBox('Price multiplier: ' + p.name, 'Multiplier (0.35 – 2.5)', p.m.toFixed(2), 'number'); if (v) { await api('PATCH', `/worlds/${wid.value}/economy`, { item: +p.id, mult: +v }); toast('Price updated'); await load() } })
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Economy</h1><p>Survival worlds with an economy: leaderboard, bounties, market prices and wallets</p></div>
      <div class="actions"><select v-model="wid" class="select" style="width:220px" aria-label="World"><option v-for="w in s.worlds" :key="w.id" :value="w.id">{{ w.name }}{{ w.economy ? '' : ' (no economy)' }}</option></select><button class="btn" @click="reroll"><Icon name="bolt" />Re-roll bounties</button><button class="btn" @click="wallet"><Icon name="db" />Adjust wallet…</button></div></div>
    <div v-if="e && !e.enabled" class="card empty"><b>This world has no economy</b>Turn on “Economy” in its ⋯ menu on the Games page (it needs a survival-style world).</div>
    <template v-if="e && e.enabled">
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card flush"><div class="card-h" style="padding:18px 18px 0"><h3>Leaderboard</h3><span class="sub">by coins</span></div>
          <table class="tbl"><thead><tr><th>#</th><th>Player</th><th class="r">Coins</th><th class="r">Earned</th><th class="r">Spent</th></tr></thead><tbody>
            <tr v-for="(r, i) in e.leaderboard" :key="r.name"><td class="mut">{{ i + 1 }}</td><td><b>{{ r.name }}</b></td><td class="r num mono">{{ r.coins.toLocaleString() }}</td><td class="r num mono mut">{{ r.earned.toLocaleString() }}</td><td class="r num mono mut">{{ r.spent.toLocaleString() }}</td></tr>
            <tr v-if="!e.leaderboard.length"><td colspan="5"><div class="empty"><b>No wallets yet</b>Players appear once they earn or spend coins.</div></td></tr></tbody></table></div>
        <div class="card flush"><div class="card-h" style="padding:18px 18px 0"><h3>Active bounties</h3><span class="sub">players are paid to deliver these</span></div>
          <form class="row wrap" style="padding:0 18px 14px" @submit.prevent="addBounty"><select v-model.number="b.id" class="select" style="width:170px" aria-label="Item"><option v-for="(n, i) in BLOCK_NAMES.slice(1)" :key="i" :value="i + 1">{{ n }}</option></select><input v-model.number="b.qty" class="input" type="number" min="1" max="64" style="width:80px" aria-label="Quantity" placeholder="Qty"><input v-model.number="b.reward" class="input" type="number" min="1" style="width:100px" aria-label="Reward" placeholder="Reward"><button class="btn primary">Add</button></form>
          <table class="tbl"><thead><tr><th>Item</th><th>Qty</th><th>Reward</th><th>Status</th><th class="r" /></tr></thead><tbody>
            <tr v-for="x in e.bounties" :key="x.uid"><td><b>{{ blockName(x.id) }}</b></td><td class="num">{{ x.qty }}</td><td class="num mono">{{ x.reward }} c</td><td><span class="pill" :class="x.taken ? 'ok' : 'info'"><i />{{ x.taken ? 'completed' : 'open' }}</span></td><td class="r"><button class="btn sm ghost" @click="rmBounty(x)">Remove</button></td></tr>
            <tr v-if="!e.bounties.length"><td colspan="5"><div class="empty"><b>No bounties</b>Add one above or re-roll.</div></td></tr></tbody></table></div>
      </div>
      <div class="card"><div class="card-h"><h3>Market</h3><span class="sub">click a price to override its multiplier</span></div>
        <div class="mk"><button v-for="p in prices" :key="p.id" class="pg" :class="p.m > 1.05 ? 'up' : p.m < .95 ? 'down' : ''" @click="override(p)"><span class="nm">{{ p.name }}</span><b class="num mono">×{{ p.m.toFixed(2) }}</b><Spark :data="p.hist" :color="p.m > 1.05 ? '#fb7185' : '#6ee7a8'" :height="26" :min="0.3" /></button></div></div>
    </template>
    <div v-else-if="!e" class="empty">{{ loading ? 'Loading…' : 'Pick a world.' }}</div>
  </div>
</template>
<style scoped>
.mk { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px }
.pg { text-align: left; padding: 10px 12px 0; border-radius: 12px; background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent), var(--s2); border: 1px solid var(--line); color: var(--txt); overflow: hidden; transition: transform .12s var(--ease), border-color .15s }
.pg:hover { transform: translateY(-2px); border-color: var(--line2) } .pg.up { border-color: rgba(251, 113, 133, .35) } .pg.down { border-color: rgba(110, 231, 168, .35) }
.pg .nm { display: block; font-size: 12px; color: var(--mut) } .pg b { font-size: 17px }
</style>

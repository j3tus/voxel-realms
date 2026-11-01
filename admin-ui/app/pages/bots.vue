<script setup>
const s = useAdmin(), g = ref({ enabled: true, skill: 'normal', density: 1, total: 0, capDensity: 1 }), busy = ref(false)
const BOTMODES = ['pvp', 'tdm', 'gungame', 'zombies', 'raid', 'td', 'royale', 'hide', 'ctf', 'snd', 'bedwars']
const load = async () => { g.value = await api('GET', '/bots') }
onMounted(act(load))
const live = id => (s.status && s.status.worlds.find(x => x.id === id)) || {}
const rows = computed(() => s.worlds.filter(w => BOTMODES.includes(w.mode)).sort((a, b) => (live(b.id).humans || 0) - (live(a.id).humans || 0) || a.name.localeCompare(b.name)))
const saveG = act(async patch => { g.value = { ...g.value, ...(await api('PATCH', '/bots', patch)) }; toast('Bot settings saved') })
const patchW = (w, body, msg) => act(async () => { const r = await api('PATCH', `/worlds/${w.id}/bots`, body); w.bots = r.bots ?? undefined; w.botSkill = r.skill ?? undefined; w.botsFixed = r.fixed; w.botsPaused = r.paused; if (msg) toast(msg) })()
const summon = w => act(async () => {
  const n = await promptBox('Summon bots into ' + w.name, 'How many? (1–16)', '2', 'number'); if (!n) return
  const r = await api('POST', `/worlds/${w.id}/bots/summon`, { n: Math.max(1, Math.min(16, +n)) }); toast(`Summoned ${r.added} bot${r.added === 1 ? '' : 's'}: they stay until you remove them`)
})()
const remove = (w, n = 1) => act(async () => { const r = await api('POST', `/worlds/${w.id}/bots/remove`, { n }); toast(`Removed ${r.removed}`) })()
const clear = w => act(async () => { if (!(await confirmBox('Remove every bot?', `All bots in ${w.name}, including summoned ones.`, true, 'Remove all'))) return; const r = await api('POST', `/worlds/${w.id}/bots/clear`); toast(`Removed ${r.removed}`) })()
const totalNow = computed(() => s.status ? s.status.bots : 0)
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Bots</h1><p>{{ totalNow }} bots running · they only exist while a human is playing and vanish when everyone leaves</p></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Global bot settings</h3></div>
        <div class="row between" style="margin-bottom:14px"><div><b>Bots enabled</b><div class="mut sm">Off removes every bot and stops all automatic fill.</div></div><Switch :model-value="g.enabled" label="Bots enabled" @change="v => saveG({ enabled: v })" /></div>
        <div class="field" style="margin-bottom:14px"><label>Default skill</label><div class="chips"><button v-for="k in ['easy', 'normal', 'hard']" :key="k" class="chip" :class="{ on: g.skill === k }" @click="saveG({ skill: k })">{{ k }}</button></div></div>
        <div class="field"><label>Fill density ×{{ g.density }} <span class="dim">(how full automatic games are kept)</span></label><input type="range" min="0" max="3" step="0.25" :value="g.density" @change="e => saveG({ density: +e.target.value })" style="width:100%;accent-color:#6ee7a8"></div></div>
      <div class="card"><div class="card-h"><h3>Server headroom</h3><span class="sub">bots are the first thing to shrink</span></div><CapacityBar />
        <p class="mut sm" style="margin:12px 0 0">When the server gets busy, automatic bot fill is scaled by <b style="color:var(--txt)">×{{ g.capDensity }}</b> so real players always have priority.</p></div>
    </div>
    <div class="card flush"><div class="scroll-x"><table class="tbl"><thead><tr><th>Game</th><th>Bots now</th><th>Target</th><th>Skill</th><th>Fixed</th><th>Auto-fill</th><th class="r">Control</th></tr></thead><tbody>
      <tr v-for="w in rows" :key="w.id">
        <td><b>{{ w.name }}</b><div class="mut xs">{{ GAME_TITLE[w.mode] }} · <span :class="live(w.id).humans ? 'ok-t' : ''">{{ live(w.id).humans || 0 }} human{{ (live(w.id).humans || 0) === 1 ? '' : 's' }}</span></div></td>
        <td class="num"><b>{{ live(w.id).liveBots || 0 }}</b></td>
        <td><div class="row gap-sm"><button class="btn sm icon" aria-label="Fewer" @click="patchW(w, { bots: Math.max(0, (w.bots ?? live(w.id).liveBots ?? 0) - 1), fixed: true })">−</button><b class="num" style="min-width:34px;text-align:center">{{ w.bots ?? 'auto' }}</b><button class="btn sm icon" aria-label="More" @click="patchW(w, { bots: Math.min(31, (w.bots ?? live(w.id).liveBots ?? 0) + 1), fixed: true })"><Icon name="plus" :size="14" /></button><button v-if="w.bots !== undefined" class="btn sm ghost" @click="patchW(w, { bots: null, fixed: false }, 'Back to automatic')">auto</button></div></td>
        <td><select class="select" style="height:32px;width:104px" :value="w.botSkill || ''" aria-label="Skill" @change="e => patchW(w, { skill: e.target.value || null })"><option value="">default</option><option v-for="k in ['easy', 'normal', 'hard']" :key="k">{{ k }}</option></select></td>
        <td><Switch :model-value="!!w.botsFixed" label="Fixed count" @change="v => patchW(w, { fixed: v })" /></td>
        <td><Switch :model-value="!w.botsPaused" label="Auto-fill" @change="v => patchW(w, { paused: !v }, v ? 'Auto-fill on' : 'Auto-fill paused')" /></td>
        <td class="r"><button class="btn sm primary" @click="summon(w)"><Icon name="bot" :size="14" />Summon</button> <button class="btn sm" @click="remove(w)">−1</button> <button class="btn sm danger" @click="clear(w)">Clear</button></td>
      </tr>
      <tr v-if="!rows.length"><td colspan="7"><div class="empty"><b>No bot games yet</b>Set up the game hub from Games first.</div></td></tr></tbody></table></div></div>
    <p class="mut xs" style="margin-top:14px">Summoned bots appear at the room's spawn, ignore the automatic target and keep an empty room awake for ten minutes so you can watch or test. Chat commands: <code class="mono">/bot add 3 hard</code>, <code class="mono">/bot count 6</code>, <code class="mono">/bot clear</code>.</p>
  </div>
</template>
<style scoped>.ok-t { color: var(--acc); font-weight: 600 } code { background: rgba(255, 255, 255, .06); padding: 1px 6px; border-radius: 6px }</style>

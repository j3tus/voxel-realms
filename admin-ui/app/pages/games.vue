<script setup>
const s = useAdmin()
const q = ref(''), mode = ref('all'), creating = ref(false), roomForm = ref(false), busy = ref(false)
const form = reactive({ name: '', type: 'normal', mode: 'creative' }), rf = reactive({ mode: 'tdm', name: '', players: 12, bots: 4, skill: 'normal' })
const ROOMM = ['pvp', 'tdm', 'gungame', 'zombies', 'raid', 'td', 'royale', 'hide', 'ctf', 'snd', 'bedwars']
const srcPill = w => (w.room && w.room.source) || (w.ephemeral ? 'player' : '')
const live = id => (s.status && s.status.worlds.find(x => x.id === id)) || {}
const modes = computed(() => [...new Set(s.worlds.map(w => w.mode))].sort())
const rows = computed(() => s.worlds.filter(w => (mode.value === 'all' || w.mode === mode.value) && (!q.value || (w.name + ' ' + w.id + ' ' + w.mode + ' ' + (GAME_TITLE[w.mode] || '')).toLowerCase().includes(q.value.toLowerCase()))))
const MODES = ['creative', 'survival', 'pvp', 'tdm', 'gungame', 'zombies', 'royale', 'ctf', 'hide', 'snd', 'bedwars', 'raid', 'td', 'parkour', 'spleef', 'lobby']

const patch = (w, body, msg) => act(async () => { await api('PATCH', `/worlds/${w.id}`, body); Object.assign(w, body); if (msg) toast(msg) })()
const portal = (w, on) => act(async () => { await api('PATCH', `/worlds/${w.id}/portal`, { show: on }); w.lobby = on; toast(on ? 'Portal shown in the lobby' : 'Portal hidden from the lobby') })()
const menu = w => [
  { label: 'Save now', icon: 'save', run: async () => { await api('POST', `/worlds/${w.id}/save`); toast('Saved') } },
  { label: 'Create backup', icon: 'db', run: async () => { const r = await api('POST', `/worlds/${w.id}/backup`); toast('Backup ' + r.file) } },
  { sep: true },
  { label: 'NPCs', check: !!w.mobs, run: v => patch(w, { mobs: v }, 'NPCs ' + (v ? 'on' : 'off')) },
  { label: 'Hostile mobs', check: !!w.hostile, run: v => patch(w, { hostile: v }, 'Hostile mobs ' + (v ? 'on' : 'off')) },
  { label: 'Economy', check: !!w.economy, run: v => patch(w, { economy: v }, 'Economy ' + (v ? 'on' : 'off')) },
  { sep: true },
  { label: 'Rename…', run: async () => { const n = await promptBox('Rename world', 'Name', w.name); if (n) { await api('PATCH', `/worlds/${w.id}`, { name: n }); w.name = n } } },
  { label: 'Day length…', run: async () => { const n = await promptBox('Day length', 'Seconds per day (60–3600)', w.dayLength, 'number'); if (n) { await api('PATCH', `/worlds/${w.id}`, { dayLength: +n }); w.dayLength = +n; toast('Day length updated') } } },
  { sep: true },
  ...(w.ephemeral ? [{ label: 'Close room', icon: 'x', danger: true, run: async () => { if (await confirmBox('Close room', `Close "${w.name}"? Players inside are sent back to the lobby.`, true, 'Close')) { await api('DELETE', `/rooms/${w.id}`); await loadWorlds(); toast('Room closed') } } }] : [{ label: 'Delete world…', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Delete world', `Delete "${w.name}"? A backup is kept.`, true, 'Delete')) { await api('DELETE', `/worlds/${w.id}`); await loadWorlds(); toast('World deleted') } } }]),
]
const create = act(async () => {
  if (!form.name.trim()) return toast('Give the world a name', true)
  busy.value = true
  try { await api('POST', '/worlds', { name: form.name.trim(), type: form.type, mode: form.mode }); await loadWorlds(); toast('World created'); creating.value = false; form.name = '' } finally { busy.value = false }
})
const makeRoom = act(async () => {
  busy.value = true
  try { const r = await api('POST', '/rooms', { mode: rf.mode, name: rf.name.trim() || undefined, players: +rf.players, bots: +rf.bots, skill: rf.skill }); await loadWorlds(); toast(`Room "${r.name}" opened: ${r.players} slots, ${r.bots} bots. Its portal appears in the lobby.`); roomForm.value = false; rf.name = '' } finally { busy.value = false }
})
const hub = act(async () => {
  if (!(await confirmBox('Set up game hub', 'Creates the lobby and one world for every game mode that is missing. Existing worlds are left untouched.', false, 'Set up'))) return
  const r = await api('POST', '/hub', {}); await loadWorlds(); toast(r.created.length ? 'Created: ' + r.created.join(', ') : 'Hub already complete')
})
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Games &amp; worlds</h1><p>{{ s.worlds.length }} worlds · live state, lobby portals and per-world controls</p></div>
      <div class="actions"><button class="btn" @click="hub"><Icon name="games" />Set up game hub</button><button class="btn" @click="roomForm = !roomForm; creating = false"><Icon name="plus" />New room</button><button class="btn primary" @click="creating = !creating; roomForm = false"><Icon name="plus" />New world</button></div></div>

    <div class="card" style="margin-bottom:16px"><CapacityBar /></div>

    <Transition name="slide"><form v-if="roomForm" class="card cf rf" @submit.prevent="makeRoom">
      <div class="field"><label>Game</label><select v-model="rf.mode" class="select"><option v-for="m in ROOMM" :key="m" :value="m">{{ GAME_TITLE[m] }}</option></select></div>
      <div class="field"><label>Name <span class="dim">(optional)</span></label><input v-model="rf.name" class="input" maxlength="32" :placeholder="GAME_TITLE[rf.mode] + ' #2'"></div>
      <div class="field"><label>Player slots</label><input v-model.number="rf.players" class="input" type="number" min="2" max="32"></div>
      <div class="field"><label>Bots</label><input v-model.number="rf.bots" class="input" type="number" min="0" max="31"></div>
      <div class="field"><label>Bot skill</label><select v-model="rf.skill" class="select"><option v-for="k in ['easy', 'normal', 'hard']" :key="k">{{ k }}</option></select></div>
      <div class="row end" style="align-self:end"><button type="button" class="btn ghost" @click="roomForm = false">Cancel</button><button class="btn primary" :disabled="busy">Open room</button></div>
      <p class="mut xs" style="grid-column:1/-1;margin:0">A pinned room with its own portal in the lobby. It survives restarts, and you may exceed the automatic capacity limits (the server still tells you when it is stretched).</p>
    </form></Transition>
    <Transition name="slide"><form v-if="creating" class="card cf" @submit.prevent="create">
      <div class="field"><label>Name</label><input v-model="form.name" class="input" placeholder="My new world" maxlength="32" autofocus></div>
      <div class="field"><label>Terrain</label><select v-model="form.type" class="select"><option v-for="t in ['normal', 'flat', 'mountains', 'islands']" :key="t">{{ t }}</option></select></div>
      <div class="field"><label>Game mode</label><select v-model="form.mode" class="select"><option v-for="m in MODES" :key="m" :value="m">{{ GAME_TITLE[m] || m }}</option></select></div>
      <div class="row end" style="align-self:end"><button type="button" class="btn ghost" @click="creating = false">Cancel</button><button class="btn primary" :disabled="busy">Create</button></div>
    </form></Transition>

    <div class="row wrap" style="margin-bottom:12px"><div class="search" style="width:min(300px,100%)"><Icon name="search" :size="16" /><input v-model="q" class="input" placeholder="Search worlds…" aria-label="Search worlds"></div><span class="mut xs">{{ rows.length }} of {{ s.worlds.length }}</span></div>
    <div class="chips" style="margin-bottom:16px"><button class="chip" :class="{ on: mode === 'all' }" @click="mode = 'all'">All</button><button v-for="m in modes" :key="m" class="chip" :class="{ on: mode === m }" @click="mode = m">{{ GAME_TITLE[m] || m }}</button></div>

    <div class="card flush">
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>World</th><th>Mode</th><th>Live</th><th>Players</th><th>Lobby portal</th><th class="r" /></tr></thead>
        <tbody>
          <tr v-for="w in rows" :key="w.id">
            <td><b>{{ w.name }}</b><div class="mut xs mono">{{ w.id }} · {{ w.type }}</div></td>
            <td><span class="pill vio">{{ GAME_TITLE[w.mode] || w.mode }}</span> <span v-if="w.economy" class="pill warn">economy</span> <span v-if="srcPill(w)" class="pill" :class="srcPill(w) === 'auto' ? 'info' : srcPill(w) === 'admin' ? 'ok' : ''">{{ srcPill(w) }}</span></td>
            <td><span class="pill" :class="gameState(live(w.id)).cls"><i />{{ gameState(live(w.id)).label }}</span><span v-if="gameState(live(w.id)).time" class="mono xs mut"> {{ gameState(live(w.id)).time }}</span></td>
            <td class="num"><b>{{ live(w.id).humans || 0 }}</b><span class="mut">/{{ w.maxPlayers }}</span><span v-if="live(w.id).liveBots" class="mut xs"> · {{ live(w.id).liveBots }} bots</span></td>
            <td><span v-if="w.mode === 'lobby'" class="mut xs">the hub</span><Switch v-else :model-value="w.lobby !== false" label="Show in lobby" @change="v => portal(w, v)" /></td>
            <td class="r"><Menu :items="menu(w)" /></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6"><div class="empty"><b>No worlds match</b>Try a different search or filter.</div></td></tr>
        </tbody>
      </table></div>
    </div>
  </div>
</template>
<style scoped>
.cf { display: grid; grid-template-columns: 1.4fr 1fr 1fr auto; gap: 14px; margin-bottom: 16px; align-items: end } .rf { grid-template-columns: 1fr 1.2fr .7fr .7fr .8fr auto }
@media (max-width: 1100px) { .rf { grid-template-columns: 1fr 1fr } }
@media (max-width: 860px) { .cf { grid-template-columns: 1fr 1fr } .cf .field:first-child { grid-column: 1/-1 } .cf .row { grid-column: 1/-1 } }
.slide-enter-active, .slide-leave-active { transition: all .25s var(--ease) } .slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-8px) }
@media (max-width: 720px) {
  .tbl thead { display: none } .tbl, .tbl tbody { display: block }
  .tbl tr { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; padding: 14px 16px; border-bottom: 1px solid var(--line) } .tbl td { display: block; padding: 0; border: 0 }
  .tbl td:nth-child(2) { grid-column: 1/-1; grid-row: 2 } .tbl td:nth-child(3) { grid-row: 3 } .tbl td:nth-child(4) { grid-row: 3; text-align: right } .tbl td:nth-child(5) { grid-column: 1; grid-row: 4 } .tbl td:nth-child(6) { grid-column: 2; grid-row: 4 }
  .tbl td:nth-child(1) { grid-column: 1/-1; grid-row: 1 } .scroll-x { overflow: visible }
}
</style>

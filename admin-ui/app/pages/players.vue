<script setup>
const s = useAdmin()
const list = ref([]), q = ref(''), bots = ref(false), loading = ref(true), selId = ref(null)
const sel = computed(() => list.value.find(p => p.id === selId.value) || null)
const swatch = sk => [sk && sk.hair || '#4a3020', sk && sk.skin || '#e0b48f', sk && sk.shirt || '#3c8dd9', sk && sk.pants || '#2c3e50']
const tpTo = async p => { const c = await promptBox('Teleport ' + p.name, 'x y z', `${p.x | 0} 40 ${p.z | 0}`); if (c) { const [x, y, z] = c.split(/[ ,]+/).map(Number); if ([x, y, z].every(Number.isFinite)) await post(p, 'tp', { x, y, z }, 'Teleported') } }
const coinsFor = async p => { const n = await promptBox('Coins for ' + p.name, 'Add (negative removes)', '100', 'number'); if (n) await post(p, 'coins', { delta: +n }, 'Coins updated') }
let timer
const load = async () => { try { list.value = await api('GET', '/players') } catch {} loading.value = false }
onMounted(() => { load(); timer = setInterval(load, 3000) }); onBeforeUnmount(() => clearInterval(timer))
const isBot = p => /^\[Bot\]/i.test(p.name)
const shown = computed(() => list.value.filter(p => (bots.value || !isBot(p)) && (!q.value || (p.name + ' ' + p.ip + ' ' + p.world + ' ' + p.uid).toLowerCase().includes(q.value.toLowerCase()))))
const nHum = computed(() => list.value.filter(p => !isBot(p)).length), nBot = computed(() => list.value.filter(isBot).length)
const worldName = id => (s.worlds.find(w => w.id === id) || {}).name || id
const bars = ms => !ms ? 0 : ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1
const post = (p, action, body, msg) => act(async () => { await api('POST', `/players/${p.id}/${action}`, body || {}); toast(msg); load() })()
const menu = p => isBot(p) ? [{ label: 'Kick bot', icon: 'kick', run: () => post(p, 'kick', {}, 'Bot removed') }] : [
  { label: 'Send message…', icon: 'chat', run: async () => { const t = await promptBox('Message ' + p.name, 'Text'); if (t) await post(p, 'msg', { text: t }, 'Message sent') } },
  { label: p.op ? 'Remove operator' : 'Make operator', icon: 'crown', run: () => post(p, 'op', { value: !p.op }, p.op ? 'Operator removed' : p.name + ' is now an operator') },
  { label: p.muted ? 'Unmute' : 'Mute', icon: 'mute', run: () => post(p, 'mute', { value: !p.muted }, p.muted ? 'Unmuted' : 'Muted') },
  { label: 'Give coins…', run: async () => { const n = await promptBox('Give coins to ' + p.name, 'Amount (negative to take)', '100', 'number'); if (n) await post(p, 'coins', { delta: +n }, 'Coins updated') } },
  { sep: true },
  { label: 'Kick…', icon: 'kick', run: async () => { const r = await promptBox('Kick ' + p.name, 'Reason', 'Kicked by an administrator'); if (r !== null) await post(p, 'kick', { reason: r }, p.name + ' kicked') } },
  { label: 'Ban…', icon: 'x', danger: true, run: async () => { if (await confirmBox('Ban ' + p.name, 'Bans their name, IP and device id.', true, 'Ban')) await post(p, 'ban', { reason: 'Banned' }, p.name + ' banned') } },
]
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Players</h1><p>{{ nHum }} online<span v-if="nBot"> · {{ nBot }} bots</span></p></div>
      <div class="actions row"><label class="row gap-sm sm mut"><Switch v-model="bots" label="Show bots" />Show bots</label></div></div>
    <div class="search" style="width:min(340px,100%);margin-bottom:14px"><Icon name="search" :size="16" /><input v-model="q" class="input" placeholder="Search name, IP, world…" aria-label="Search players"></div>
    <div class="card flush"><div class="scroll-x"><table class="tbl">
      <thead><tr><th>Player</th><th>World</th><th>Ping</th><th>Coins</th><th>Joined</th><th>Status</th><th class="r" /></tr></thead>
      <tbody>
        <tr v-for="p in shown" :key="p.id" class="clk" :class="{ on: selId === p.id }" @click="selId = p.id">
          <td><div class="row"><span class="avatar" :class="{ bot: isBot(p) }">{{ (p.name.replace(/^\[Bot\]\s*/i, '')[0] || '?').toUpperCase() }}</span><div><b>{{ p.name }}</b><div class="mut xs mono">{{ p.ip }}</div></div></div></td>
          <td>{{ worldName(p.world) }}<div class="mut xs">{{ GAME_TITLE[p.mode] || p.mode }}</div></td>
          <td><span class="bars" :title="p.rtt + ' ms'"><i v-for="n in 4" :key="n" :class="{ on: n <= bars(p.rtt) }" :style="{ height: 4 + n * 3 + 'px' }" /></span><span class="mut xs mono"> {{ p.rtt || '–' }}</span></td>
          <td class="num mono">{{ (p.coins || 0).toLocaleString() }}</td>
          <td class="mut sm">{{ p.joined ? ago(p.joined) : '–' }}</td>
          <td><span v-if="isBot(p)" class="pill">bot</span><span v-if="p.op" class="pill vio">op</span> <span v-if="p.muted" class="pill warn">muted</span></td>
          <td class="r" @click.stop><Menu :items="menu(p)" /></td>
        </tr>
        <tr v-if="!shown.length"><td colspan="7"><div class="empty"><b>{{ loading ? 'Loading…' : 'Nobody online' }}</b>{{ loading ? '' : 'Players appear here the moment they join a world.' }}</div></td></tr>
      </tbody></table></div></div>
    <Transition name="dr"><aside v-if="sel" class="drawer" role="dialog" :aria-label="'Player ' + sel.name">
      <div class="row between"><h2 class="row"><span class="avatar" :class="{ bot: isBot(sel) }">{{ (sel.name.replace(/^\[Bot\]\s*/i, '')[0] || '?').toUpperCase() }}</span>{{ sel.name }}</h2><button class="btn icon sm ghost" aria-label="Close" @click="selId = null"><Icon name="x" :size="16" /></button></div>
      <div class="chips" style="margin:10px 0 14px"><span v-if="sel.op" class="pill vio">operator</span><span v-if="sel.muted" class="pill warn">muted</span><span v-if="isBot(sel)" class="pill">bot</span><span class="pill info">{{ GAME_TITLE[sel.mode] || sel.mode }}</span></div>
      <div class="sw-row" title="Skin colours"><i v-for="(c, i) in swatch(sel.skin)" :key="i" :style="{ background: c }" /></div>
      <dl class="kv"><dt>World</dt><dd>{{ worldName(sel.world) }}</dd><dt>Ping</dt><dd>{{ sel.rtt || '?' }} ms</dd><dt>Session</dt><dd>{{ sel.joined ? ago(sel.joined) : '–' }}</dd><dt>IP</dt><dd class="mono">{{ sel.ip }}</dd><dt>Device id</dt><dd class="mono">{{ sel.uid }}</dd><dt>Position</dt><dd class="mono">{{ sel.x }}, {{ sel.y }}, {{ sel.z }}</dd><dt>Coins</dt><dd class="mono">{{ (sel.coins || 0).toLocaleString() }} <span class="mut">(+{{ sel.earned || 0 }} / −{{ sel.spent || 0 }})</span></dd></dl>
      <template v-if="sel.inv && Object.keys(sel.inv).length"><div class="up" style="margin:16px 0 8px">Inventory</div><div class="chips"><span v-for="(n, id) in sel.inv" :key="id" class="pill">{{ n }}× {{ blockName(+id) }}</span></div></template>
      <div class="up" style="margin:18px 0 8px">Actions</div>
      <div class="chips" v-if="!isBot(sel)">
        <button class="btn sm" @click="async () => { const t = await promptBox('Message ' + sel.name, 'Text'); if (t) post(sel, 'msg', { text: t }, 'Sent') }">Message</button>
        <button class="btn sm" @click="post(sel, 'op', { value: !sel.op }, sel.op ? 'Operator removed' : 'Operator granted')">{{ sel.op ? 'Remove op' : 'Make op' }}</button>
        <button class="btn sm" @click="post(sel, 'mute', { value: !sel.muted }, sel.muted ? 'Unmuted' : 'Muted')">{{ sel.muted ? 'Unmute' : 'Mute' }}</button>
        <button class="btn sm" @click="coinsFor(sel)">Coins</button><button class="btn sm" @click="act(tpTo)(sel)">Teleport</button>
        <button class="btn sm warn" @click="async () => { const r = await promptBox('Kick ' + sel.name, 'Reason', 'Kicked by an administrator'); if (r !== null) post(sel, 'kick', { reason: r }, 'Kicked') }">Kick</button>
        <button class="btn sm danger" @click="async () => { if (await confirmBox('Ban ' + sel.name, 'Bans their name, IP and device id.', true, 'Ban')) post(sel, 'ban', { reason: 'Banned' }, 'Banned') }">Ban</button></div>
      <div class="chips" v-else><button class="btn sm danger" @click="post(sel, 'kick', {}, 'Bot removed')">Remove bot</button></div>
    </aside></Transition>
  </div>
</template>
<style scoped>
.clk { cursor: pointer } .clk.on { background: rgba(110, 231, 168, .06) }
.drawer { position: fixed; z-index: 70; top: 0; right: 0; bottom: 0; width: min(380px, 100vw); padding: 22px; overflow: auto; background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent 30%), var(--s1); border-left: 1px solid var(--line2); box-shadow: -30px 0 60px -20px rgba(0, 0, 0, .8) }
.drawer h2 { font-size: 20px; gap: 12px }
.sw-row { display: flex; gap: 4px; margin-bottom: 14px } .sw-row i { width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--line2) }
.kv { display: grid; grid-template-columns: 90px 1fr; gap: 9px 12px; margin: 0; font-size: 13px } .kv dt { color: var(--mut) } .kv dd { margin: 0; word-break: break-all }
.dr-enter-active, .dr-leave-active { transition: transform .25s var(--ease), opacity .2s } .dr-enter-from, .dr-leave-to { transform: translateX(30px); opacity: 0 }

.bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px } .bars i { width: 3px; border-radius: 2px; background: rgba(255, 255, 255, .14) } .bars i.on { background: var(--acc); box-shadow: 0 0 6px rgba(110, 231, 168, .6) }
@media (max-width: 720px) { .tbl th:nth-child(2), .tbl td:nth-child(2), .tbl th:nth-child(4), .tbl td:nth-child(4), .tbl th:nth-child(5), .tbl td:nth-child(5) { display: none } }
</style>

<script setup>
const s = useAdmin()
const st = computed(() => s.status || { worlds: [], players: 0, bots: 0, tps: 0, cpu: 0, rss: 0, heap: 0, tickMs: 0, loopLagMs: 0, uptime: 0, cores: 0, load: 0 })
const meta = id => s.worlds.find(w => w.id === id) || {}
const maint = computed(() => !!(s.status && s.status.maintenance))

const games = computed(() => st.value.worlds.filter(w => w.game))
const active = computed(() => games.value.filter(w => w.humans || w.game.state === 'play').sort((a, b) => b.humans - a.humans))
const idle = computed(() => games.value.filter(w => !active.value.includes(w)))
const PAL = ['#6ee7a8', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#f472b6', '#2dd4bf', '#94a3b8']
const donut = computed(() => {
  const by = {}
  for (const w of st.value.worlds) { const m = meta(w.id).mode || 'other'; by[m] = (by[m] || 0) + (w.humans || 0) + (w.liveBots || 0) }
  return Object.entries(by).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).map(([m, v], i) => ({ label: GAME_TITLE[m] || m, value: v, color: PAL[i % PAL.length] }))
})
const feed = computed(() => [...s.logs].slice(-14).reverse())

const saveAll = act(async () => { for (const w of st.value.worlds) await api('POST', `/worlds/${w.id}/save`); toast('All worlds saved') })
const backupAll = act(async () => { const w = st.value.worlds[0]; if (w) { await api('POST', `/worlds/${w.id}/backup`); toast('Backup of ' + (meta(w.id).name || w.id) + ' created') } })
const announce = act(async () => { const t = await promptBox('Announcement', 'Message shown to every player'); if (t) { await api('POST', '/announce', { text: t }); toast('Announcement sent') } })
const toggleMaint = act(async () => {
  const on = !maint.value
  if (on && !(await confirmBox('Enable maintenance?', 'Everyone who is not an operator will be kicked and new joins are blocked.', true, 'Enable'))) return
  await api('PATCH', '/security', { maintenance: { on } }); toast('Maintenance ' + (on ? 'on - everyone but operators was kicked' : 'off'))
})
const lvl = e => e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : ''
</script>
<template>
  <div class="rise">
    <section class="hero card">
      <div class="hero-l">
        <div class="row gap-sm"><span class="pill" :class="maint ? 'warn' : 'ok'"><i />{{ maint ? 'Maintenance' : 'Running' }}</span><span class="pill"><Icon name="clock" :size="12" />{{ fmtUp(st.uptime) }}</span></div>
        <h1>{{ st.name || 'Voxel Realms' }}</h1>
        <p class="mut">{{ plural(st.worlds.length, 'world') }} · {{ plural(st.players, 'player') }} online<span v-if="st.bots"> · {{ plural(st.bots, 'bot') }}</span> · {{ st.cores }} cores · node {{ st.node }}</p>
      </div>
      <div class="hero-r">
        <button class="btn primary" @click="saveAll"><Icon name="save" />Save all</button>
        <button class="btn" @click="backupAll"><Icon name="db" />Backup</button>
        <button class="btn" @click="announce"><Icon name="speaker" />Announce</button>
        <button class="btn" :class="{ warn: !maint }" @click="toggleMaint"><Icon name="wrench" />{{ maint ? 'End maintenance' : 'Maintenance' }}</button>
      </div>
    </section>

    <section class="grid g4">
      <div class="card kpi"><div class="kpi-h"><span class="ic a"><Icon name="players" :size="17" /></span><span class="up">Players</span></div><b class="num">{{ st.players }}</b><small class="mut">{{ st.bots ? '+ ' + st.bots + ' bots' : 'no bots active' }}</small><Spark :data="s.hist.players" color="#6ee7a8" /></div>
      <div class="card kpi"><div class="kpi-h"><span class="ic b"><Icon name="bolt" :size="17" /></span><span class="up">TPS</span></div><b class="num" :class="{ bad: st.tps < 19 }">{{ st.tps }}</b><small class="mut">tick {{ (st.tickMs || 0).toFixed(2) }} ms · lag {{ st.loopLagMs || 0 }} ms</small><Spark :data="s.hist.tick" color="#38bdf8" /></div>
      <div class="card kpi"><div class="kpi-h"><span class="ic c"><Icon name="cpu" :size="17" /></span><span class="up">CPU</span></div><b class="num">{{ st.cpu || 0 }}<u>%</u></b><small class="mut">load {{ (st.load || 0).toFixed(2) }} / {{ st.cores }} cores</small><Spark :data="s.hist.cpu" color="#fbbf24" /></div>
      <div class="card kpi"><div class="kpi-h"><span class="ic d"><Icon name="mem" :size="17" /></span><span class="up">Memory</span></div><b class="num">{{ fmtMB(st.rss || 0) }}</b><small class="mut">heap {{ fmtMB(st.heap || 0) }}</small><Spark :data="s.hist.mem" color="#a78bfa" /></div>
    </section>

    <section class="card"><div class="card-h"><h3>Capacity</h3><span class="sub">rooms and bots grow and shrink with what the server has left</span><NuxtLink to="/bots" class="btn sm ghost push">Bots →</NuxtLink></div><CapacityBar /></section>

    <section class="card">
      <div class="card-h"><h3>Live games</h3><span class="sub">{{ active.filter(w => w.humans).length ? plural(active.filter(w => w.humans).length, 'game') + ' with players' : 'nobody playing right now' }}</span><NuxtLink to="/games" class="btn sm ghost push">All games →</NuxtLink></div>
      <div class="lg">
        <NuxtLink v-for="w in active" :key="w.id" to="/games" class="tile" :class="{ hot: w.humans }">
          <div class="row between"><b>{{ meta(w.id).name || w.id }}</b><span class="pill" :class="gameState(w).cls"><i />{{ gameState(w).label }}</span></div>
          <div class="mut sm">{{ GAME_TITLE[meta(w.id).mode] || meta(w.id).mode }}</div>
          <div class="row sm between" style="margin-top:10px"><span><b class="num">{{ w.humans }}</b> <span class="mut">{{ w.humans === 1 ? 'player' : 'players' }}</span><template v-if="w.liveBots"> · <b class="num">{{ w.liveBots }}</b> <span class="mut">bots</span></template></span><span v-if="gameState(w).time" class="mono">{{ gameState(w).time }}</span></div>
          <div v-if="w.game?.top?.k" class="xs mut" style="margin-top:8px">Leading <b style="color:var(--amb)">{{ w.game.top.name }}</b> · {{ w.game.top.k }}</div>
        </NuxtLink>
        <div v-if="!active.length" class="empty" style="grid-column:1/-1"><b>All quiet</b>Games start automatically when a player joins; bots fill the rest.</div>
      </div>
      <div v-if="idle.length" class="chips idle"><span class="mut xs">{{ plural(idle.length, 'idle game') }}</span><NuxtLink v-for="w in idle" :key="w.id" to="/games" class="chip" :title="GAME_TITLE[meta(w.id).mode]">{{ meta(w.id).name || w.id }}</NuxtLink></div>
    </section>

    <section class="grid g-main">
      <div class="card"><div class="card-h"><h3>Population</h3><span class="sub">players and bots, last 3 min</span></div><AreaChart :series="[{ label: 'Humans', color: '#6ee7a8', data: s.hist.players }, { label: 'Bots', color: '#38bdf8', data: s.hist.bots, fill: false }]" :min-max="4" /></div>
      <div class="card"><div class="card-h"><h3>By game</h3></div>
        <div class="row gap-lg" v-if="donut.length"><Donut :items="donut" label="active" /><ul class="leg"><li v-for="d in donut" :key="d.label"><i :style="{ background: d.color }" />{{ d.label }}<b class="num">{{ d.value }}</b></li></ul></div>
        <div v-else class="empty"><b>No one in a game</b>Distribution appears when players join.</div></div>
    </section>

    <section class="grid g-main">
      <div class="card"><div class="card-h"><h3>Server load</h3><span class="sub">tick time and event-loop lag</span></div><AreaChart unit=" ms" :series="[{ label: 'Tick', color: '#38bdf8', data: s.hist.tick }, { label: 'Loop lag', color: '#fbbf24', data: s.hist.lag, fill: false }]" :min-max="5" /></div>
      <div class="card"><div class="card-h"><h3>Network</h3><span class="sub">KB/s</span></div><AreaChart :series="[{ label: 'Out', color: '#6ee7a8', data: s.hist.netOut }, { label: 'In', color: '#a78bfa', data: s.hist.netIn, fill: false }]" :min-max="5" /></div>
    </section>

    <section class="card">
      <div class="card-h"><h3>Activity</h3><span class="sub">live server log</span></div>
      <div class="feed"><div v-for="(e, i) in feed" :key="i" class="fl" :class="lvl(e)"><span class="t mono">{{ clock(e.at) }}</span><span>{{ e.msg }}</span></div><div v-if="!feed.length" class="empty">Waiting for events…</div></div>
    </section>
  </div>
</template>
<style scoped>
.rise { display: flex; flex-direction: column; gap: 16px }
.hero { display: flex; gap: 18px; justify-content: space-between; align-items: center; flex-wrap: wrap; padding: 24px; background: radial-gradient(500px 220px at 0% 0%, rgba(110, 231, 168, .13), transparent 70%), radial-gradient(400px 220px at 100% 100%, rgba(56, 189, 248, .10), transparent 70%), linear-gradient(180deg, rgba(255, 255, 255, .04), transparent 40%), var(--s1) }
.hero h1 { font-size: 30px; margin: 10px 0 4px; font-weight: 700 } .hero p { margin: 0 }
.hero-r { display: flex; gap: 8px; flex-wrap: wrap }
.kpi { display: flex; flex-direction: column; gap: 2px; overflow: hidden; padding-bottom: 0 } .kpi .spark, .kpi svg:last-child { margin: 8px -18px 0; width: calc(100% + 36px) }
.kpi-h { display: flex; align-items: center; gap: 9px; margin-bottom: 8px }
.kpi b { font: 700 32px/1.1 var(--head); letter-spacing: -.02em } .kpi b u { font-size: 18px; text-decoration: none; color: var(--mut); margin-left: 2px } .kpi b.bad { color: var(--bad) } .kpi small { font-size: 12px }
.ic { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center }
.ic.a { background: rgba(110, 231, 168, .14); color: #6ee7a8; box-shadow: 0 0 20px -6px rgba(110, 231, 168, .5) } .ic.b { background: rgba(56, 189, 248, .14); color: #38bdf8; box-shadow: 0 0 20px -6px rgba(56, 189, 248, .5) }
.ic.c { background: rgba(251, 191, 36, .14); color: #fbbf24; box-shadow: 0 0 20px -6px rgba(251, 191, 36, .5) } .ic.d { background: rgba(167, 139, 250, .14); color: #a78bfa; box-shadow: 0 0 20px -6px rgba(167, 139, 250, .5) }
.lg { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px }
.tile { display: block; padding: 14px 16px; border-radius: 14px; color: var(--txt); background: linear-gradient(180deg, rgba(255, 255, 255, .04), transparent), var(--s2); border: 1px solid var(--line); transition: transform .15s var(--ease), border-color .15s }
.tile:hover { transform: translateY(-2px); border-color: var(--line2) } .tile.hot { border-color: rgba(110, 231, 168, .35); box-shadow: 0 0 0 1px rgba(110, 231, 168, .1) inset, 0 0 32px -12px rgba(110, 231, 168, .45) }
.idle { margin-top: 14px; align-items: center } .idle .chip { text-decoration: none }
.leg { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; flex: 1 } .leg li { display: flex; align-items: center; gap: 9px } .leg i { width: 9px; height: 9px; border-radius: 3px } .leg b { margin-left: auto }
.feed { display: flex; flex-direction: column; max-height: 300px; overflow: auto } .fl { display: flex; gap: 14px; padding: 7px 4px; border-bottom: 1px solid var(--line); font-size: 13px } .fl:last-child { border: 0 } .fl .t { color: var(--dim); font-size: 12px; flex: none } .fl.warn { color: var(--amb) } .fl.error { color: var(--bad) }
@media (max-width: 720px) { .hero { padding: 18px } .hero h1 { font-size: 24px } .hero-r .btn { flex: 1 1 calc(50% - 8px) } }
</style>

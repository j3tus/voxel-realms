<script setup>
const s = useAdmin()
const pw = ref(''), clock_ = ref(new Date())
onMounted(() => { boot(); setInterval(() => { clock_.value = new Date() }, 1000) })
const nav = [
  ['/', 'Overview', 'home'], ['/games', 'Games', 'games'], ['/players', 'Players', 'players'], ['/bots', 'Bots', 'bot'], ['/map', 'Live map', 'map'], ['/chat', 'Chat', 'chat'],
  ['/economy', 'Economy', 'db'], ['/console', 'Console', 'term'], ['/security', 'Security', 'shield'], ['/backups', 'Backups', 'db'], ['/settings', 'Settings', 'gear'], ['/help', 'Help', 'help'],
]
const route = useRoute()
const title = computed(() => (nav.find(n => n[0] === route.path) || nav[0])[1])
const humans = computed(() => s.status ? s.status.players : 0)
</script>
<template>
  <div v-if="s.booting" class="boot"><div class="logo-pulse" /></div>

  <main v-else-if="!s.authed" class="login">
    <form class="login-card" @submit.prevent="signIn(pw)">
      <div class="brand big"><span class="gem" /><div><b>Voxel Realms</b><small>Admin console</small></div></div>
      <div class="field"><label for="pw">Admin password</label><input id="pw" v-model="pw" class="input" type="password" autocomplete="current-password" autofocus placeholder="••••••••••••"></div>
      <p v-if="s.loginErr" class="err" role="alert">{{ s.loginErr }}</p>
      <button class="btn primary" style="height:42px" :disabled="!pw || s.loggingIn">{{ s.loggingIn ? 'Signing in…' : 'Sign in' }}</button>
      <a class="mut xs" href="/" style="text-align:center">← Back to the game</a>
    </form>
  </main>

  <div v-else class="shell">
    <aside class="side">
      <div class="brand"><span class="gem" /><div><b>Voxel Realms</b><small>v{{ s.status?.version || '' }}</small></div></div>
      <nav>
        <NuxtLink v-for="n in nav" :key="n[0]" :to="n[0]" class="nv"><Icon :name="n[2]" /><span>{{ n[1] }}</span><em v-if="n[0] === '/players' && humans" class="badge">{{ humans }}</em></NuxtLink>
      </nav>
      <div class="side-foot">
        <div class="mini"><span class="dot" :class="s.online ? 'live' : 'off'" /><div><b>{{ s.online ? 'Connected' : 'Reconnecting…' }}</b><small>{{ clock_.toLocaleTimeString() }}</small></div></div>
        <button class="btn ghost sm" @click="signOut"><Icon name="out" :size="15" />Sign out</button>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <div class="crumb"><span class="mut">Admin</span><i>/</i><b>{{ title }}</b></div>
        <span class="pill" :class="s.online ? 'ok' : 'bad'"><i />{{ s.online ? 'Live' : 'Offline' }}</span>
        <span class="pill info"><i />{{ humans }} online</span>
      </header>
      <div class="content"><NuxtPage /></div>
    </div>
    <nav class="bnav"><NuxtLink v-for="n in nav" :key="n[0]" :to="n[0]"><Icon :name="n[2]" :size="20" /><span>{{ n[1] }}</span></NuxtLink></nav>
  </div>
  <DialogHost /><ToastHost />
</template>
<style>
.boot { position: fixed; inset: 0; display: grid; place-items: center } .logo-pulse { width: 46px; height: 46px; border-radius: 14px; background: var(--acc-grad); animation: lp 1.2s ease-in-out infinite; box-shadow: 0 0 50px -6px rgba(110, 231, 168, .6) } @keyframes lp { 50% { transform: scale(.82) rotate(8deg); opacity: .6 } }
.login { min-height: 100vh; display: grid; place-items: center; padding: 20px }
.login-card { width: min(400px, 100%); display: flex; flex-direction: column; gap: 16px; padding: 30px; border-radius: 24px; background: linear-gradient(180deg, rgba(255, 255, 255, .06), transparent 45%), var(--s1); border: 1px solid var(--line2); box-shadow: 0 50px 100px -30px rgba(0, 0, 0, .9), 0 0 80px -30px rgba(110, 231, 168, .3) }
.err { margin: 0; color: var(--bad); font-size: 13px; background: rgba(251, 113, 133, .1); border: 1px solid rgba(251, 113, 133, .25); padding: 9px 12px; border-radius: 10px }
.brand { display: flex; align-items: center; gap: 11px; padding: 4px 8px 18px } .brand b { display: block; font: 700 17px var(--head); letter-spacing: -.01em } .brand small { color: var(--dim); font-size: 12px }
.brand.big { padding: 0 0 8px } .brand.big b { font-size: 22px }
.gem { width: 34px; height: 34px; border-radius: 11px; background: var(--acc-grad); position: relative; box-shadow: 0 8px 24px -8px rgba(110, 231, 168, .7), 0 1px 0 rgba(255, 255, 255, .5) inset; flex: none }
.gem::after { content: ''; position: absolute; inset: 9px; border-radius: 4px; background: #04120b; opacity: .75; transform: rotate(45deg) scale(.7) }
.shell { display: grid; grid-template-columns: 244px minmax(0, 1fr); min-height: 100vh }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 18px 14px; border-right: 1px solid var(--line); background: linear-gradient(180deg, rgba(255, 255, 255, .025), transparent 30%), rgba(8, 12, 20, .72); backdrop-filter: blur(14px) }
.side nav { display: flex; flex-direction: column; gap: 3px; flex: 1; overflow: auto }
.nv { position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; color: var(--mut); font-weight: 600; font-size: 13.5px; transition: color .15s, background .15s }
.nv:hover { color: var(--txt); background: rgba(255, 255, 255, .05) }
.nv.router-link-exact-active { color: var(--txt); background: linear-gradient(90deg, rgba(110, 231, 168, .16), rgba(56, 189, 248, .05)); box-shadow: 0 0 0 1px rgba(110, 231, 168, .18) inset }
.nv.router-link-exact-active::before { content: ''; position: absolute; left: -14px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 4px 4px 0; background: var(--acc-grad); box-shadow: 0 0 14px rgba(110, 231, 168, .8) }
.nv.router-link-exact-active svg { color: var(--acc) } .nv .xt { margin-left: auto; opacity: .5 }
.badge { margin-left: auto; font-style: normal; font: 700 11px var(--mono); padding: 2px 7px; border-radius: 99px; background: var(--acc); color: #04120b }
.side-foot { border-top: 1px solid var(--line); padding-top: 14px; display: flex; flex-direction: column; gap: 8px }
.mini { display: flex; align-items: center; gap: 10px; padding: 0 8px } .mini b { display: block; font-size: 12.5px } .mini small { color: var(--dim); font-size: 11.5px }
.side-foot .btn { justify-content: flex-start }
.main { min-width: 0; display: flex; flex-direction: column }
.top { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 10px; padding: 14px 28px; background: rgba(6, 10, 18, .7); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line) }
.crumb { margin-right: auto; display: flex; gap: 8px; align-items: center; font-size: 13px } .crumb i { color: var(--dim); font-style: normal } .crumb b { font-family: var(--head) }
.content { padding: 26px 28px 60px; max-width: 1500px; width: 100% }
.bnav { display: none }
@media (max-width: 860px) {
  .shell { grid-template-columns: minmax(0, 1fr) } .side { display: none }
  .top { padding: 12px 16px } .content { padding: 18px 14px 96px }
  .bnav { position: fixed; z-index: 60; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); display: flex; gap: 2px; padding: 6px; border-radius: 20px; overflow-x: auto; scrollbar-width: none; background: rgba(13, 21, 35, .88); backdrop-filter: blur(18px); border: 1px solid var(--line2); box-shadow: 0 20px 50px -10px rgba(0, 0, 0, .9) }
  .bnav::-webkit-scrollbar { display: none }
  .bnav a { flex: 1 0 64px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; border-radius: 14px; color: var(--mut); font-size: 10.5px; font-weight: 600 }
  .bnav a.router-link-exact-active { color: var(--acc); background: rgba(110, 231, 168, .12); box-shadow: 0 0 0 1px rgba(110, 231, 168, .2) inset }
}
</style>

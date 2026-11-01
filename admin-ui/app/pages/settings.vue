<script setup>
const s = useAdmin(), cfg = ref(null), sys = ref(null), f = reactive({ name: '', motd: '', password: '' }), saving = ref(false)
const load = async () => { cfg.value = await api('GET', '/config'); sys.value = await api('GET', '/system'); f.name = cfg.value.name; f.motd = cfg.value.motd; f.password = '' }
onMounted(act(load))
const save = act(async () => { saving.value = true; try { const body = { name: f.name, motd: f.motd }; if (f.password) body.password = f.password; await api('PATCH', '/config', body); toast('Settings saved'); await load() } finally { saving.value = false } })
const clearPw = act(async () => { await api('PATCH', '/config', { password: null }); toast('Join password removed'); await load() })
const rows = computed(() => sys.value ? [['Host', sys.value.host], ['CPU', sys.value.cpuModel], ['Architecture', sys.value.arch], ['Node', sys.value.node], ['Process', sys.value.pid], ['Data folder', sys.value.dataDir], ['Addresses', (sys.value.lan || []).join(', ')]] : [])
</script>
<template>
  <div v-if="cfg">
    <div class="page-h"><div><h1>Settings</h1><p>Server identity, join password and system details</p></div></div>
    <div class="grid g2">
      <form class="card col" @submit.prevent="save"><div class="card-h"><h3>Server</h3></div>
        <div class="field"><label>Server name</label><input v-model="f.name" class="input" maxlength="40" required></div>
        <div class="field"><label>Message of the day</label><input v-model="f.motd" class="input" maxlength="140"></div>
        <div class="field"><label>Join password <span class="dim">({{ cfg.locked ? 'one is set' : 'none' }})</span></label><input v-model="f.password" class="input" type="password" autocomplete="new-password" placeholder="Leave empty to keep as is"></div>
        <div class="row"><button class="btn primary" :disabled="saving">Save changes</button><button v-if="cfg.locked" type="button" class="btn danger" @click="clearPw">Remove join password</button></div></form>
      <div class="card"><div class="card-h"><h3>System</h3></div>
        <dl class="dl"><template v-for="r in rows" :key="r[0]"><dt>{{ r[0] }}</dt><dd class="mono">{{ r[1] || '–' }}</dd></template></dl></div>
    </div>
    <div class="card note" style="margin-top:16px"><Icon name="lock" :size="18" /><div><b>Admin password</b><p class="mut sm" style="margin:2px 0 0">It is set by the server's <code class="mono">ADMIN_PASSWORD</code> environment variable, so it can't be changed here. Use <code class="mono">deploy/set-admin-password.sh</code> on the host.</p></div></div>
  </div>
</template>
<style scoped>
.dl { display: grid; grid-template-columns: auto 1fr; gap: 10px 18px; margin: 0; font-size: 13px } dt { color: var(--mut) } dd { margin: 0; word-break: break-all }
.note { display: flex; gap: 14px; align-items: flex-start } .note svg { color: var(--acc); margin-top: 2px; flex: none } code { background: rgba(255, 255, 255, .06); padding: 1px 6px; border-radius: 6px; font-size: 12px }
</style>

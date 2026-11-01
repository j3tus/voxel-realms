<script setup>
const sec = ref(null), audit = ref([]), banKind = ref('names'), banVal = ref(''), allowVal = ref(''), msg = ref('')
const load = async () => { sec.value = await api('GET', '/security'); msg.value = sec.value.maintenance.msg || ''; audit.value = await api('GET', '/audit') }
onMounted(act(load))
const maint = act(async v => { if (v && !(await confirmBox('Enable maintenance?', 'Non-operators are kicked and new joins are blocked.', true, 'Enable'))) return load(); await api('PATCH', '/security', { maintenance: { on: v, msg: msg.value || undefined } }); await load(); toast('Maintenance ' + (v ? 'on' : 'off')) })
const allowOn = act(async v => { await api('PATCH', '/security', { allowlist: { on: v } }); await load(); toast('Allowlist ' + (v ? 'on' : 'off')) })
const allowAdd = act(async () => { if (!allowVal.value.trim()) return; await api('PATCH', '/security', { allowlist: { add: allowVal.value.trim() } }); allowVal.value = ''; await load() })
const allowDel = act(async n => { await api('PATCH', '/security', { allowlist: { remove: n } }); await load() })
const ban = act(async () => { if (!banVal.value.trim()) return; await api('POST', '/bans', { kind: banKind.value, value: banVal.value.trim() }); banVal.value = ''; await load(); toast('Ban added') })
const unban = act(async (kind, value) => { await api('DELETE', '/bans', { kind, value }); await load(); toast('Ban removed') })
const unmute = act(async n => { await api('PATCH', '/security', { unmute: n }); await load() })
const bans = computed(() => sec.value ? ['names', 'ips', 'uids'].flatMap(k => sec.value.bans[k].map(v => ({ kind: k, value: v }))) : [])
</script>
<template>
  <div v-if="sec">
    <div class="page-h"><div><h1>Security</h1><p>Access control, bans and the admin audit trail</p></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Maintenance mode</h3><span class="push"><Switch :model-value="sec.maintenance.on" label="Maintenance" @change="maint" /></span></div>
        <p class="mut sm" style="margin:0 0 12px">Kicks everyone who isn't an operator and blocks new joins until you switch it off.</p>
        <div class="field"><label>Message shown to players</label><input v-model="msg" class="input" maxlength="140" placeholder="Server is under maintenance"></div></div>
      <div class="card"><div class="card-h"><h3>Allowlist</h3><span class="push"><Switch :model-value="!!sec.allowlist.on" label="Allowlist" @change="allowOn" /></span></div>
        <p class="mut sm" style="margin:0 0 12px">When on, only these names can join.</p>
        <form class="row" @submit.prevent="allowAdd"><input v-model="allowVal" class="input" maxlength="20" placeholder="Player name"><button class="btn">Add</button></form>
        <div class="chips" style="margin-top:12px"><span v-for="n in sec.allowlist.names" :key="n" class="pill info">{{ n }}<button class="x" :aria-label="'Remove ' + n" @click="allowDel(n)">×</button></span><span v-if="!sec.allowlist.names.length" class="mut xs">Nobody listed.</span></div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Bans</h3><span class="sub">{{ bans.length }} active</span></div>
      <form class="row wrap" @submit.prevent="ban"><select v-model="banKind" class="select" style="width:130px" aria-label="Ban type"><option value="names">Name</option><option value="ips">IP</option><option value="uids">Device</option></select><input v-model="banVal" class="input grow" placeholder="Value to ban" style="min-width:180px"><button class="btn danger">Ban</button></form>
      <div class="chips" style="margin-top:14px"><span v-for="b in bans" :key="b.kind + b.value" class="pill bad"><small class="up" style="color:inherit;opacity:.7">{{ b.kind.slice(0, -1) }}</small>{{ b.value }}<button class="x" :aria-label="'Unban ' + b.value" @click="unban(b.kind, b.value)">×</button></span><span v-if="!bans.length" class="mut xs">No bans.</span></div>
      <div v-if="sec.mutes.length" style="margin-top:16px"><div class="up" style="margin-bottom:8px">Muted</div><div class="chips"><span v-for="n in sec.mutes" :key="n" class="pill warn">{{ n }}<button class="x" :aria-label="'Unmute ' + n" @click="unmute(n)">×</button></span></div></div></div>
    <div class="card flush"><div class="card-h" style="padding:18px 18px 0"><h3>Audit log</h3><span class="sub">last {{ audit.length }} admin actions</span></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Action</th><th>Detail</th><th>From</th></tr></thead><tbody>
        <tr v-for="(a, i) in audit" :key="i"><td class="mut sm" style="white-space:nowrap">{{ ago(a.at) }}</td><td><span class="pill info">{{ a.action }}</span></td><td class="mono xs" style="word-break:break-all">{{ a.detail }}</td><td class="mono xs mut">{{ a.ip }}</td></tr>
        <tr v-if="!audit.length"><td colspan="4"><div class="empty"><b>Nothing yet</b>Admin actions are recorded here.</div></td></tr></tbody></table></div></div>
  </div>
</template>
<style scoped>
.x { all: unset; cursor: pointer; margin-left: 4px; padding: 0 3px; opacity: .6; font-size: 14px; line-height: 1 } .x:hover { opacity: 1 }
</style>

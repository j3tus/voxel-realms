<script setup>
const s = useAdmin(), list = ref([]), world = ref(''), busy = ref(false)
const load = async () => { list.value = await api('GET', '/backups') }
onMounted(() => { act(load)(); world.value = (s.worlds[0] || {}).id || '' })
const wn = id => (s.worlds.find(w => w.id === id) || {}).name || id
const create = act(async () => { busy.value = true; try { const r = await api('POST', `/worlds/${world.value}/backup`); toast('Backup ' + r.file); await load() } finally { busy.value = false } })
const dl = act(async b => { const r = await api('GET', '/backups/' + encodeURIComponent(b.file), null, true); const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = b.file; a.click(); URL.revokeObjectURL(u) })
const del = act(async b => { if (!(await confirmBox('Delete backup', b.file + ' will be permanently removed.', true, 'Delete'))) return; await api('DELETE', '/backups/' + encodeURIComponent(b.file)); await load(); toast('Backup deleted') })
const restore = act(async b => { if (!(await confirmBox('Restore ' + wn(b.world), 'Replaces the live world with this backup. Players in it will be disconnected.', true, 'Restore'))) return; await api('POST', `/worlds/${b.world}/restore`, { file: b.file }); toast('World restored') })
const total = computed(() => list.value.reduce((a, b) => a + b.size, 0))
</script>
<template>
  <div>
    <div class="page-h"><div><h1>Backups</h1><p>{{ list.length }} backups · {{ fmtSize(total) }}</p></div>
      <div class="actions"><select v-model="world" class="select" style="width:200px" aria-label="World"><option v-for="w in s.worlds" :key="w.id" :value="w.id">{{ w.name }}</option></select><button class="btn primary" :disabled="busy || !world" @click="create"><Icon name="plus" />Create backup</button></div></div>
    <div class="card flush"><div class="scroll-x"><table class="tbl"><thead><tr><th>World</th><th>File</th><th>Size</th><th>Created</th><th class="r" /></tr></thead><tbody>
      <tr v-for="b in list" :key="b.file"><td><b>{{ wn(b.world) }}</b></td><td class="mono xs mut">{{ b.file }}</td><td class="num">{{ fmtSize(b.size) }}</td><td class="mut sm">{{ ago(b.at) }}</td>
        <td class="r"><button class="btn sm" @click="restore(b)">Restore</button> <button class="btn sm icon ghost" aria-label="Download" @click="dl(b)"><Icon name="down" :size="15" /></button> <button class="btn sm icon ghost" aria-label="Delete" @click="del(b)"><Icon name="trash" :size="15" /></button></td></tr>
      <tr v-if="!list.length"><td colspan="5"><div class="empty"><b>No backups yet</b>Create one above. A backup is also kept whenever a world is deleted.</div></td></tr></tbody></table></div></div>
  </div>
</template>

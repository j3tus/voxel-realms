<script setup>
const s = useAdmin(), val = ref(''), inp = ref(null)
watch(() => s.dialog, d => { if (d) { val.value = d.value ?? ''; nextTick(() => inp.value?.focus()) } })
const ok = () => closeDialog(s.dialog.kind === 'prompt' ? val.value : true)
const cancel = () => closeDialog(s.dialog.kind === 'prompt' ? null : false)
</script>
<template>
  <Transition name="dlg">
    <div v-if="s.dialog" class="dl" @pointerdown.self="cancel" @keydown.esc="cancel">
      <form class="dl-card" role="dialog" aria-modal="true" :aria-label="s.dialog.title" @submit.prevent="ok">
        <h3>{{ s.dialog.title }}</h3>
        <p v-if="s.dialog.text" class="mut">{{ s.dialog.text }}</p>
        <div v-if="s.dialog.kind === 'prompt'" class="field"><label>{{ s.dialog.label }}</label><input ref="inp" v-model="val" class="input" :type="s.dialog.type" :step="s.dialog.type === 'number' ? 'any' : undefined" autocomplete="off"></div>
        <div class="row end"><button type="button" class="btn ghost" @click="cancel">Cancel</button><button type="submit" class="btn" :class="s.dialog.danger ? 'danger' : 'primary'">{{ s.dialog.ok }}</button></div>
      </form>
    </div>
  </Transition>
</template>
<style scoped>
.dl { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgba(3, 6, 12, .6); backdrop-filter: blur(8px) }
.dl-card { width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 22px; border-radius: 20px; background: linear-gradient(180deg, rgba(255, 255, 255, .05), transparent 40%), var(--s2); border: 1px solid var(--line2); box-shadow: 0 40px 80px -20px rgba(0, 0, 0, .9) }
.dl-card h3 { font-size: 18px } .dl-card p { margin: 0 }
.dlg-enter-active, .dlg-leave-active { transition: opacity .18s } .dlg-enter-active .dl-card, .dlg-leave-active .dl-card { transition: transform .22s var(--ease) } .dlg-enter-from, .dlg-leave-to { opacity: 0 } .dlg-enter-from .dl-card { transform: translateY(12px) scale(.97) }
</style>

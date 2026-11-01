<script setup>
// Click-to-open dropdown. Items: [{ label, icon, danger, run, check, sep }]. Closes on outside click / Escape.
const props = defineProps({ items: { type: Array, required: true }, label: { type: String, default: 'More actions' } })
const open = ref(false), root = ref(null), up = ref(false)
const toggle = () => { open.value = !open.value; if (open.value) nextTick(() => { const r = root.value?.querySelector('.mn-pop')?.getBoundingClientRect(); up.value = !!r && r.bottom > innerHeight - 12 }) }
const off = e => { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
const esc = e => { if (e.key === 'Escape') open.value = false }
onMounted(() => { document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc) })
const pick = it => { if (it.sep || it.check !== undefined) return; open.value = false; act(it.run)() }
</script>
<template>
  <div class="mn" ref="root">
    <button class="btn icon sm" :aria-label="label" :aria-expanded="open" @click.stop="toggle"><Icon name="dots" /></button>
    <Transition name="pop">
      <div v-if="open" class="mn-pop" :class="{ up }" role="menu">
        <template v-for="(it, i) in items" :key="i">
          <hr v-if="it.sep">
          <label v-else-if="it.check !== undefined" class="mn-i"><input type="checkbox" :checked="it.check" @change="e => act(it.run)(e.target.checked)"><span>{{ it.label }}</span></label>
          <button v-else class="mn-i" :class="{ danger: it.danger }" role="menuitem" @click="pick(it)"><Icon v-if="it.icon" :name="it.icon" :size="15" />{{ it.label }}</button>
        </template>
      </div>
    </Transition>
  </div>
</template>
<style scoped>
.mn { position: relative; display: inline-block }
.mn-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 50; min-width: 200px; padding: 6px; border-radius: 14px; background: linear-gradient(180deg, rgba(255, 255, 255, .05), transparent), var(--s2); border: 1px solid var(--line2); box-shadow: 0 24px 50px -12px rgba(0, 0, 0, .8), 0 0 0 1px rgba(0, 0, 0, .4); transform-origin: top right }
.mn-pop.up { top: auto; bottom: calc(100% + 6px); transform-origin: bottom right }
.mn-i { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 11px; border: 0; border-radius: 9px; background: none; color: var(--txt); font-size: 13px; text-align: left; cursor: pointer }
.mn-i:hover { background: rgba(255, 255, 255, .07) } .mn-i.danger { color: var(--bad) } .mn-i.danger:hover { background: rgba(251, 113, 133, .12) }
.mn-i input { accent-color: #6ee7a8; width: 15px; height: 15px; margin: 0 }
hr { border: 0; border-top: 1px solid var(--line); margin: 5px 4px }
.pop-enter-active, .pop-leave-active { transition: opacity .12s, transform .14s var(--ease) } .pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(.96) translateY(-4px) }
@media (max-width: 720px) { .mn-pop { min-width: 220px } }
</style>

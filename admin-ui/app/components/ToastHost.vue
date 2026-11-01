<script setup>const s = useAdmin()</script>
<template>
  <div class="ts" aria-live="polite">
    <TransitionGroup name="t"><div v-for="t in s.toasts" :key="t.id" class="t-i" :class="{ bad: t.bad }"><Icon :name="t.bad ? 'x' : 'check'" :size="16" />{{ t.msg }}</div></TransitionGroup>
  </div>
</template>
<style scoped>
.ts { position: fixed; z-index: 120; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none }
.t-i { display: flex; align-items: center; gap: 9px; padding: 11px 16px; border-radius: 12px; font-weight: 600; font-size: 13px; background: var(--s3); border: 1px solid rgba(110, 231, 168, .35); color: var(--txt); box-shadow: 0 16px 40px -10px rgba(0, 0, 0, .8), 0 0 24px -8px rgba(110, 231, 168, .4) }
.t-i svg { color: var(--acc) } .t-i.bad { border-color: rgba(251, 113, 133, .45); box-shadow: 0 16px 40px -10px rgba(0, 0, 0, .8), 0 0 24px -8px rgba(251, 113, 133, .4) } .t-i.bad svg { color: var(--bad) }
.t-enter-active, .t-leave-active { transition: all .25s var(--ease) } .t-enter-from { opacity: 0; transform: translateX(20px) } .t-leave-to { opacity: 0; transform: translateY(8px) }
@media (max-width: 860px) { .ts { bottom: 84px; right: 12px; left: 12px; align-items: stretch } }
</style>

<script setup>
defineProps({ modelValue: Boolean, label: String })
const emit = defineEmits(['update:modelValue', 'change'])
</script>
<template>
  <label class="sw" :title="label"><input type="checkbox" :checked="modelValue" @change="e => { emit('update:modelValue', e.target.checked); emit('change', e.target.checked) }" :aria-label="label"><span /></label>
</template>
<style scoped>
.sw { position: relative; display: inline-block; width: 40px; height: 23px; flex: none } .sw input { position: absolute; opacity: 0; inset: 0; cursor: pointer; z-index: 1; margin: 0 }
.sw span { position: absolute; inset: 0; border-radius: 99px; background: rgba(255, 255, 255, .1); border: 1px solid var(--line2); transition: background .2s, box-shadow .2s }
.sw span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, .4); transition: transform .2s var(--ease) }
.sw input:checked + span { background: var(--acc-grad); border-color: transparent; box-shadow: 0 0 16px -2px rgba(110, 231, 168, .55) } .sw input:checked + span::after { transform: translateX(17px) }
.sw input:focus-visible + span { outline: 2px solid var(--acc2); outline-offset: 2px }
</style>

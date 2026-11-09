<script setup>
import { ref } from 'vue'
import PdfToolbar from './components/PdfToolbar.vue'
import PdfCanvas from './components/PdfCanvas.vue'
import MergeRangeDialog from './components/MergeRangeDialog.vue'
import ShortcutHelpDialog from './components/ShortcutHelpDialog.vue'
import { usePdfEditor } from './composables/usePdfEditor.js'

const root = ref(null)
const shortcutsOpen = ref(false)
const { editor, status, error, retry } = usePdfEditor(root)
// 供宿主 Vue 页面通过组件 ref 访问编辑器；不在 window 上挂载业务状态。
defineExpose({ editor })
</script>

<template>
  <div ref="root" class="pdf-workspace">
    <PdfToolbar :shortcuts-open="shortcutsOpen" @shortcuts="shortcutsOpen = true" />
    <PdfCanvas />
    <div id="status" class="status" role="status" aria-live="polite">{{ status }}</div>
    <MergeRangeDialog />
    <ShortcutHelpDialog :open="shortcutsOpen" @close="shortcutsOpen = false" />
    <div v-if="error" class="editor-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" @click="retry">重试</button>
    </div>
  </div>
</template>

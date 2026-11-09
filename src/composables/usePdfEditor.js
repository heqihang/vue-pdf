import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { loadFontPrograms } from '@/services/font-programs.js'
import { createFontProgramStore } from '@/services/font-program-store.js'
import { createPdfEditor } from '@/modules/pdf/createPdfEditor.js'

/** 先显示并绑定编辑器，再在空闲时预取字库；原 PDF 的显示不依赖替换字库。 */
export function usePdfEditor(root) {
  const editor = shallowRef(null)
  const ready = ref(false)
  const error = ref('')
  const status = ref('✨ 准备就绪')
  const fonts = createFontProgramStore(loadFontPrograms, {
    schedule: callback => window.requestIdleCallback
      ? window.requestIdleCallback(callback, { timeout: 1500 }) : window.setTimeout(callback, 50),
    cancel: handle => window.cancelIdleCallback ? window.cancelIdleCallback(handle) : window.clearTimeout(handle),
  })
  let disposed = false
  const initialize = () => {
    if (disposed || editor.value) return
    error.value = ''
    try {
      editor.value = createPdfEditor({
        root: root.value,
        fontPrograms: fonts.programs,
        ensureFontPrograms: fonts.ensureReady,
        onStatus: text => { status.value = text },
      })
      ready.value = true
      fonts.prefetch()
    } catch (cause) {
      console.error('PDF 编辑器初始化失败', cause)
      error.value = `编辑器启动失败：${cause.message}`
    }
  }
  onMounted(initialize)
  onBeforeUnmount(() => {
    disposed = true
    fonts.dispose()
    editor.value?.dispose()
    editor.value = null
  })
  return { editor, ready, error, status, retry: initialize }
}

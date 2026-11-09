<script setup>
import { nextTick, ref, watch } from 'vue'
const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null)
let opener = null
const close = () => {
  if (dialog.value?.open) dialog.value.close()
  emit('close')
  opener?.isConnected && opener.focus({ preventScroll: true })
  opener = null
}
watch(() => props.open, async open => {
  await nextTick()
  if (open && !dialog.value.open) {
    opener = document.activeElement
    dialog.value.showModal()
    dialog.value.scrollTop = 0
    dialog.value.querySelector('.shortcut-help-content').scrollTop = 0
  } else if (!open && dialog.value.open) close()
})
</script>

<template>
<dialog ref="dialog" @cancel.prevent="close" @close="emit('close')" @keydown.stop class="shortcut-help-dialog" id="shortcutHelpDialog" aria-labelledby="shortcutHelpTitle" aria-describedby="shortcutHelpNote">
    <header class="shortcut-help-header">
        <h2 id="shortcutHelpTitle">快捷键一览</h2>
        <button class="shortcut-help-close" type="button" data-shortcut-close @click="close" aria-label="关闭快捷键一览" autofocus>×</button>
    </header>
    <div class="shortcut-help-content" tabindex="0" role="region" aria-label="快捷键列表">
        <section aria-labelledby="shortcutEditTitle">
            <h3 id="shortcutEditTitle">选框与区域编辑</h3>
            <p id="shortcutHelpNote">成功导入 JSON 后，在显示边界的编辑状态下生效。先点击 PDF 编辑区；输入框、工具栏和弹窗内保留正常键盘操作。</p>
            <table><thead><tr><th scope="col">快捷键</th><th scope="col">功能</th></tr></thead><tbody>
                <tr><td><kbd>空格</kbd></td><td>选中当前页第一个框</td></tr>
                <tr><td><kbd>Tab</kbd></td><td>选中下一个框，可跨页</td></tr>
                <tr><td><kbd>Shift</kbd> + <kbd>Tab</kbd></td><td>选中上一个框，可跨页</td></tr>
                <tr><td><kbd>Enter</kbd></td><td>打开选中框的字号、行间距设置</td></tr>
                <tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>移动选中框，每次 1px</td></tr>
                <tr><td><kbd>Shift</kbd> + 方向键</td><td>移动选中框，每次 10px</td></tr>
                <tr><td><kbd>Ctrl</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>缩小 / 增加宽度，每次 1px，左边保持固定</td></tr>
                <tr><td><kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></td><td>缩小 / 增加高度，每次 1px，上边保持固定</td></tr>
                <tr><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + 方向键</td><td>调整宽高，每次 10px</td></tr>
            </tbody></table>
            <p>键盘调整时边框实时变化，停止操作 1 秒后统一更新文字。预览模式只读。</p>
        </section>
        <section aria-labelledby="shortcutZoomTitle">
            <h3 id="shortcutZoomTitle">页面缩放</h3>
            <table><thead><tr><th scope="col">快捷键</th><th scope="col">功能</th></tr></thead><tbody>
                <tr><td><kbd>Ctrl</kbd> + <kbd>+</kbd> 或 <kbd>=</kbd></td><td>放大 PDF</td></tr>
                <tr><td><kbd>Ctrl</kbd> + <kbd>−</kbd></td><td>缩小 PDF</td></tr>
                <tr><td><kbd>Ctrl</kbd> + <kbd>0</kbd></td><td>恢复 100% 缩放</td></tr>
                <tr><td><kbd>Ctrl</kbd> + 鼠标滚轮</td><td>在 PDF 区域内，向上放大、向下缩小</td></tr>
            </tbody></table>
            <p>缩放需先加载 PDF；macOS 可将上述缩放操作中的 Ctrl 换成 ⌘ Command。</p>
        </section>
        <section aria-labelledby="shortcutDialogTitle">
            <h3 id="shortcutDialogTitle">页码、弹窗与取消</h3>
            <table><thead><tr><th scope="col">快捷键</th><th scope="col">功能</th></tr></thead><tbody>
                <tr><td><kbd>Enter</kbd></td><td>页码输入框：跳转到输入页；智能合并页码框：确认范围；字号设置输入框：应用设置</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>取消全部选中、取消正在进行的拖动；关闭弹窗；退出合并或取消合并模式</td></tr>
            </tbody></table>
        </section>
    </div>
    <footer class="shortcut-help-footer"><button type="button" data-shortcut-close @click="close">关闭</button></footer>
</dialog>
</template>

<script setup>
defineProps({ shortcutsOpen: Boolean })
const emit = defineEmits(['shortcuts'])
</script>

<template>
<div class="toolbar">
    <div class="toolbar-title">📄 PDF 查看器</div>
    <div class="spacer"></div>
    <div class="page-nav" id="pageNav">
        <input type="text" inputmode="numeric" class="page-input" id="pageInput" value="1"
               title="输入页码后回车快速跳转"/>
        <span class="page-total">/ <span id="pageTotal">0</span> 页</span>
    </div>
    <div class="file-info" id="fileInfo">
        <span class="file-name" id="fileName"></span>
        <button class="clear-btn" id="clearBtn" title="清除">✕</button>
    </div>
    <div class="toolbar-actions" id="toolbarActions">
        <button class="toolbar-action-btn unmerge-btn" id="unmergeBtn" disabled title="取消合并模式">❌ 取消合并</button>
        <button class="toolbar-action-btn merge-btn" id="mergeBtn" title="合并模式">🔗 合并</button>
        <button class="toolbar-action-btn smart-merge-btn" id="smartMergeBtn" title="智能合并">🤖 智能合并</button>
        <button class="toolbar-action-btn" id="spanBoundariesBtn" type="button" aria-pressed="true"
                title="只读预览，隐藏全部边框">预览
        </button>
        <div class="toolbar-divider"></div>
        <button class="toolbar-action-btn edit-btn" id="downloadBtn" title="导出PDF">💾 导出PDF</button>
        <button class="toolbar-action-btn json-btn" id="exportJsonBtn" title="导出JSON">📤 导出JSON</button>
        <button class="toolbar-action-btn import-btn" id="importJsonBtn" title="导入JSON">📥 导入JSON</button>
        <button class="toolbar-action-btn" id="saveMergeBtn" type="button" title="保存全部页面的合并及编辑进度">保存页面</button>
    </div>
    <button class="toolbar-action-btn" id="restoreMergeBtn" type="button" title="上传保存文件，恢复原 PDF 及编辑进度">恢复页面</button>
    <button class="toolbar-action-btn" id="shortcutHelpBtn" @click="emit('shortcuts')" :aria-expanded="shortcutsOpen" type="button" aria-haspopup="dialog" aria-controls="shortcutHelpDialog" title="查看当前快捷键">⌨ 快捷键一览</button>
    <input type="file" id="mergeSessionInput" accept=".pdfmerge" hidden/>
    <input type="file" id="jsonFileInput" accept="application/json,.json" hidden/>
    <label class="upload-btn">
        <button type="button">📂 选择 PDF</button>
        <input type="file" id="fileInput" accept="application/pdf"/>
    </label>
</div>
</template>

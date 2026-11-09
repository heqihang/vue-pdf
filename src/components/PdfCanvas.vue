<!-- PDF.js 独占 viewer 内部 DOM；不要在 viewer 内使用 v-for/v-html。 -->
<template>
<div class="main" id="mainArea">
    <div class="empty" id="empty">
        <div class="empty-icon">📑</div>
        <div>请上传或拖拽 PDF 文件查看</div>
    </div>
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-spinner"></div>
        <div class="loading-text">正在读取文件，请稍候…</div>
    </div>
    <div class="viewerContainer show-span-boundaries" id="viewerContainer" tabindex="0" aria-label="PDF 编辑区">
        <div id="viewer" class="pdfViewer"></div>
    </div>
</div>
</template>

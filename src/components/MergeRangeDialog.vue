<template>
<div class="smart-merge-modal" id="smartMergeModal">
    <div class="smart-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="smartMergeText">
        <div class="smart-merge-text" id="smartMergeText">请输入需要智能合并的页码范围。范围外的页面不会进行合并。</div>
        <div class="smart-merge-range">
            <label class="smart-merge-field">
                <span>起始页码</span>
                <input type="number" id="smartMergeStartPage" min="1" step="1" inputmode="numeric" placeholder="例如：1">
            </label>
            <label class="smart-merge-field">
                <span>结束页码</span>
                <input type="number" id="smartMergeEndPage" min="1" step="1" inputmode="numeric" placeholder="例如：10">
            </label>
        </div>
        <div class="smart-merge-error" id="smartMergeError" role="alert" aria-live="polite"></div>
        <div class="smart-merge-actions">
            <button class="smart-merge-btn-confirm" id="smartMergeConfirm">确定</button>
            <button class="smart-merge-btn-cancel" id="smartMergeCancel">取消</button>
        </div>
    </div>
</div>
</template>

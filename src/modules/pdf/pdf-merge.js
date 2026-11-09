import { PDFSmartMerge } from './smart-merge.js'
export const PDFMerge = Object.freeze({ create: app => {
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
let smartMerge;

const MERGE_COVER_TOP_OVERLAP_PX = 0;

const MERGE_COVER_TOP_OVERLAP_PT = 0;

const MERGE_REGION_OFFSET_Y_PX = 5;

let mergeMode = false;

let unmergeMode = false;
let unmergeLocked = false;

let mergeRecords = [];

let mergeRecordSerial = 0;

let mergeSelecting = false;

let mergeStartX = 0;

let mergeStartY = 0;

let mergeSelectRect = null;

const applyReplacementFlowSpan = (span, record) => {
      const flow = record.replacementFlow, scale = app.getPageScale(record.pageNum);
      delete span.dataset.sourceAppearance;
      delete span.dataset.originalLines;
      span.dataset.jsonReplacement = '1';
      span.dataset.replacementFlow = '1';
      span.dataset.mergeScaleX = '1';
      span.textContent = flow.lines.join('\n');
      Object.assign(span.style, {
        left: `${flow.x * scale}px`,
        top: `${flow.top * scale}px`,
        width: `${flow.width * scale}px`,
        height: `${flow.height * scale}px`,
        fontSize: `${flow.size * scale}px`,
        lineHeight: `${flow.lineHeight * scale}px`,
        fontFamily: record.importedFontFamily || record.fontFamily,
        fontWeight: record.fontWeight,
        color: flow.color,
        background: 'transparent',
        padding: '0',
        whiteSpace: 'pre',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        transform: 'none'
      });
      record.replacementTopPt = flow.top;
      record.replacementHeightPt = flow.height;
      record.fitScale = 1;
      if (record.coverDiv) record.coverDiv.style.display = 'none';
    };

const ensureMergeDataId = record => {
      if (!record.dataId) {
        record.dataId = `p${record.pageNum}-m${++mergeRecordSerial}`;
      }
      if (record.mergedSpan) record.mergedSpan.setAttribute('data-id', record.dataId);
      return record.dataId;
    };

const getMergeSourceIndices = record => {
      const source = record.sourceIndices && record.sourceIndices.length ? record.sourceIndices : (record.spanIndices || []).map(index => index + 1);
      return [...new Set(source.map(index => parseInt(index, 10)).filter(index => index > 0))];
    };

const getPageMergedSourceIndices = pageNum => new Set(mergeRecords
      .filter(record => record.pageNum === pageNum)
      .flatMap(getMergeSourceIndices));

const fitMergedSpanText = el => {
      const record = mergeRecords.find(item => item.mergedSpan === el);
      if (!record) return 1;
      const scale = app.getPageScale(record.pageNum), layout = record.replacementFixed;
      el.dataset.jsonReplacement = '1';el.dataset.mergeScaleX = '1';
      delete el.dataset.sourceAppearance;delete el.dataset.originalLines;delete el.dataset.replacementFlow;
      if (layout) el.textContent = layout.lines.join('\n');
      el.dataset.jsonLogicalText = record.mergedText;
      app.markTextOverflow(el, layout);
      Object.assign(el.style, {
        left: `${(layout?.x ?? record.leftPt) * scale}px`, top: `${(layout?.top ?? record.topPt) * scale}px`,
        width: `${(layout?.width ?? record.widthPt) * scale}px`, height: `${(layout?.height ?? record.heightPt) * scale}px`,
        fontSize: `${(layout?.fontSize ?? record.fontSizePt) * scale}px`, lineHeight: `${(layout?.lineHeight || record.lineHeightPt) * scale}px`,
        fontFamily: layout?.family || record.importedFontFamily || record.fontFamily,
        fontWeight: '400', fontStyle: 'normal', fontStretch: 'normal', fontSynthesis: 'none', textDecoration: 'none', textShadow: 'none', textTransform: 'none', letterSpacing: `${(layout?.letterSpacing || 0)*scale}px`, wordSpacing: `${(layout?.wordSpacing || 0)*scale}px`, color: record.fontColor, textAlign: layout?.alignment || record.textAlign || 'left',
        background: 'transparent', padding: '0', overflow: 'hidden',
        whiteSpace: layout ? 'pre' : 'pre-wrap', overflowWrap:'anywhere', wordBreak:'normal', transform:'none'
      });
      record.replacementTopPt = layout?.top ?? record.topPt;record.replacementHeightPt = layout?.height ?? record.heightPt;record.fitScale = 1;
      if (record.coverDiv) record.coverDiv.style.display = 'none';
      return 1;
    };

const updateUnmergeBtn = () => {
      const editReady=unmergeLocked&&!app.jsonFileInput.dataset.importing?'1':'0';
      if(document.body.dataset.regionEditReady!==editReady){
        document.body.dataset.regionEditReady=editReady;
        if(editReady==='0'){app.regionResize?.reset();app.regionEditor?.suspend();}
        app.regionEditor?.refresh();
      }
      if(unmergeLocked){
        mergeMode=false;mergeSelecting=false;
        mergeSelectRect?.remove();mergeSelectRect=null;
        app.mergeBtn.classList.remove('active');
        app.viewerContainer.classList.remove('merge-mode');
        smartMerge?.closeDialog();
        app.updateImportJsonBtn();
        unmergeMode=false;
        app.unmergeBtn.classList.remove('active');
        app.viewerContainer.classList.remove('unmerge-mode');
      }
      app.spanBoundariesBtn.disabled=false;
      app.spanBoundariesBtn.title=app.viewerContainer.classList.contains('show-span-boundaries')?'只读预览，隐藏全部边框':'显示蓝色、绿色和红色边框';
      app.exportJsonBtn.disabled=unmergeLocked;
      app.exportJsonBtn.title=unmergeLocked?'已导入 JSON，不能导出 JSON':'导出JSON';
      app.mergeBtn.disabled=unmergeLocked;
      app.mergeBtn.title=unmergeLocked?'已导入 JSON，不能合并':'合并模式';
      const smartButton=app.byId('smartMergeBtn');
      smartButton.disabled=unmergeLocked||!!smartMerge?.running;
      smartButton.title=unmergeLocked?'已导入 JSON，不能智能合并':'智能合并';
      app.unmergeBtn.disabled = unmergeLocked || mergeRecords.length === 0;
      app.unmergeBtn.title = unmergeLocked ? '已导入 JSON，不能取消合并' : app.unmergeBtn.disabled ? '当前无合并区域' : '取消合并模式';
    };

const createEditCover = (left, top, width, height, topOverlap) => {
      const safeTopOverlap = topOverlap === undefined ? MERGE_COVER_TOP_OVERLAP_PX : Math.max(0, topOverlap);
      const div = document.createElement('div');
      div.className = 'edit-cover';
      div.style.left = `${left}px`;
      div.style.top = `${top - safeTopOverlap}px`;
      div.style.width = `${width}px`;
      div.style.height = `${height + safeTopOverlap}px`;
      div.dataset.coverTopOverlap = String(safeTopOverlap);
      return div;
    };

const addOriginalSourceCovers = (cover, layer, pageNum, indices) => {
      cover.querySelectorAll('[data-source-cover]').forEach(child => child.remove());
      const viewport = app.pdfViewer?.getPageView(pageNum - 1)?.viewport;
      if (!viewport?.convertToViewportRectangle) return;
      const layerRect = layer.getBoundingClientRect();
      const scaleX = layerRect.width / viewport.width, scaleY = layerRect.height / viewport.height;
      const parentLeft = parseFloat(cover.style.left), parentTop = parseFloat(cover.style.top);
      const parentRight = parentLeft + parseFloat(cover.style.width),
        parentBottom = parentTop + parseFloat(cover.style.height);
      for (const box of app.getOriginalSourceBoxes(pageNum, indices)) {
        const rect = viewport.convertToViewportRectangle([box.x, box.y, box.x + box.width, box.y + box.height]);
        const left = Math.max(0, Math.min(rect[0], rect[2]) * scaleX);
        const top = Math.max(0, Math.min(rect[1], rect[3]) * scaleY);
        const right = Math.min(layerRect.width, Math.max(rect[0], rect[2]) * scaleX);
        const bottom = Math.min(layerRect.height, Math.max(rect[1], rect[3]) * scaleY);
        if (right <= left || bottom <= top || left >= parentLeft && top >= parentTop && right <= parentRight && bottom <= parentBottom) continue;
        const child = createEditCover(left - parentLeft, top - parentTop, right - left, bottom - top, 0);
        child.dataset.sourceCover = '1';
        cover.appendChild(child);
      }
    };

const hasOriginalMergeLines = record => record.originalLines?.length > 0 && record.mergedText === record._initialText && !app.fontSettings.enabled && !app.regionEditor.has(record.dataId);

const getMergeDisplayText = record => hasOriginalMergeLines(record) ? record.originalLines.join('\n') : record.mergedText;

const restoreOriginalMergeLines = (span, record) => {
      if (record.mergedText === record._initialText && !app.fontSettings.enabled && !app.regionEditor.has(record.dataId)) app.markTextOverflow(span, null);
      if (record.replacementFixed && (record.mergedText !== record._initialText || app.fontSettings.enabled || app.regionEditor.has(record.dataId))) { fitMergedSpanText(span);return; }
      if (record.replacementFlow) {
        applyReplacementFlowSpan(span, record);
        return;
      }
      if (span.dataset.replacementFlow) {
        delete span.dataset.replacementFlow;
        Object.assign(span.style, {
          left: `${record.leftPt * app.getPageScale(record.pageNum)}px`,
          top: `${record.topPt * app.getPageScale(record.pageNum)}px`
        });
      }
      const unchanged = record.mergedText === record._initialText && !app.fontSettings.enabled && !app.regionEditor.has(record.dataId);
      if (record.auditRowFrame) span.dataset.auditRowFrame = '1';
      if (record.preserveSourceAppearance && unchanged) span.dataset.sourceAppearance = '1';
      else delete span.dataset.sourceAppearance;
      if (record.coverDiv) record.coverDiv.style.display = 'none';
      if (unchanged) {
        delete span.dataset.jsonReplacement;
        delete record.replacementHeightPt;
        delete record.replacementTopPt;
      }
      if (!hasOriginalMergeLines(record)) {
        delete span.dataset.originalLines;
        span.style.textAlign = record.textAlign || 'left';
        return;
      }
      const scale = app.getPageScale(record.pageNum),
        scaleX = record.preserveSourceAppearance && unchanged ? 1 : record.scaleX || 1;
      const visualWidth = record.widthPt * scale;
      span.dataset.originalLines = '1';
      span.textContent = getMergeDisplayText(record);
      Object.assign(span.style, {
        fontSize: `${record.fontSizePt * scale}px`, lineHeight: `${record.lineHeightPt * scale}px`,
        width: `${visualWidth / scaleX}px`, height: `${record.heightPt * scale}px`,
        whiteSpace: 'pre', overflowWrap: 'normal', wordBreak: 'normal',
        transform: scaleX === 1 ? 'none' : `scaleX(${scaleX})`, transformOrigin: 'left top'
      });
      span.dataset.mergeScaleX = String(scaleX);
      span.style.textAlign = record.textAlign || 'left';
      delete record.fitScale;
      delete span.dataset.mergeBaseFontSize;
      delete span.dataset.mergeBaseLineHeight;
      // 原文仍由 PDF 绘制；替代字体的 scrollWidth 不应改变原文字框的几何尺寸。
      if (record.preserveSourceAppearance && unchanged) {
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1),
          snap = value => Math.round(value * pixelRatio) / pixelRatio;
        const origin = span.parentNode?.getBoundingClientRect() || {left: 0, top: 0};
        const left = snap(record.leftPt * scale + origin.left) - origin.left,
          top = snap(record.topPt * scale + origin.top) - origin.top;
        Object.assign(span.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${snap((record.leftPt + record.widthPt) * scale + origin.left) - origin.left - left}px`,
          height: `${snap((record.topPt + record.heightPt) * scale + origin.top) - origin.top - top}px`
        });
        if (span.style.setProperty) span.style.setProperty('--merge-frame-width', `${1 / pixelRatio}px`);
        else span.style['--merge-frame-width'] = `${1 / pixelRatio}px`;
        return;
      }
      span.style.width = `${visualWidth}px`;
      span.style.transform = 'none';span.dataset.mergeScaleX = '1';
    };

const createMergeSpan = (text, left, top, width, height, fontSizeCSS, fontFamily, fontWeight, lineHeightCSS, scaleX, fontColor) => {
      const span = document.createElement('span');
      span.className = 'is-merged';
      span.textContent = text;
      const transformStr = scaleX && scaleX !== 1 ? `transform:scaleX(${scaleX});transform-origin:left top;` : '';
      const colorStr = fontColor && fontColor !== 'transparent' && fontColor !== 'rgba(0, 0, 0, 0)' ? `color:${fontColor};` : 'color:#000000;';
      span.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${fontSizeCSS}px;font-family:${fontFamily};font-weight:${fontWeight};line-height:${lineHeightCSS}px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;overflow:hidden;${colorStr}${transformStr}`;
      span.dataset.mergeSpan = '1';
      if (text.includes('\n')) span.style.whiteSpace = 'pre-wrap';
      if (scaleX && scaleX !== 1) span.dataset.mergeScaleX = scaleX;
      return span;
    };

const INVISIBLE_CHARS_RE = /[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g;

const stripInvisibleChars = text => (text || '').replace(INVISIBLE_CHARS_RE, '');

const cleanTextForMatch = text => stripInvisibleChars(text).trim();

const isCjkCharacter = ch => !!ch && /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(ch);

const joinMergedTextParts = (parts, compactIdentifiers = false, compactHyphenatedWords = false) => {
      if (compactIdentifiers && parts.every(part => /^\d+$/.test(cleanTextForMatch(part)))) return parts.map(cleanTextForMatch).join('');
      let result = '', previousPart = '';
      for (const _part of parts) {
        const current = cleanTextForMatch(_part);
        if (!current) continue;
        if (!result) {
          result = current;
          previousPart = current;
          continue;
        }
        const left = result.charAt(result.length - 1);
        const right = current.charAt(0);
        const noSpace = compactHyphenatedWords && /^[-‐‑][A-Za-z]+$/.test(current) || isCjkCharacter(left) || isCjkCharacter(right) || /[（(［\[｛{《〈“‘]/.test(left) || /[，。！？；：、）》〉”’]/.test(left) || /[）)］\]｝}》〉，。！？；：、,.!?;:”’]/.test(right) || /[-‐‑‒–—]/.test(left) || compactIdentifiers && (/[/^]/.test(left) || right === '/' || /\([A-Z]{1,3}$/.test(result) && /^[A-Z]+[)）]/.test(current) || /^[A-Z0-9]{1,3}[-‐‑]?$/.test(previousPart) && /^[A-Z0-9]{1,3}[)）%‐‑-]?$/.test(current));
        result += (noSpace ? '' : ' ') + current;
        previousPart = current;
      }
      return result;
    };

const tokenizeTextForWrap = text => (text || '').match(/\s+|[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[^\s\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g) || [];

const shouldPreserveMergeSourceAppearance = sourceSpans => sourceSpans.every(({span}) => {
      if (span.classList.contains('is-json-replaced')) return false;
      if (!span.classList.contains('is-merged')) return true;
      const record = mergeRecords.find(item => item.mergedSpan === span);
      return !app.fontSettings.enabled && !app.regionEditor.has(record?.dataId) && !!record?.preserveSourceAppearance && record.mergedText === record._initialText;
    });

const restoreSpanFromSaved = saved => {
      const span = document.createElement('span');
      span.textContent = saved.textContent;
      if (saved.className) span.className = saved.className;
      if (saved.style) span.setAttribute('style', saved.style);
      Object.assign(span.dataset, saved.dataset);
      return span;
    };

const toggleMergeMode = () => {
      if(unmergeLocked||app.jsonFileInput.dataset.importing){app.setStatus(unmergeLocked?'已导入 JSON，不能合并。':'JSON 正在导入，请稍候。');return;}
      if (smartMerge.running) {
        app.setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      // 互斥：进入合并模式时退出取消合并模式
      if (mergeMode === false && unmergeMode) toggleUnmergeMode();
      mergeMode = !mergeMode;
      app.mergeBtn.classList.toggle('active', mergeMode);
      app.viewerContainer.classList.toggle('merge-mode', mergeMode);
      app.updateImportJsonBtn(); // 同步导入按钮，任何模式下均保持可用
      if (mergeMode) {
        app.setStatus('🔗 合并模式：框选多个文字即可合并');
      } else {
        app.setStatus('✨ 正常模式');
      }
    };

app.mergeBtn.addEventListener('click', toggleMergeMode);

const deduplicateTextItems = (items, includeRejected = true) => {
      const seen = new Map();
      return items.filter(item => {
        if (item.skipDedup) return true;
        if (!seen.has(item.text)) seen.set(item.text, new Map());
        const cells = seen.get(item.text), x = Math.floor(item.left / 3), y = Math.floor(item.top / 3);
        let duplicate = false;
        for (let dx = -1; dx <= 1 && !duplicate; dx++) {
          for (let dy = -1; dy <= 1 && !duplicate; dy++) {
            duplicate = cells.get(`${x + dx}:${y + dy}`)?.some(previous => Math.abs(previous.left - item.left) < 3 && Math.abs(previous.top - item.top) < 3) || false;
          }
        }
        if (!duplicate || includeRejected) {
          const key = `${x}:${y}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(item);
        }
        return !duplicate;
      });
    };

app.viewerContainer.addEventListener('mousedown', e => {
      if (!app.viewerContainer.classList.contains('show-span-boundaries')||unmergeLocked||app.jsonFileInput.dataset.importing||!mergeMode || e.button !== 0) return;
      if (e.target.closest('.edit-cover')) return;
      const pageDiv = e.target.closest('.page');
      if (!pageDiv) return;
      const textLayer = pageDiv.querySelector('.textLayer');
      if (!textLayer) return;
      const layerRect = textLayer.getBoundingClientRect();
      mergeStartX = e.clientX - layerRect.left;
      mergeStartY = e.clientY - layerRect.top;
      mergeSelecting = true;

      // 创建选框
      mergeSelectRect = document.createElement('div');
      mergeSelectRect.className = 'merge-select-rect';
      mergeSelectRect.style.left = `${mergeStartX}px`;
      mergeSelectRect.style.top = `${mergeStartY}px`;
      mergeSelectRect.style.width = '0px';
      mergeSelectRect.style.height = '0px';
      textLayer.appendChild(mergeSelectRect);
      e.preventDefault();
    });

document.addEventListener('mousemove', e => {
      if (!mergeSelecting || !mergeSelectRect) return;
      const textLayer = mergeSelectRect.closest('.textLayer');
      if (!textLayer) return;
      const layerRect = textLayer.getBoundingClientRect();
      const curX = e.clientX - layerRect.left;
      const curY = e.clientY - layerRect.top;
      const x = Math.min(mergeStartX, curX);
      const y = Math.min(mergeStartY, curY);
      const w = Math.abs(curX - mergeStartX);
      const h = Math.abs(curY - mergeStartY);
      mergeSelectRect.style.left = `${x}px`;
      mergeSelectRect.style.top = `${y}px`;
      mergeSelectRect.style.width = `${w}px`;
      mergeSelectRect.style.height = `${h}px`;
    });

document.addEventListener('mouseup', async e => {
      if (!mergeSelecting) return;
      mergeSelecting = false;
      if (!mergeSelectRect) return;
      const textLayer = mergeSelectRect.closest('.textLayer');
      if (!textLayer) {
        mergeSelectRect.remove();
        mergeSelectRect = null;
        return;
      }
      const layerRect = textLayer.getBoundingClientRect();
      const rectLeft = parseFloat(mergeSelectRect.style.left);
      const rectTop = parseFloat(mergeSelectRect.style.top);
      const rectWidth = parseFloat(mergeSelectRect.style.width);
      const rectHeight = parseFloat(mergeSelectRect.style.height);
      mergeSelectRect.remove();
      mergeSelectRect = null;

      // 框选太小则忽略
      if (rectWidth < 10 || rectHeight < 5) return;

      // 查找框选区域内的 span
      const pageDiv = textLayer.closest('.page');
      if (!pageDiv) return;
      const pageNum = parseInt(pageDiv.dataset.pageNumber || pageDiv.getAttribute('data-page-number'));
      if (!pageNum) return;
      const spans = textLayer.querySelectorAll('span');
      let selectedSpans = [];
      // 收集框选区域内已合并的 span 对应的旧合并记录
      const absorbedMergeIndices = [];
      for (let i = 0; i < spans.length; i++) {
        const spanRect = spans[i].getBoundingClientRect();
        const relSpanLeft = spanRect.left - layerRect.left;
        const relSpanTop = spanRect.top - layerRect.top;
        const relSpanRight = relSpanLeft + spanRect.width;
        const relSpanBottom = relSpanTop + spanRect.height;

        // 判断 span 是否完全在框选区域内（只有完整包含才可合并）
        if (relSpanLeft >= rectLeft && relSpanTop >= rectTop && relSpanRight <= rectLeft + rectWidth && relSpanBottom <= rectTop + rectHeight) {
          // 跳过已合并的 span（由 absorbedMergeIndices 处理）
          if (!spans[i].classList.contains('is-merged')) {
            // 过滤异常 span：内容仅含控制字符/不可见字符的 span 不参与合并
            const spanText = spans[i].textContent;
            if (!spanText || !stripInvisibleChars(spanText)) continue;
          }
          selectedSpans.push({
            span: spans[i],
            index: i
          });
          // 如果是已合并的 span，记录其合并记录索引
          if (spans[i].classList.contains('is-merged')) {
            for (let mi = 0; mi < mergeRecords.length; mi++) {
              if (mergeRecords[mi].mergedSpan === spans[i]) {
                if (absorbedMergeIndices.indexOf(mi) === -1) {
                  absorbedMergeIndices.push(mi);
                }
                break;
              }
            }
          }
        }
      }

      // 去重：移除位置重叠且文本相同的非合并 span（PDF 可能有重复文本对象）
      selectedSpans = deduplicateTextItems(selectedSpans.map(selected => {
        if (selected.span.classList.contains('is-merged')) return {selected, skipDedup: true};
        const rect = selected.span.getBoundingClientRect();
        return {
          selected,
          text: cleanTextForMatch(selected.span.textContent),
          left: rect.left - layerRect.left,
          top: rect.top - layerRect.top
        };
      }), false).map(item => item.selected);

      // 需要至少 2 个非合并 span 才合并
      let nonMergedCount = 0;
      for (const _selected2 of selectedSpans) {
        if (!_selected2.span.classList.contains('is-merged')) nonMergedCount++;
      }
      if (nonMergedCount < 2) {
        app.setStatus('🔗 未框选到多个文字，请重新框选');
        return;
      }

      // 执行合并
      try {
        await performMerge(selectedSpans, pageNum, textLayer, layerRect, rectLeft, rectTop, rectWidth, rectHeight, absorbedMergeIndices, {
          preserveSourceAppearance: shouldPreserveMergeSourceAppearance(selectedSpans),
          preserveSelectionBounds: true,
          preserveCellBounds: true
        });
      } catch (err) {
        console.error('合并失败:', err);
        app.setStatus(`合并失败: ${err.message || '字体信息读取失败'}`);
      }
    });

const performMerge = async (selectedSpans, pageNum, textLayer, layerRect, rectLeft, rectTop, rectWidth, rectHeight, absorbedMergeIndices, options) => {
      if(unmergeLocked||app.jsonFileInput.dataset.importing)return false;
      options = options || {};
      const scale = app.getPageScale(pageNum);
      if (!scale) return false;

      // 缓存真实文字边界；保留原 PDF 外观时，边框跟随原文，不使用重排偏移或紧凑行高。
      for (const selected of selectedSpans) {
        const rect = selected.span.getBoundingClientRect();
        selected._rect = {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height};
      }
      const preserveSourceAppearance = !!options.preserveSourceAppearance;
      const boundaryInset = preserveSourceAppearance ? 0 : 6;
      const maxLayerWidth = textLayer.clientWidth || layerRect.width;
      const maxLayerHeight = textLayer.clientHeight || layerRect.height;
      if (preserveSourceAppearance && !options.preserveSelectionBounds) {
        const padding = (options.framePaddingPt ?? .75) * scale;
        const nativeFrame = options.sourceBoundsOverride;
        const rects = nativeFrame ? [{
          left: layerRect.left + nativeFrame.left,
          top: layerRect.top + nativeFrame.top,
          right: layerRect.left + nativeFrame.right,
          bottom: layerRect.top + nativeFrame.bottom
        }] : selectedSpans.map(item => item._rect);
        const nativeBounds = options.sourceBounds;
        const sourceLeft = Math.min(...rects.map(rect => rect.left), nativeBounds ? layerRect.left + nativeBounds.left : Infinity);
        const sourceTop = Math.min(...rects.map(rect => rect.top), nativeBounds ? layerRect.top + nativeBounds.top : Infinity);
        const sourceRight = Math.max(...rects.map(rect => rect.right), nativeBounds ? layerRect.left + nativeBounds.right : -Infinity);
        const sourceBottom = Math.max(...rects.map(rect => rect.bottom), nativeBounds ? layerRect.top + nativeBounds.bottom : -Infinity);
        let leftPadding = padding, topPadding = padding, rightPadding = padding, bottomPadding = padding;
        const selectedElements = new Set(selectedSpans.map(item => item.span));
        for (const span of textLayer.querySelectorAll('span')) {
          if (selectedElements.has(span)) continue;
          const rect = span.getBoundingClientRect();
          if (rect.right > sourceLeft && rect.left < sourceRight) {
            if (rect.bottom <= sourceTop + 0.01 * scale) topPadding = Math.min(topPadding, Math.max(0, sourceTop - rect.bottom) / 2);
            if (rect.top >= sourceBottom - 0.01 * scale) bottomPadding = Math.min(bottomPadding, Math.max(0, rect.top - sourceBottom) / 2);
          }
          if (rect.bottom > sourceTop && rect.top < sourceBottom) {
            if (rect.right <= sourceLeft + 0.01 * scale) leftPadding = Math.min(leftPadding, Math.max(0, sourceLeft - rect.right) / 2);
            if (rect.left >= sourceRight - 0.01 * scale) rightPadding = Math.min(rightPadding, Math.max(0, rect.left - sourceRight) / 2);
          }
        }
        // 批次表格允许边框轻微重叠，保留上下留白以完整包住字形。
        if (Number.isFinite(options.frameVerticalPaddingPt)) {
          topPadding = bottomPadding = Math.max(0, options.frameVerticalPaddingPt) * scale;
        }
        rectLeft = sourceLeft - layerRect.left - leftPadding;
        rectTop = sourceTop - layerRect.top - topPadding;
        rectWidth = sourceRight - layerRect.left + rightPadding - rectLeft;
        rectHeight = sourceBottom - layerRect.top + bottomPadding - rectTop;
        const row = options.frameRowBounds;
        if (row && Number.isFinite(row.top) && Number.isFinite(row.bottom) && row.bottom > row.top) {
          const bottom = Math.min(rectTop + rectHeight, row.bottom);
          rectTop = Math.max(rectTop, row.top);
          rectHeight = bottom - rectTop;
        }
        // 全角标点的文字框包含字形右侧空白；表格边框不能因此伸进相邻列。
        const column = options.frameColumnBounds;
        if (column && Number.isFinite(column.left) && Number.isFinite(column.right) && column.right > column.left) {
          const right = Math.min(rectLeft + rectWidth, column.right);
          rectLeft = Math.max(rectLeft, column.left);
          rectWidth = right - rectLeft;
        }
      }
      const safeLeft = Math.max(boundaryInset, rectLeft);
      const offset = preserveSourceAppearance ? 0 : options.topOffsetPt !== undefined ? options.topOffsetPt * scale : options.preserveCellBounds ? 0 : MERGE_REGION_OFFSET_Y_PX;
      const safeTop = Math.max(boundaryInset, rectTop - offset);
      const safeRight = Math.min(maxLayerWidth - boundaryInset, rectLeft + rectWidth);
      const safeBottom = Math.min(maxLayerHeight - boundaryInset, rectTop + rectHeight);
      rectLeft = safeLeft;
      rectTop = safeTop;
      rectWidth = safeRight - safeLeft;
      rectHeight = safeBottom - safeTop;
      if (rectWidth < 2 || rectHeight < 2) return false;

      // 合并文字：按从左到右、从上到下排序（同行判定：顶部或底部任一对齐即视为同行，兼容同行不同字号）
      selectedSpans.sort((a, b) => {
        const aTop = a._rect.top - layerRect.top;
        const bTop = b._rect.top - layerRect.top;
        const aBottom = aTop + a._rect.height;
        const bBottom = bTop + b._rect.height;
        if (Math.abs(aTop - bTop) < a._rect.height * 0.5 || Math.abs(aBottom - bBottom) < a._rect.height * 0.5) {
          return a._rect.left - layerRect.left - (b._rect.left - layerRect.left);
        }
        return aTop - bTop;
      });

      // 收集文字，只保存非合并的原始 span 信息
      const mergedTextParts = [];
      const spanIndices = [];
      const sourceIndices = [];
      const savedSpans = [];
      const absorbedMergeRecords = [];
      for (const s of selectedSpans) {
        spanIndices.push(s.index);
        // 清理 span 文本中的控制字符和不可见字符
        const cleanText = cleanTextForMatch(s.span.textContent);
        if (cleanText) mergedTextParts.push(cleanText);
        if (s.span.classList.contains('is-merged')) {
          const record = mergeRecords.find(record => record.mergedSpan === s.span);
          if (record) sourceIndices.push(...getMergeSourceIndices(record));
        } else {
          let sourceIndex = parseInt(s.span.dataset.sourceIndex, 10);
          if (!(sourceIndex > 0)) sourceIndex = s.index + 1;
          sourceIndices.push(sourceIndex);
          const savedSpanInfo = {
            index: s.index,
            textContent: s.span.textContent,
            className: s.span.className,
            style: s.span.getAttribute('style') || '',
            dataset: JSON.parse(JSON.stringify(s.span.dataset))
          };
          savedSpans.push(savedSpanInfo);
        }
      }
      const mergedText = options.mergedText ?? joinMergedTextParts(mergedTextParts);

      // 吸收旧合并记录
      if (absorbedMergeIndices && absorbedMergeIndices.length > 0) {
        absorbedMergeIndices.sort((a, b) => b - a);
        for (const _mergeIndex of absorbedMergeIndices) {
          const oldMerge = mergeRecords[_mergeIndex];
          if (oldMerge) {
            absorbedMergeRecords.push({
              pageNum: oldMerge.pageNum,
              spanIndices: oldMerge.spanIndices ? oldMerge.spanIndices.slice() : [],
              sourceIndices: getMergeSourceIndices(oldMerge),
              dataId: oldMerge.dataId,
              mergedText: oldMerge.mergedText,
              _initialText: oldMerge._initialText,
              originalLines: oldMerge.originalLines,
              preserveSourceAppearance: oldMerge.preserveSourceAppearance,
              auditRowFrame: oldMerge.auditRowFrame,
              textAlign: oldMerge.textAlign,
              leftPt: oldMerge.leftPt,
              topPt: oldMerge.topPt,
              widthPt: oldMerge.widthPt,
              heightPt: oldMerge.heightPt,
              fontSizePt: oldMerge.fontSizePt,
              cssFontSize: oldMerge.cssFontSize,
              fontFamily: oldMerge.fontFamily,
              fontName: oldMerge.fontName,
              originalFontName: oldMerge.originalFontName,
              fontWeight: oldMerge.fontWeight,
              importedFontFamily: oldMerge.importedFontFamily,
              fontColor: oldMerge.fontColor,
              lineHeightPt: oldMerge.lineHeightPt,
              scaleX: oldMerge.scaleX || 1,
              fitScale: oldMerge.fitScale,
              isEdited: oldMerge.isEdited || false,
              savedSpans: oldMerge.savedSpans || []
            });
            if (oldMerge.coverDiv && oldMerge.coverDiv.isConnected) oldMerge.coverDiv.remove();
            mergeRecords.splice(_mergeIndex, 1);
          }
        }
      }

      // 计算框选区域的 PDF 坐标
      const leftPt = rectLeft / scale;
      const topPt = rectTop / scale;
      const widthPt = rectWidth / scale;
      let heightPt = rectHeight / scale;

      // 获取第一个非合并 span 的字体信息
      const firstNonMergedSpan = selectedSpans.find(({span}) => !span.classList.contains('is-merged'))?.span || selectedSpans[0].span;
      const computedStyle = getComputedStyle(firstNonMergedSpan);
      const fontSizeCSS = parseFloat(computedStyle.fontSize) || 12;
      const fontSizePt = fontSizeCSS / scale;
      // 优先使用原 PDF 字体程序，避免文字层通用字体改变合并效果
      const originalFontInfo = await app.resolveOriginalSpanFontInfo(pageNum, firstNonMergedSpan, app.getSpanIndex(firstNonMergedSpan), mergedText, selectedSpans, !preserveSourceAppearance);
      const origFontFamily = originalFontInfo.fontFamily;
      const origFontWeight = originalFontInfo.fontWeight;

      // 获取原始 span 的 scaleX 变换值
      const firstTransform = firstNonMergedSpan.style.transform || '';
      const scaleXMatch = firstTransform.match(/scaleX\(([\d.]+)\)/);
      const scaleX = preserveSourceAppearance ? 1 : scaleXMatch ? parseFloat(scaleXMatch[1]) : 1;

      // 计算行高：从所有 span 的垂直位置推算实际行间距（包括已合并 span 内部的多行）
      const lineTops = [];
      for (const _selected6 of selectedSpans) {
        const sp = _selected6.span;
        if (!sp.classList.contains('is-merged')) {
          const spanTop = _selected6._rect.top - layerRect.top;
          if (!lineTops.some(top => Math.abs(top - spanTop) < 3)) lineTops.push(spanTop);
        } else {
          // 已合并 span：根据存储的 lineHeightPt 还原内部各行位置
          const mergeRec = mergeRecords.find(record => record.mergedSpan === sp);
          if (mergeRec && mergeRec.lineHeightPt) {
            const mergeTop = _selected6._rect.top - layerRect.top;
            const mergeHeight = _selected6._rect.height;
            const mergeLineH = mergeRec.lineHeightPt * scale;
            const lineCount = Math.max(1, Math.round(mergeHeight / mergeLineH));
            for (let ml = 0; ml < lineCount; ml++) {
              const mlTop = mergeTop + ml * mergeLineH;
              if (!lineTops.some(top => Math.abs(top - mlTop) < 3)) lineTops.push(mlTop);
            }
          }
        }
      }
      lineTops.sort((a, b) => a - b);
      let lineSpacing = 0;
      if (lineTops.length >= 2) {
        for (let lsi = 1; lsi < lineTops.length; lsi++) {
          lineSpacing += lineTops[lsi] - lineTops[lsi - 1];
        }
        lineSpacing /= lineTops.length - 1;
      } else {
        // 单行，用 span 高度作为行高
        lineSpacing = firstNonMergedSpan.getBoundingClientRect().height;
      }

      if (!preserveSourceAppearance && options.renderLineHeightPt) lineSpacing = options.renderLineHeightPt * scale;

      // 从 DOM 中移除所有选中的 span
      for (const _selected7 of selectedSpans) {
        app.removePlainTextCover(_selected7.span);
        _selected7.span.remove();
      }

      // 创建白色覆盖层和合并 span
      const bigCoverDiv = createEditCover(rectLeft, rectTop, rectWidth, rectHeight);
      bigCoverDiv.dataset.mergeCover = '1';
      addOriginalSourceCovers(bigCoverDiv, textLayer, pageNum, getMergeSourceIndices({sourceIndices}));
      textLayer.insertBefore(bigCoverDiv, textLayer.firstChild);
      const lineHeightCSS = lineSpacing;
      const originalLines = options.originalLines;
      // 合并 span 的内容宽度需要除以 scaleX（因为 scaleX 会拉伸内容）
      const contentWidth = rectWidth / scaleX;
      const fontColor = computedStyle.color;
      const mergedSpan = createMergeSpan(originalLines?.length ? originalLines.join('\n') : mergedText, rectLeft, rectTop, contentWidth, rectHeight, fontSizeCSS, origFontFamily, origFontWeight, lineHeightCSS, scaleX, fontColor);
      textLayer.appendChild(mergedSpan);

      const mergeFitScale = undefined;

      if (options.compactBounds) addOriginalSourceCovers(bigCoverDiv, textLayer, pageNum, getMergeSourceIndices({sourceIndices}));

      // 存储合并记录
      const mergeRecord = {
        pageNum,
        spanIndices,
        sourceIndices: getMergeSourceIndices({
          sourceIndices
        }),
        dataId: `p${pageNum}-m${++mergeRecordSerial}`,
        mergedText,
        _initialText: mergedText,
        originalLines,
        preserveSourceAppearance: options.preserveSourceAppearance,
        auditRowFrame: !!options.frameRowBounds,
        textAlign: options.textAlign,
        leftPt,
        topPt,
        widthPt,
        heightPt,
        fontSizePt,
        cssFontSize: fontSizeCSS,
        fontFamily: origFontFamily,
        importedFontFamily: '',
        fontWeight: origFontWeight,
        fontName: originalFontInfo.fontName,
        originalFontName: originalFontInfo.originalFontName,
        fontColor,
        lineHeightPt: lineSpacing / scale,
        scaleX,
        fitScale: mergeFitScale,
        isEdited: undefined,
        coverDiv: bigCoverDiv,
        mergedSpan,
        savedSpans,
        absorbedMergeRecords
      };
      restoreOriginalMergeLines(mergedSpan, mergeRecord);
      mergedSpan.setAttribute('data-id', mergeRecord.dataId);
      mergeRecords.push(mergeRecord);
      if (!options.deferUiUpdates && (app.importedTexts.size || app.fontSettings.enabled || app.regionEditor.size)) {
        app.invalidateImportedBackground();
        app.refreshImportedPageBackgrounds(pageNum).catch(err => console.warn('替换底图更新失败:', err));
      }
      if (!options.deferUiUpdates) {
        app.updateImportJsonBtn();
        updateUnmergeBtn();
        app.assignContentDataIds(pageNum);
        app.setStatus(`🔗 已合并 ${selectedSpans.length} 个文字段 · 共 ${mergeRecords.length} 处合并`);
      }
      return true;
    };

const clearMergeArtifacts = pageNum => {
      const root = pageNum ? app.getPageDiv(pageNum) : app.viewerDiv;
      if (!root) return;
      root.querySelectorAll('span[data-merge-span]').forEach(el => {
        el.remove();
      });
      root.querySelectorAll('.edit-cover[data-merge-cover]').forEach(el => {
        el.remove();
      });
    };

const refreshMergeCovers = pageNum => {
      clearMergeArtifacts(pageNum);
      if (!app.pdfViewer) return;
      mergeRecords.forEach(merge => {
        if (pageNum && merge.pageNum !== pageNum) return;
        const page = app.getPageDiv(merge.pageNum);
        if (!page) return;
        const layer = page.querySelector('.textLayer');
        if (!layer) return;
        const scale = app.getPageScale(merge.pageNum);
        if (!scale) return;
        const rectLeft = merge.leftPt * scale;
        const rectTop = merge.topPt * scale;
        const rectWidth = merge.widthPt * scale;
        const rectHeight = merge.heightPt * scale;
        const fontSizeCSS = merge.fontSizePt * scale;
        const lineHeightCSS = merge.lineHeightPt * scale;

        // 移除合并区域内的原始小 span（包括异常的极小 span）
        const allSpans = layer.querySelectorAll('span:not([data-merge-span])');
        const layerRect = layer.getBoundingClientRect();
        const mergeSourceIndices = new Set(getMergeSourceIndices(merge));
        for (let ai = allSpans.length - 1; ai >= 0; ai--) {
          const sp = allSpans[ai];
          const sourceIndex = parseInt(sp.dataset.sourceIndex, 10);
          const spRect = sp.getBoundingClientRect();
          const spCenterX = spRect.left - layerRect.left + spRect.width / 2;
          const spCenterY = spRect.top - layerRect.top + spRect.height / 2;
          const matchesSource = sourceIndex > 0 && mergeSourceIndices.has(sourceIndex);
          const matchesGeometry = mergeSourceIndices.size === 0 && spCenterX >= rectLeft && spCenterX <= rectLeft + rectWidth && spCenterY >= rectTop && spCenterY <= rectTop + rectHeight;
          if (matchesSource || matchesGeometry) {
            sp.remove();
          }
        }

        // 创建白色覆盖层和合并 span
        const bigCoverDiv = createEditCover(rectLeft, rectTop, rectWidth, rectHeight);
        bigCoverDiv.dataset.mergeCover = '1';
        addOriginalSourceCovers(bigCoverDiv, layer, merge.pageNum, getMergeSourceIndices(merge));
        layer.insertBefore(bigCoverDiv, layer.firstChild);
        merge.coverDiv = bigCoverDiv;
        const mergeScaleX = merge.scaleX || 1;
        const contentWidth = mergeScaleX !== 1 ? rectWidth / mergeScaleX : rectWidth;
        const mergedSpan = createMergeSpan(getMergeDisplayText(merge), rectLeft, rectTop, contentWidth, rectHeight, fontSizeCSS, merge.importedFontFamily || merge.fontFamily, merge.fontWeight, lineHeightCSS, mergeScaleX, merge.fontColor);
        mergedSpan.setAttribute('data-id', ensureMergeDataId(merge));
        layer.appendChild(mergedSpan);
        merge.mergedSpan = mergedSpan;
        restoreOriginalMergeLines(mergedSpan, merge);
        // 重绘替换内容时恢复原字号，再计算换行范围。
        if (!hasOriginalMergeLines(merge) && merge.fitScale !== undefined) {
          merge.fitScale = fitMergedSpanText(mergedSpan);
        }
      });
      app.forEachPageDiv(pageNum, page => app.assignPageElementIds(page, Number(page.dataset.pageNumber)));
    };

const toggleUnmergeMode = () => {
      if(unmergeLocked||app.jsonFileInput.dataset.importing){app.setStatus(unmergeLocked?'已导入 JSON，不能取消合并。':'JSON 正在导入，请稍候。');return;}
      if (smartMerge.running) {
        app.setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      // 互斥：进入取消合并模式时退出合并模式
      if (unmergeMode === false && mergeMode) toggleMergeMode();
      unmergeMode = !unmergeMode;
      app.unmergeBtn.classList.toggle('active', unmergeMode);
      app.viewerContainer.classList.toggle('unmerge-mode', unmergeMode);
      if (unmergeMode) {
        app.setStatus('❌ 取消合并模式：点击已合并区域即可还原');
      } else {
        app.setStatus('✨ 正常模式');
      }
    };

app.unmergeBtn.addEventListener('click', toggleUnmergeMode);

const unmergeRecord = rec => {
      if(unmergeLocked||app.jsonFileInput.dataset.importing)return false;
      const idx = mergeRecords.indexOf(rec);
      if (idx < 0) return false;
      if (!rec.mergedSpan || !rec.mergedSpan.isConnected) return false;
      const layer = rec.mergedSpan.parentNode;
      rec.mergedSpan.remove();
      if (rec.coverDiv && rec.coverDiv.isConnected) rec.coverDiv.remove();

      // 恢复合并前的原始小 span
      if (rec.savedSpans) {
        for (const _saved of rec.savedSpans) {
          layer.appendChild(restoreSpanFromSaved(_saved));
        }
      }

      // 恢复被吸收的旧合并区域（合并前该区域本身就是合并状态）
      if (rec.absorbedMergeRecords) {
        for (const oldRec of rec.absorbedMergeRecords) {
          const oldScale = app.getPageScale(oldRec.pageNum);
          if (!oldScale) continue;
          const oldLeft = oldRec.leftPt * oldScale;
          const oldTop = oldRec.topPt * oldScale;
          const oldWidth = oldRec.widthPt * oldScale;
          const oldHeight = oldRec.heightPt * oldScale;
          const oldFontSizeCSS = oldRec.fontSizePt * oldScale;
          const oldLineHeightCSS = oldRec.lineHeightPt * oldScale;
          const oldCoverDiv = createEditCover(oldLeft, oldTop, oldWidth, oldHeight);
          oldCoverDiv.dataset.mergeCover = '1';
          addOriginalSourceCovers(oldCoverDiv, layer, oldRec.pageNum, getMergeSourceIndices(oldRec));
          layer.insertBefore(oldCoverDiv, layer.firstChild);
          const oldScaleX = oldRec.scaleX || 1;
          const oldContentWidth = oldScaleX !== 1 ? oldWidth / oldScaleX : oldWidth;
          const oldMergedSpan = createMergeSpan(getMergeDisplayText(oldRec), oldLeft, oldTop, oldContentWidth, oldHeight, oldFontSizeCSS, oldRec.importedFontFamily || oldRec.fontFamily, oldRec.fontWeight, oldLineHeightCSS, oldScaleX, oldRec.fontColor);
          oldMergedSpan.setAttribute('data-id', ensureMergeDataId(oldRec));
          layer.appendChild(oldMergedSpan);
          oldRec.coverDiv = oldCoverDiv;
          oldRec.mergedSpan = oldMergedSpan;
          // 先绑定新覆盖层，再恢复外观，避免取消外层合并后露出白底。
          restoreOriginalMergeLines(oldMergedSpan, oldRec);
          if (!hasOriginalMergeLines(oldRec) && oldRec.fitScale !== undefined) {
            oldRec.fitScale = fitMergedSpanText(oldMergedSpan);
          }
          mergeRecords.push(oldRec);
        }
      }
      mergeRecords.splice(idx, 1);
      app.regionEditor.remove(rec.dataId);
      app.invalidateImportedBackground();
      if (app.importedTexts.size || app.fontSettings.enabled || app.regionEditor.size) app.applyImportedTexts(rec.pageNum);
      return true;
    };

const findMergeAtClick = e => {
      const target = e.target.closest?.('span[data-merge-span]');
      const directMatch = target && mergeRecords.find(record => record.mergedSpan === target);
      if (directMatch) return directMatch;
      const page = e.target.closest?.('.page');
      if (!page || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
      const pageNum = Number(page.dataset.pageNumber);
      for (let i = mergeRecords.length - 1; i >= 0; i--) {
        const record = mergeRecords[i];
        if (record.pageNum !== pageNum || !record.mergedSpan?.isConnected) continue;
        const rect = record.mergedSpan.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) return record;
      }
      return null;
    };

const handleUnmergeClick = e => {
      if (!app.viewerContainer.classList.contains('show-span-boundaries')||unmergeLocked||app.jsonFileInput.dataset.importing||!unmergeMode) return;
      const rec = findMergeAtClick(e);
      if (!rec) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (unmergeRecord(rec)) {
        app.updateImportJsonBtn();
        updateUnmergeBtn();
        app.assignContentDataIds(rec.pageNum);
        if (mergeRecords.length === 0) {
          // 最后一块合并区域被取消：自动退出取消合并模式并禁用按钮
          if (unmergeMode) toggleUnmergeMode();
          app.setStatus('✅ 已取消合并 · 当前无合并区域');
        } else {
          app.setStatus(`✅ 已取消合并 · 剩余 ${mergeRecords.length} 处合并`);
        }
      }
    };

app.viewerContainer.addEventListener('click', handleUnmergeClick, {capture: true});

smartMerge = PDFSmartMerge.create({ scope,
      get locked(){return unmergeLocked||!!app.jsonFileInput.dataset.importing;},
      get pdfDoc() {
        return app.pdfDoc;
      },
      get pdfViewer() {
        return app.pdfViewer;
      },
      get eventBus() {
        return app.eventBus;
      },
      get mergeMode() {
        return mergeMode;
      },
      get unmergeMode() {
        return unmergeMode;
      },
      byId: app.byId,
      viewerContainer: app.viewerContainer,
      pageTextLayerRefreshTasks: app.pageTextLayerRefreshTasks,
      getLoadedPdfFont: app.getLoadedPdfFont,
      setStatus: app.setStatus,
      updateImportJsonBtn: app.updateImportJsonBtn,
      updateUnmergeBtn,
      getPageScale: app.getPageScale,
      cleanTextForMatch,
      joinMergedTextParts,
      getPageTextContent: app.getPageTextContent,
      findTextContentItemForSpan: app.findTextContentItemForSpan,
      shouldPreserveMergeSourceAppearance,
      assignContentDataIds: app.assignContentDataIds,
      reconcilePageSourceDataIds: app.reconcilePageSourceDataIds,
      toggleMergeMode,
      performMerge,
      toggleUnmergeMode,
      reserveMergeDataId: () => { mergeRecordSerial++; },
      deduplicateTextItems
    });
return { get smartMerge() { return smartMerge; }, set smartMerge(value) { smartMerge = value; },
get MERGE_COVER_TOP_OVERLAP_PX() { return MERGE_COVER_TOP_OVERLAP_PX; },
get MERGE_COVER_TOP_OVERLAP_PT() { return MERGE_COVER_TOP_OVERLAP_PT; },
get MERGE_REGION_OFFSET_Y_PX() { return MERGE_REGION_OFFSET_Y_PX; },
get mergeMode() { return mergeMode; }, set mergeMode(value) { mergeMode = !unmergeLocked && !!value; },
get unmergeLocked(){return unmergeLocked;},set unmergeLocked(value){unmergeLocked=!!value;updateUnmergeBtn();},
get unmergeMode() { return unmergeMode; }, set unmergeMode(value) { unmergeMode = !unmergeLocked && !!value; },
get mergeRecords() { return mergeRecords; }, set mergeRecords(value) { mergeRecords = value; },
get mergeRecordSerial() { return mergeRecordSerial; }, set mergeRecordSerial(value) { mergeRecordSerial = value; },
get mergeSelecting() { return mergeSelecting; }, set mergeSelecting(value) { mergeSelecting = value; },
get mergeStartX() { return mergeStartX; }, set mergeStartX(value) { mergeStartX = value; },
get mergeStartY() { return mergeStartY; }, set mergeStartY(value) { mergeStartY = value; },
get mergeSelectRect() { return mergeSelectRect; }, set mergeSelectRect(value) { mergeSelectRect = value; },
get applyReplacementFlowSpan() { return applyReplacementFlowSpan; },
get ensureMergeDataId() { return ensureMergeDataId; },
get getMergeSourceIndices() { return getMergeSourceIndices; },
get getPageMergedSourceIndices() { return getPageMergedSourceIndices; },
get fitMergedSpanText() { return fitMergedSpanText; },
get updateUnmergeBtn() { return updateUnmergeBtn; },
get createEditCover() { return createEditCover; },
get addOriginalSourceCovers() { return addOriginalSourceCovers; },
get hasOriginalMergeLines() { return hasOriginalMergeLines; },
get getMergeDisplayText() { return getMergeDisplayText; },
get restoreOriginalMergeLines() { return restoreOriginalMergeLines; },
get createMergeSpan() { return createMergeSpan; },
get INVISIBLE_CHARS_RE() { return INVISIBLE_CHARS_RE; },
get stripInvisibleChars() { return stripInvisibleChars; },
get cleanTextForMatch() { return cleanTextForMatch; },
get isCjkCharacter() { return isCjkCharacter; },
get joinMergedTextParts() { return joinMergedTextParts; },
get tokenizeTextForWrap() { return tokenizeTextForWrap; },
get shouldPreserveMergeSourceAppearance() { return shouldPreserveMergeSourceAppearance; },
get restoreSpanFromSaved() { return restoreSpanFromSaved; },
get toggleMergeMode() { return toggleMergeMode; },
get deduplicateTextItems() { return deduplicateTextItems; },
get performMerge() { return performMerge; },
get clearMergeArtifacts() { return clearMergeArtifacts; },
get refreshMergeCovers() { return refreshMergeCovers; },
get toggleUnmergeMode() { return toggleUnmergeMode; },
get unmergeRecord() { return unmergeRecord; },
get findMergeAtClick() { return findMergeAtClick; },
get handleUnmergeClick() { return handleUnmergeClick; } };
} });

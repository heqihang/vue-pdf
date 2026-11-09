
/** json 功能模块，通过实时app接口访问其他功能。 */
export const PDFJson =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
const pageAnnotationTextCache = new Map();
// 早期 JSON 把 PDF.js 的空白项也算入编号；仅在大量原文锚点确认后转换。
// 新导出的 JSON 带明确编号版本，稀疏 JSON 和证据不足的旧文件仍严格按 data-id。
const normalizeImportedSegments = async (segments, scheme) => {
  if (scheme === 'pdfjs-visible-index-v1') return { segments, legacy: false, aliases: new Map() };
  const pages = new Map();
  for (const row of segments) {
    const match = /^p(\d+)-(\d+)$/.exec(String(row?.id || ''));
    if (!match || +match[1] < 1 || +match[1] > app.pdfDoc.numPages) continue;
    if (!pages.has(+match[1])) pages.set(+match[1], []);
    pages.get(+match[1]).push({ row, index: +match[2] });
  }
  const normalize = value => String(value ?? '').replace(/\s/g, '');
  const mappings = new Map(), pageScores = new Map();let rawScore = 0, visibleScore = 0, anchors = 0;
  for (const [number, rows] of pages) {
    const items = (await app.getPageTextContent(number))?.items || [], visible = items.filter(item => item.str?.trim()), mapping = new Map();
    let index = 0;items.forEach((item, raw) => { if (item.str?.trim()) mapping.set(raw + 1, ++index); });
    mappings.set(number, mapping);
    let rawMatches=0,visibleMatches=0,pageAnchors=0;
    for (const { row, index } of rows) {
      const text = normalize(row.text);if (!text) continue;
      anchors++;pageAnchors++;if (text === normalize(items[index - 1]?.str)) {rawScore++;rawMatches++;}
      if (text === normalize(visible[index - 1]?.str)) {visibleScore++;visibleMatches++;}
    }
    pageScores.set(number,{rawMatches,visibleMatches,pageAnchors});
  }
  const legacy = scheme === 'pdfjs-raw-index' || rawScore >= 12 && rawScore >= anchors * .5 && rawScore > visibleScore * 1.5;
  const aliases = new Map();
  if (!legacy) return { segments, legacy, aliases };
  const textAliases = new Map();
  for (const [number,{rawMatches,visibleMatches,pageAnchors}] of pageScores) {
    if (rawMatches>=3 && rawMatches>=pageAnchors*.5 && rawMatches>visibleMatches*1.5 || scheme==='pdfjs-raw-index') continue;
    // 早期封面在合并后曾重新编号；完整原文可唯一匹配时恢复当前合并/原始 ID。
    const candidates=await buildJsonSegmentsForPage(number),present=new Set(candidates.map(row=>row.id));
    const content=(await app.getPageTextContent(number))?.items.filter(item=>item.str?.trim())||[];
    content.forEach((item,index)=>{const id=`p${number}-${index+1}`;if(!present.has(id))candidates.push({id,text:item.str});});
    const used=new Set();let cursor=0;
    for(const {row} of pages.get(number)){
      const key=normalize(row.text),matches=candidates.map((candidate,index)=>({candidate,index})).filter(({candidate})=>!used.has(candidate.id)&&normalize(candidate.text)===key);
      const selected=matches.find(({index})=>index>=cursor)||matches[0];
      if(selected){textAliases.set(String(row.id),selected.candidate.id);used.add(selected.candidate.id);cursor=selected.index+1;}
    }
    mappings.delete(number);
  }
  return { legacy, aliases, segments: segments.map(row => {
    const match = /^p(\d+)-(\d+)$/.exec(String(row?.id || '')), index = match && mappings.get(+match[1])?.get(+match[2]);
    const id=textAliases.get(String(row?.id)) || (index ? `p${match[1]}-${index}` : String(row?.id));
    if(row?.id==null)return row;aliases.set(String(row.id), id);return { ...row, id };
  }) };
};


const buildJsonSegmentsForPage = async pageNum => {
      const textContent = await app.getPageTextContent(pageNum);
      const pageMerges = app.mergeRecords.filter(record => record.pageNum === pageNum);
      const removedIndices = new Set();
      const mergeRows = [];
      for (let m = 0; m < pageMerges.length; m++) {
        const record = pageMerges[m];
        const sourceIndices = app.getMergeSourceIndices(record);
        for (let si = 0; si < sourceIndices.length; si++) removedIndices.add(sourceIndices[si]);
        const mergeId = app.ensureMergeDataId(record);
        mergeRows.push({
          id: mergeId,
          page: pageNum,
          text: importedTexts.has(mergeId) ? importedTexts.get(mergeId) : record.mergedText,
          _indices: sourceIndices,
          _order: sourceIndices.length ? Math.min(...sourceIndices) : Number.MAX_SAFE_INTEGER,
          _mergeOrder: m
        });
      }
      let rows = [];
      let sourceIndex = 0;
      if (textContent && textContent.items) {
        for (const item of textContent.items) {
          if (!(item.str || '').trim()) continue;
          sourceIndex++;
          if (removedIndices.has(sourceIndex)) continue;
          const sourceId = `p${pageNum}-${sourceIndex}`;
          rows.push({
            id: sourceId,
            page: pageNum,
            text: importedTexts.has(sourceId) ? importedTexts.get(sourceId) : item.str,
            _indices: [sourceIndex],
            _order: sourceIndex,
            _mergeOrder: -1
          });
        }
      }
      const annotationRows = await getPageAnnotationTexts(pageNum);
      rows.push(...mergeRows);
      const sourceItems = (textContent?.items || []).filter(item => item.str?.trim());
      const annotationParts = new Map(), annotationCovered = new Set();
      // 正文、合并段落和链接是同一原文的不同入口；按原文索引去重，
      // 保留DOM上的全部ID与链接，仅让每处原文在JSON中出现一次。
      for (const annotation of [...annotationRows].sort((a,b) => b.sourceItems.length - a.sourceItems.length)) {
        const text = getAnnotationImportedText(annotation);
        if (text === annotation.text || getAnnotationTextOwner(annotation)) continue;
        const indices = annotation.sourceItems.map(source => source.index);
        if (indices.some(index => annotationCovered.has(index))) continue;
        const owners = rows.filter(row => row._indices.some(index => indices.includes(index)));
        if (owners.length === 1 && indices.every(index => owners[0]._indices.includes(index))) {
          const owner = owners[0];
          if (owner._indices.every(index => indices.includes(index))) owner.text = text;
          else {
            // 旧JSON只修改了合并段落中的一个链接时，带上段落其他原文。
            annotationParts.set(indices[0], text);
            indices.forEach(index => annotationCovered.add(index));
            const parts = owner._indices.flatMap(index => annotationCovered.has(index)
              ? annotationParts.has(index) ? [annotationParts.get(index)] : []
              : [importedTexts.get(`p${pageNum}-${index}`) ?? sourceItems[index - 1]?.str ?? '']);
            owner.text = app.joinMergedTextParts(parts);
          }
          indices.forEach(index => annotationCovered.add(index));
        } else if (owners.length && owners.every(row => row._indices.every(index => indices.includes(index)))) {
          // 一个链接跨多个未合并片段且被单独修改时，仍保留其完整译文。
          rows = rows.filter(row => !owners.includes(row));
          rows.push({id: annotation.id, page: pageNum, text, _indices: indices,
            _order: Math.min(...indices), _mergeOrder: Number.MAX_SAFE_INTEGER});
          indices.forEach(index => annotationCovered.add(index));
        }
      }
      rows.sort((a, b) => a._order - b._order || a._mergeOrder - b._mergeOrder);
      return rows.map(row => ({
        id: row.id,
        page: row.page,
        text: row.text,
        canBeTranslated: true
      }));
    };

app.exportJsonBtn.addEventListener('click', async () => {
      if(app.mergeApi.unmergeLocked||app.jsonFileInput.dataset.importing){app.setStatus('JSON 导入期间及导入后不能导出 JSON。');return;}
      if (!app.pdfDoc) {
        app.setStatus('⚠️ 请先加载 PDF 文件');
        return;
      }
      if (app.smartMerge.running) {
        app.setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      try {
        app.setStatus('📤 正在生成 JSON...');
        const segments = [];
        const numPages = app.pdfDoc.numPages;
        for (let n = 1; n <= numPages; n++) {
          const pageSegments = await buildJsonSegmentsForPage(n);
          segments.push(...pageSegments);
        }
        const jsonData = {
          fileName: app.currentFileName || 'document.pdf',
          canBeTranslated: true,
          idScheme: 'pdfjs-visible-index-v1',
          totalPages: numPages,
          segmentCount: segments.length,
          segments
        };
        const dotIdx = app.currentFileName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? app.currentFileName.substring(0, dotIdx) : app.currentFileName || 'document';
        if(app.mergeApi.unmergeLocked||app.jsonFileInput.dataset.importing)return;
        app.downloadBlob(JSON.stringify(jsonData, null, 2), `${baseName}.json`, 'application/json');
        app.setStatus(`✅ 已导出 JSON · ${segments.length} 个文本段`);
      } catch (err) {
        console.error('JSON 导出失败:', err);
        app.setStatus(`❌ JSON 导出失败: ${err.message || '未知错误'}`);
      }
    });

let importedTexts = new Map();

let jsonImportSequence = 0;

const applyImportedTexts = (pageNum,options={}) => {
      app.beginImportedPreviewUpdate(pageNum);
      let changed = 0;
      // 先建立元素到记录的索引，避免每个文本元素再次线性扫描全部合并记录。
      const mergeRecordBySpan = new Map();
      for (const mergeRecord of app.mergeRecords) {
        if (pageNum && mergeRecord.pageNum !== pageNum) continue;
        if (mergeRecord.mergedSpan) mergeRecordBySpan.set(mergeRecord.mergedSpan, mergeRecord);
      }
      app.forEachPageDiv(pageNum, pageDiv => {
        const layer = pageDiv.querySelector('.textLayer');
        assignPageElementIds(pageDiv, Number(pageDiv.dataset.pageNumber));
        if (!layer) return;
        const number = Number(pageDiv.dataset.pageNumber);
        if ((importedTexts.size || app.fontSettings.enabled || app.regionEditor.size) && !app.plainReplacementLayoutCache.has(number)) {
          const sourceDoc = app.pdfDoc;
          app.getPlainReplacementLayouts(number).then(() => app.prepareReplacementParagraphFlow(number)).then(() => { if (app.pdfDoc === sourceDoc) applyImportedTexts(number); }).catch(error => console.warn('替换文字宽度计算失败:', error));
        }
        const els = layer.querySelectorAll('*');
        for (const el of els) {
          const id = el.getAttribute('data-id');
          const rec = mergeRecordBySpan.get(el);
          const replacementLayout = app.plainReplacementLayoutCache.get(Number(pageDiv.dataset.pageNumber))?.layouts.get(id) || rec?.replacementFlow || rec?.replacementFixed;
          if (!id || (!importedTexts.has(id) && !replacementLayout && !el.classList.contains('is-json-replaced')) || (!el.classList.contains('is-merged') && !isPlainContentElement(el))) continue;
          const newText = importedTexts.get(id) ?? rec?.mergedText ?? replacementLayout?.text ?? el.dataset.jsonOriginalText ?? el.textContent;
          const isMerged = el.classList.contains('is-merged');
          const textChanged = (rec ? rec.mergedText : el.textContent) !== (rec ? newText : replacementLayout?.lines?.join('\n') ?? replacementLayout?.text ?? newText);
          let importedFontChanged = false;
          if (isMerged) {
            if (textChanged) el.textContent = newText;
            if (rec) {
              const source = app.pageTextContentCache.get(rec.pageNum)?.items?.filter(item => item.str?.trim())[app.getMergeSourceIndices(rec)[0] - 1];
              rec.fontName ||= source?.fontName || '';
              rec.originalFontName ||= app.getLoadedPdfFont(rec.pageNum, rec.fontName)?.name || '';
              const sourceText = rec._initialText == null ? rec.mergedText : rec._initialText;
              const previousImportedFontFamily = rec.importedFontFamily || '';
              rec.importedFontFamily = newText === sourceText && !app.fontSettings.enabled && !app.regionEditor.has(rec.dataId) ? '' : app.getReplacementFontFamily(newText, rec.fontFamily, rec.originalFontName, app.getLoadedPdfFont(rec.pageNum, rec.fontName),rec.fontWeight);
              if (rec.replacementCompact) rec.importedFontFamily = rec.replacementCompact.family;
              el.style.fontFamily = rec.importedFontFamily || rec.fontFamily;
              el.style.fontWeight = newText === sourceText && !app.fontSettings.enabled && !app.regionEditor.has(rec.dataId) ? rec.fontWeight : '400';
              el.style.fontStyle = newText === sourceText && !app.fontSettings.enabled && !app.regionEditor.has(rec.dataId) ? rec.fontStyle || 'normal' : 'normal';
              const naturalLatin = newText !== sourceText && (newText.match(/[A-Za-z]/g) || []).length > (newText.match(/[\u3400-\u9fff]/g) || []).length;
              el.style.letterSpacing = naturalLatin ? '0px' : '';el.style.wordSpacing = naturalLatin ? '0px' : '';el.style.fontKerning = naturalLatin ? 'none' : '';el.style.fontVariantLigatures = naturalLatin ? 'none' : '';
              el.style.color = rec.fontColor;
              importedFontChanged = previousImportedFontFamily !== rec.importedFontFamily;
            }
          } else if (textChanged || replacementLayout || el.classList.contains('is-json-replaced')) {
            // 导入内容及单独调整排版的区域使用固定布局；其余保留原 PDF。
            app.applyPlainImportedText(el, newText, replacementLayout);
          }
          if (textChanged) changed++;
          // 同步合并记录：缩放/翻页重绘后合并 span 仍显示新文本，且绿框位置（left/top/width/height）不变
          if (rec) {
            rec.mergedText = newText;
            if (app.hasOriginalMergeLines(rec)) {
              app.restoreOriginalMergeLines(el, rec);
              if (rec.replacementFlow && !rec.replacementFlow.changed) el.dataset.sourceAppearance = '1';
              continue;
            }
            app.restoreOriginalMergeLines(el, rec);
            // 字体或文本变化后重新计算显示范围；字号保持不变。
            if (isMerged && (rec.replacementFixed || textChanged || importedFontChanged)) {
              rec.fitScale = app.fitMergedSpanText(el);
            }
            if (rec.replacementCompact?.alignment) el.style.textAlign = rec.replacementFixed?.alignment || rec.replacementCompact.alignment;
          }
        }
      });
      const total = changed + applyAnnotationImportedTexts(pageNum);
      if (!options.deferBackground&&(importedTexts.size || app.fontSettings.enabled || app.regionEditor.size)) app.refreshImportedPageBackgrounds(pageNum).catch(err => console.warn('替换底图更新失败:', err));
      return total;
    };

app.importJsonBtn.addEventListener('click', () => {
      if (!app.pdfDoc) {
        app.setStatus('⚠️ 请先加载 PDF 文件');
        return;
      }
      app.jsonFileInput.click();
    });

app.jsonFileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const error = app.validateFileSize(file);
      if (error) {
        app.setStatus(error);
        e.target.value = '';
        return;
      }
      const sequence=++jsonImportSequence,sourceDoc=app.pdfDoc;
      e.target.value='';
      if(app.smartMerge.running){
        app.setStatus('已选择 JSON，智能合并完成后将自动导入…');
        await app.smartMerge.whenIdle();
      }
      if(app.pdfDoc!==sourceDoc||sequence!==jsonImportSequence)return;
      if(app.mergeMode)app.toggleMergeMode();
      if(app.unmergeMode)app.toggleUnmergeMode();
      app.mergeApi.mergeSelecting=false;
      app.mergeApi.mergeSelectRect?.remove();
      app.mergeApi.mergeSelectRect=null;
      const reader=new FileReader();
      app.jsonFileInput.dataset.importing = String(sequence);
      app.updateUnmergeBtn();
      reader.onload = async () => {
        const previousUnmergeLocked = app.mergeApi.unmergeLocked, previous = new Map(importedTexts), previousFonts = app.fontSettings.snapshot(), previousRecords = app.mergeRecords.map(record => [record, record.mergedText]);
        try {
          if (app.pdfDoc!==sourceDoc||sequence !== jsonImportSequence) return;
          const data = JSON.parse(String(reader.result).replace(/^\uFEFF/, ''));
          const segments = Array.isArray(data) ? data : Array.isArray(data.segments) ? data.segments : Object.entries(data).filter(([id]) => /^p\d+-/.test(id)).map(([id, text]) => ({ id, text }));
          importedTexts = new Map();
          const normalized = await normalizeImportedSegments(segments, data.idScheme);
          for (const seg of normalized.segments) {
            if (seg && seg.id != null) {
              importedTexts.set(String(seg.id), String(seg.text ?? ''));
            }
          }

          // 智能合并后 DOM 中仅剩未被吸收的 span。先恢复这些 span 对应的
          // PDF 原始 ID，再应用 JSON，保证 p1-18 等编号不会因合并而漂移。
          await reconcileRenderedSourceDataIds();
          await app.prepareImportedFonts();
          if(app.pdfDoc!==sourceDoc||sequence!==jsonImportSequence)return;
          const selection=await app.fontSettings.choose();
          if(app.pdfDoc!==sourceDoc||sequence!==jsonImportSequence)return;
          if(selection)app.fontSettings.restore(selection);
          app.setStatus('📥 正在应用文本和字体，请稍候…');
          app.invalidateImportedBackground();
          await app.yieldPdfUi();
          if(app.pdfDoc!==sourceDoc||sequence!==jsonImportSequence)return;
          await app.prepareImportedReplacementLayouts();
          if (app.pdfDoc !== sourceDoc || sequence !== jsonImportSequence) return;
          const count = applyImportedTexts();
          app.mergeApi.unmergeLocked = true;
          let previewError=null;
          try{await app.refreshImportedPageBackgrounds();}catch(error){previewError=error;console.warn('PDF预览未更新，JSON替换结果已保留:',error);}
          if(app.pdfDoc===sourceDoc&&sequence===jsonImportSequence)app.setStatus(`📥 已导入 JSON · 更新 ${count} 处文本${app.fontSettings.enabled?' · 字体已应用到全部页面':''}${previewError?'（PDF预览未完成）':''}`);
        } catch (err) {
          if (app.pdfDoc === sourceDoc && sequence === jsonImportSequence) {
            app.mergeApi.unmergeLocked=previousUnmergeLocked;
            importedTexts=previous;app.fontSettings.restore(previousFonts);
            for(const [record,text]of previousRecords)record.mergedText=text;
            app.invalidateImportedBackground();
            try{await app.prepareImportedReplacementLayouts();applyImportedTexts();await app.refreshImportedPageBackgrounds();}
            catch(restoreError){console.warn('恢复预览失败，原文本和字体设置已保留:',restoreError);}
            app.setStatus(`❌ JSON 导入失败: ${err.message || '文件无效'}`);
          }
          console.error('JSON 导入失败:', err);
        } finally {
        if(app.jsonFileInput.dataset.importing===String(sequence)){
          delete app.jsonFileInput.dataset.importing;
          if(app.pdfDoc===sourceDoc&&sequence===jsonImportSequence)app.updateUnmergeBtn();
          e.target.value = ''; // 允许再次导入同一文件
        }
        }
      };
      reader.onerror = () => {
        if(app.jsonFileInput.dataset.importing!==String(sequence))return;
        delete app.jsonFileInput.dataset.importing;
        app.updateUnmergeBtn();
        e.target.value='';
        app.setStatus('❌ JSON 文件读取失败');
      };
      reader.readAsText(file, 'utf-8');
    });

const assignPageElementIds = (pageDiv, pageNum) => {
      pageDiv.setAttribute('data-id', `p${pageNum}-page`);
      const elements = [...pageDiv.querySelectorAll('*')];
      const usedIds = new Set([pageDiv.getAttribute('data-id'), ...elements.map(el => el.getAttribute('data-id')).filter(Boolean)]);
      for (const el of elements) {
        if (el.getAttribute('data-id')) continue;
        const annotationId = el.getAttribute('data-annotation-id');
        const tag = el.tagName.toLowerCase();
        const siblings = [...(el.parentElement?.children || el.parentNode?.children || [])].filter(item => item.tagName === el.tagName);
        const layerName = el.classList.contains('textLayer') ? 'text' : el.classList.contains('annotationLayer') ? 'annotation' : '';
        const id = annotationId ? `p${pageNum}-a-${annotationId}` : layerName ? `p${pageNum}-layer-${layerName}` : `${el.parentElement?.getAttribute('data-id') || el.parentNode?.getAttribute('data-id') || `p${pageNum}-page`}-e-${tag}-${siblings.indexOf(el)}`;
        let uniqueId = id, suffix = 1;
        while (usedIds.has(uniqueId)) uniqueId = `${id}-${suffix++}`;
        el.setAttribute('data-id', uniqueId);
        usedIds.add(uniqueId);
      }
    };

const isPlainContentElement = el => !el.classList.contains('endOfContent') && !el.classList.contains('edit-cover') && !el.classList.contains('merge-select-rect') && !el.classList.contains('element-json-replacement') && !el.children.length;

const getPageAnnotationTexts = async pageNum => {
      if (pageAnnotationTextCache.has(pageNum)) return pageAnnotationTextCache.get(pageNum).promise;
      const sourceDoc = app.pdfDoc, entry = {rows: [], promise: null};
      entry.promise = (async () => {
        const page = await sourceDoc.getPage(pageNum), annotations = await page.getAnnotations(),
          content = await app.getPageTextContent(pageNum);
        const items = (content?.items || []).filter(item => item.str?.trim()),
          appearances = await app.getPageSourceAppearances(pageNum);
        entry.rows = annotations.filter(annotation => annotation.rect && annotation.subtype === 'Link').map(annotation => {
          const [left, bottom, right, top] = annotation.rect;
          const sourceItems = items.map((item, index) => ({item, index: index + 1})).filter(({item}) => {
            const x = item.transform[4] + item.width / 2, y = item.transform[5];
            // 相邻链接常以文字基线共用边界；上边线属于上一行，不能再吸收一次。
            return x >= left && x <= right && y >= bottom - .01 && y < top - .01;
          });
          const legacyText = app.joinMergedTextParts(items.filter(item => {
            const x = item.transform[4] + item.width / 2, y = item.transform[5];
            return x >= left && x <= right && y >= bottom && y <= top;
          }).map(item => item.str));
          const dominantItem = app.getDominantSourceItem(sourceItems.map(source => source.item), page);
          return {
            dominantItem,
            id: `p${pageNum}-a-${annotation.id}`,
            annotationId: annotation.id,
            pageNum,
            text: app.joinMergedTextParts(sourceItems.map(({item}) => item.str)),
            legacyText,
            sourceItems,
            color: appearances.get(sourceItems[0]?.index)?.color || 'rgb(0, 0, 0)',
            bounds: {x: left, y: bottom, width: right - left, height: top - bottom},
            textStyle: content?.styles?.[dominantItem?.fontName] || {}
          };
        }).filter(row => row.text);
        return sourceDoc === app.pdfDoc ? entry.rows : [];
      })();
      pageAnnotationTextCache.set(pageNum, entry);
      try {
        return await entry.promise;
      } catch (error) {
        if (pageAnnotationTextCache.get(pageNum) === entry) pageAnnotationTextCache.delete(pageNum);
        console.warn('读取注释文字失败:', error);
        return [];
      }
    };

const getAnnotationImportedText = (row, preserveAlias = false) => {
      let value = row.text;
      if (importedTexts.has(row.id) && importedTexts.get(row.id) !== row.text) value = importedTexts.get(row.id);
      else for (const [id, text] of importedTexts) if (id.startsWith(`${row.id}-e-`) && text !== row.text) { value = text; break; }
      // 旧JSON可能把上边线上的前一行也导出进链接。未编辑的旧原文不是一次替换。
      return !preserveAlias && value === row.legacyText ? row.text : value;
    };

const getAnnotationTextOwner = row => {
      const indices = row.sourceItems.map(source => source.index);
      const record = app.mergeRecords.find(record => record.pageNum === row.pageNum &&
        indices.every(index => app.getMergeSourceIndices(record).includes(index)) &&
        (importedTexts.get(record.dataId) ?? record.mergedText) !== (record._initialText ?? record.mergedText));
      if (record) return { id: record.dataId, record };
      // 链接和文字层是同一段原文的两个别名，显式正文替换只绘制一次。
      if (indices.length && row.sourceItems.every(({index,item}) => importedTexts.has(`p${row.pageNum}-${index}`) && importedTexts.get(`p${row.pageNum}-${index}`) !== item.str)) return { id: `p${row.pageNum}-${indices[0]}` };
      return null;
    };

const applyAnnotationImportedTexts = pageNum => {
      let changed = 0;
      app.forEachPageDiv(pageNum, pageDiv => {
        const number = Number(pageDiv.dataset.pageNumber), rows = pageAnnotationTextCache.get(number)?.rows || [];
        const coveredSources = new Set();
        for (const row of rows) {
          const section = [...pageDiv.querySelectorAll('[data-annotation-id]')].find(el => el.getAttribute('data-annotation-id') === row.annotationId);
          if (!section) continue;
          const newText = getAnnotationImportedText(row);
          let label = section.querySelector('.element-json-replacement');
          if (newText === row.text || getAnnotationTextOwner(row)) {
            label?.remove();
            continue;
          }
          row.sourceItems.forEach(({index}) => coveredSources.add(index));
          if (!label) {
            label = document.createElement('span');
            label.className = 'element-json-replacement';
            label.setAttribute('data-id', `${row.id}-replacement`);
            section.appendChild(label);
          }
          if (label.textContent !== newText) changed++;
          const fixed=app.plainReplacementLayoutCache.get(number)?.layouts.get(row.id);
          label.textContent = fixed?.lines?.join('\n') ?? newText;label.dataset.jsonLogicalText=newText;
          app.markTextOverflow(label, fixed);
          const rect = section.getBoundingClientRect(), scale = app.getPageScale(number), item = row.sourceItems[0].item;
          const font = app.getLoadedPdfFont(number, (row.dominantItem || item).fontName), size = (fixed?.fontSize ?? Math.abs(item.transform[3])) * scale;
          const singleLine = fixed?.singleLine ?? (!/[\r\n]/.test(newText) && row.sourceItems.every(source => Math.abs(source.item.transform[5] - item.transform[5]) < Math.abs(item.transform[3]) * .15));
          const family = app.getReplacementFontFamily(newText, row.textStyle.fontFamily || 'serif', font?.name || '', font);
          const width = fixed ? fixed.width*scale : rect.width;
          Object.assign(label.style, {
            position: 'absolute',
            left:fixed?`${fixed.x*scale-rect.left+pageDiv.getBoundingClientRect().left}px`:'0',
            top:fixed?`${fixed.top*scale-rect.top+pageDiv.getBoundingClientRect().top}px`:'0',
            width: `${width}px`,
            height: '100%',
            boxSizing: 'border-box',
            padding: '0',
            color: row.color,
            background: 'transparent',
            zIndex: '1',
            pointerEvents: 'none',
            whiteSpace:'pre',
            overflowWrap: singleLine ? 'normal' : 'anywhere',
            overflow: 'hidden',
            fontFamily: family,
            fontWeight: app.inferFontWeight(font?.name, 'normal'),
            fontStyle: font?.italic || /italic|oblique/i.test(font?.name || '') ? 'italic' : 'normal',
            fontSize: `${size}px`, letterSpacing:`${(fixed?.letterSpacing || 0)*scale}px`, wordSpacing:`${(fixed?.wordSpacing || 0)*scale}px`,
            lineHeight:fixed?`${fixed.lineHeight*scale}px`:'1.15',textAlign:fixed?.alignment||'left'
          });
          label.style.height = `${fixed?fixed.height*scale:rect.height}px`;
        }
        const layer = pageDiv.querySelector('.textLayer');
        for (const el of layer?.querySelectorAll('[data-id]') || []) {
          const record = app.mergeRecords.find(item => item.mergedSpan === el),
            indices = record ? app.getMergeSourceIndices(record) : [Number(el.dataset.sourceIndex)];
          const hidden = indices.length && indices.every(index => coveredSources.has(index));
          if (hidden) {
            if (!el.dataset.elementAliasHidden) el.dataset.elementAliasHidden = JSON.stringify(el.style.visibility || '');
            el.style.visibility = 'hidden';
          } else if (el.dataset.elementAliasHidden) {
            el.style.visibility = JSON.parse(el.dataset.elementAliasHidden);
            delete el.dataset.elementAliasHidden;
          }
        }
        assignPageElementIds(pageDiv, number);
      });
      return changed;
    };

const assignContentDataIds = pageNum => {
      const mergesBySpan = new Map(app.mergeRecords.map(record => [record.mergedSpan, record]));
      app.forEachPageDiv(pageNum, pageDiv => {
        const layer = pageDiv.querySelector('.textLayer');
        const pageNum = pageDiv.getAttribute('data-page-number') || '';
        assignPageElementIds(pageDiv, pageNum);
        if (!layer) return;
        const els = layer.querySelectorAll('*');
        let sourceSeq = 0;
        for (const el of els) {
          // 跳过非内容元素（文本层结束标记、合并覆盖层、框选矩形）
          if (el.classList.contains('endOfContent') || el.classList.contains('edit-cover') || el.classList.contains('merge-select-rect')) continue;
          if (!(el.textContent || '').trim()) continue;
          if (el.classList.contains('is-merged')) {
            const mergeRecord = mergesBySpan.get(el);
            if (mergeRecord) el.setAttribute('data-id', app.ensureMergeDataId(mergeRecord));
            continue;
          }
          if (!isPlainContentElement(el)) continue;
          sourceSeq++;
          if (!el.dataset.sourceIndex) el.dataset.sourceIndex = String(sourceSeq);
          el.setAttribute('data-id', `p${pageNum}-${el.dataset.sourceIndex}`);
        }
        assignPageElementIds(pageDiv, pageNum);
      });
    };

const reconcilePageSourceDataIds = async pageNum => {
      if (!pageNum) return 0;
      const pageDiv = app.getPageDiv(pageNum);
      const layer = pageDiv && pageDiv.querySelector('.textLayer');
      if (!layer) return 0;
      const textContent = await app.getPageTextContent(pageNum);
      if (!textContent?.items) return 0;
      let pdfPage = null;
      try {
        pdfPage = await app.pdfDoc.getPage(pageNum);
      } catch (fontPageErr) {
        console.warn('读取页面字体对象失败:', fontPageErr);
      }
      const removedIndices = app.getPageMergedSourceIndices(pageNum);
      const normalizeSourceText = text => app.cleanTextForMatch(text).replace(/\s+/g, ' ');
      const sourceItems = [];
      let sourceIndex = 0;
      for (const _textItem3 of textContent.items) {
        const sourceText = _textItem3.str || '';
        if (!sourceText.trim()) continue;
        sourceIndex++;
        if (removedIndices.has(sourceIndex)) continue;
        const textStyle = textContent.styles && textContent.styles[_textItem3.fontName];
        sourceItems.push({
          index: sourceIndex,
          text: normalizeSourceText(sourceText),
          fontName: _textItem3.fontName || '',
          ascent: textStyle?.ascent,
          descent: textStyle?.descent,
          fontFamily: textStyle && textStyle.fontFamily ? textStyle.fontFamily : ''
        });
      }
      const sourceByIndex = new Map(sourceItems.map(item => [item.index, item]));
      const candidates = [];
      const all = layer.querySelectorAll('*');
      for (const el of all) {
        if (el.classList.contains('is-merged') || el.classList.contains('endOfContent') || el.classList.contains('edit-cover') || el.classList.contains('merge-select-rect')) continue;
        // 只处理叶子文本元素，避免将 textLayer 内的容器 div 当成额外文本段。
        if (!isPlainContentElement(el)) continue;
        if (!(el.textContent || '').trim()) continue;
        candidates.push(el);
      }
      const used = new Set();
      let cursor = 0;
      let reconciled = 0;
      const findSource = match => {
        const position = sourceItems.findIndex((item, index) => index >= cursor && match(item));
        return position >= 0 ? position : sourceItems.findIndex(match);
      };
      for (const candidate of candidates) {
        const candidateText = normalizeSourceText(candidate.textContent);
        const existingIndex = parseInt(candidate.dataset.sourceIndex, 10);
        const existingItem = sourceByIndex.get(existingIndex);
        const existingId = `p${pageNum}-${existingIndex}`;
        const isImportedValue = existingIndex > 0 && importedTexts.has(existingId) && (candidate.textContent === importedTexts.get(existingId) || candidate.dataset.jsonLogicalText === importedTexts.get(existingId));
        let matchedPos = -1;
        if (existingItem && !used.has(existingIndex) && (existingItem.text === candidateText || isImportedValue)) {
          matchedPos = findSource(item => item.index === existingIndex);
        }
        if (matchedPos < 0) {
          matchedPos = findSource(item => !used.has(item.index) && item.text === candidateText);
        }
        if (matchedPos < 0) continue;
        const matchedIndex = sourceItems[matchedPos].index;
        used.add(matchedIndex);
        cursor = Math.max(cursor, matchedPos + 1);
        candidate.dataset.sourceIndex = String(matchedIndex);
        candidate.setAttribute('data-id', `p${pageNum}-${matchedIndex}`);
        // 记录 PDF.js 已加载的嵌入字体名称，供普通文本替换时复用原字体。
        const matchedSource = sourceItems[matchedPos];
        let loadedFontName = '';
        if (pdfPage && matchedSource.fontName) {
          try {
            const fontObject = pdfPage.commonObjs.get(matchedSource.fontName);
            loadedFontName = fontObject && fontObject.loadedName ? fontObject.loadedName : '';
            candidate.dataset.pdfOriginalFontName = fontObject?.name || '';
            candidate.dataset.pdfFontWeight = app.inferFontWeight(fontObject?.name, getComputedStyle(candidate).fontWeight);
            candidate.dataset.pdfFontStyle = fontObject?.italic || /italic|oblique/i.test(fontObject?.name || '') ? 'italic' : getComputedStyle(candidate).fontStyle;
          } catch (fontObjectErr) {
            // 字体对象尚未进入 commonObjs 时使用 textContent 提供的字体族。
          }
        }
        if (loadedFontName || matchedSource.fontFamily) {
          const escapedLoadedName = loadedFontName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          candidate.dataset.pdfFontFamily = (escapedLoadedName ? `"${escapedLoadedName}", ` : '') + (matchedSource.fontFamily || 'sans-serif');
        }
        candidate.dataset.pdfFontName = matchedSource.fontName;
        if (Number.isFinite(matchedSource.ascent)) candidate.dataset.pdfFontAscent = String(matchedSource.ascent);
        if (Number.isFinite(matchedSource.descent)) candidate.dataset.pdfFontDescent = String(matchedSource.descent);
        reconciled++;
      }
      return reconciled;
    };

const reconcileRenderedSourceDataIds = async () => {
      const pageDivs = app.viewerDiv.querySelectorAll('.page[data-page-number]');
      for (const _pageDiv of pageDivs) {
        const pageNum = parseInt(_pageDiv.getAttribute('data-page-number'), 10);
        if (pageNum > 0) {
          assignContentDataIds(pageNum);
          await reconcilePageSourceDataIds(pageNum);
          if (_pageDiv.querySelector('.textLayer') || _pageDiv.querySelector('.annotationLayer')) await getPageAnnotationTexts(pageNum);
        }
      }
    };

const getSpanIndex = span => {
      const layer = span.closest('.textLayer');
      if (!layer) return -1;
      const spans = layer.querySelectorAll('span');
      return [...spans].indexOf(span);
    };
return {get normalizeImportedSegments(){return normalizeImportedSegments;},
get pageAnnotationTextCache(){return pageAnnotationTextCache;},
get buildJsonSegmentsForPage(){return buildJsonSegmentsForPage;},
get importedTexts(){return importedTexts;},set importedTexts(value){importedTexts=value;},
get jsonImportSequence(){return jsonImportSequence;},set jsonImportSequence(value){jsonImportSequence=value;},
get applyImportedTexts(){return applyImportedTexts;},
get assignPageElementIds(){return assignPageElementIds;},
get isPlainContentElement(){return isPlainContentElement;},
get getPageAnnotationTexts(){return getPageAnnotationTexts;},
get getAnnotationImportedText(){return getAnnotationImportedText;},
get getAnnotationTextOwner(){return getAnnotationTextOwner;},
get applyAnnotationImportedTexts(){return applyAnnotationImportedTexts;},
get assignContentDataIds(){return assignContentDataIds;},
get reconcilePageSourceDataIds(){return reconcilePageSourceDataIds;},
get reconcileRenderedSourceDataIds(){return reconcileRenderedSourceDataIds;},
get getSpanIndex(){return getSpanIndex;}};
}});

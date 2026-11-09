import * as PDFLib from 'pdf-lib'
/** export 功能模块，通过实时app接口访问其他功能。 */
export const PDFExport =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
const PDF_EXPORT_RASTER_SCALE = 2;

const embedCanvasPng = async (pdfLibDoc, canvas, imageCache) => {
      const dataUrl = canvas.toDataURL('image/png');
      if (imageCache && imageCache.has(dataUrl)) return imageCache.get(dataUrl);
      const image = await pdfLibDoc.embedPng(app.dataUrlToUint8Array(dataUrl));
      if (imageCache) imageCache.set(dataUrl, image);
      return image;
    };

const drawPdfVectorLines = (page, font, layout, x, topY, bounds, color = 'rgb(0, 0, 0)') => {
      const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
      const values = hex ? (hex[1].length === 3 ? [...hex[1]].map(value => value + value).join('') : hex[1]).match(/../g).map(value => parseInt(value, 16)) : color.match(/\d+(?:\.\d+)?/g);
      const rgb = (values?.length >= 3 ? values.slice(0, 3) : [0, 0, 0]).map(value => Math.max(0, Math.min(255, Number(value))) / 255);
      // 同一段必须作为一个多行 PDF 文本对象写入。逐行 drawText 会产生多个
      // 相互独立的文本对象，阅读器拖选时容易按内容流顺序跳到邻近旧文字。
      const multilineText = layout.lines.join('\n');
      if (!multilineText) return;
      const letterSpacing=layout.letterSpacing||0, wordSpacing=layout.wordSpacing||0;
      const lineWidth=line=>font.widthOfTextAtSize(line,layout.fontSize)+Math.max(0,[...line].length-1)*letterSpacing+(line.match(/[ \u00a0]/g)||[]).length*wordSpacing;
      const show=(font,text)=>{
        if(!wordSpacing)return PDFLib.showText(font.encodeText(text));
        // Type0/CID fonts do not apply Tw to mapped Unicode spaces. TJ adds the
        // exact word gap while retaining real, selectable space characters.
        const parts=text.split(/([ \u00a0])/).filter(Boolean).flatMap(part=>[font.encodeText(part),...(/^[ \u00a0]$/.test(part)?[PDFLib.PDFNumber.of(-wordSpacing*1000/layout.fontSize)]:[])]);
        return PDFLib.PDFOperator.of('TJ',[page.doc.context.obj(parts)]);
      };
      const baselineY = topY - (layout.baselineOffset ?? font.heightAtSize(layout.fontSize, {
        descender: false
      }));
      // 固定合并框使用真实 PDF 裁剪路径，墨迹也不能超出框外。
      const clipped = layout.clip && bounds;
      if (clipped) page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(bounds.x, bounds.y, bounds.width, bounds.height), PDFLib.clip(), PDFLib.endPath());
      try {
      if (font.originalFonts) {
        const names = new Map(font.originalFonts.map(font => [font, page.node.newFontDictionary('OriginalEditFont', font.originalRef)]));
        const operators = [PDFLib.pushGraphicsState(), PDFLib.beginText(), PDFLib.setTextRenderingMode(0), PDFLib.setCharacterSpacing(letterSpacing), PDFLib.setWordSpacing(0), PDFLib.setCharacterSqueeze(100), PDFLib.setTextRise(0), PDFLib.setFillingRgbColor(...rgb), ...(font.syntheticBold ? [PDFLib.setStrokingRgbColor(...rgb), PDFLib.setLineWidth(font.syntheticStrokeWidth ?? layout.fontSize * .028), PDFLib.setTextRenderingMode(2)] : [])];
        layout.lines.forEach((line, index) => {
          const offset = bounds ? (bounds.width - lineWidth(line)) * (layout.alignment === 'right' ? 1 : layout.alignment === 'center' ? .5 : 0) : 0;
          operators.push(PDFLib.setTextMatrix(1, 0, font.syntheticItalic ? .2 : 0, 1, x + Math.max(0, offset), baselineY - index * layout.lineHeight));
          for (const run of font.runs(line)) operators.push(PDFLib.setFontAndSize(names.get(run.font), layout.fontSize), show(run.font,run.text));
        });
        page.pushOperators(...operators, PDFLib.endText(), PDFLib.popGraphicsState());
        
        return;
      }
      if (font.originalRef || font.ref) {
        const name = page.node.newFontDictionary('OriginalEditFont', font.originalRef || font.ref);
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.beginText(), PDFLib.setCharacterSpacing(letterSpacing),PDFLib.setWordSpacing(0), PDFLib.setFillingRgbColor(...rgb),
          PDFLib.setFontAndSize(name, layout.fontSize), ...(font.syntheticBold ? [PDFLib.setStrokingRgbColor(...rgb), PDFLib.setLineWidth(font.syntheticStrokeWidth ?? layout.fontSize * .028), PDFLib.setTextRenderingMode(2)] : []), PDFLib.setLineHeight(layout.lineHeight),
          PDFLib.setTextMatrix(1, 0, font.syntheticItalic ? .2 : 0, 1, x, baselineY),
          ...layout.lines.flatMap((line, index) => [...(['center','right'].includes(layout.alignment) && bounds ? [PDFLib.setTextMatrix(1, 0, font.syntheticItalic ? .2 : 0, 1, x + Math.max(0, (bounds.width - lineWidth(line)) * (layout.alignment === 'right' ? 1 : .5)), baselineY - index * layout.lineHeight)] : index ? [PDFLib.nextLine()] : []), show(font,line)]),
          PDFLib.endText(), PDFLib.popGraphicsState());
        
        return;
      }
      page.drawText(multilineText, {
        x,
        y: baselineY,
        size: layout.fontSize,
        font,
        lineHeight: layout.lineHeight,
        color: PDFLib.rgb(...rgb)
      });
      } finally { if (clipped) page.pushOperators(PDFLib.popGraphicsState()); }
    };

const downloadBlob = (bytes, filename, mimeType) => {
      const blob = new Blob([bytes], {
        type: mimeType || 'application/pdf'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // 部分浏览器在 click() 返回后才真正开始读取 Blob，延迟释放可避免偶发空文件。
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    };

const getEditedFileName = () => {
      if (!app.currentFileName) return 'edited.pdf';
      const dotIdx = app.currentFileName.lastIndexOf('.');
      const base = dotIdx > 0 ? app.currentFileName.substring(0, dotIdx) : app.currentFileName;
      return `${base}_edited.pdf`;
    };

const drawPlainImportedEdit = async (pdfLibDoc, pages, edit, fontCache, imageCache) => {
      const page = pages[edit.pageNum - 1], item = edit.item;
      const bounds = app.getPlainImportedEditBounds(edit);
      if (!page || !bounds) return false;
      const sourceSize = Math.max(1, Math.hypot(item.transform[0], item.transform[1]), Math.hypot(item.transform[2], item.transform[3]), Math.abs(item.height || 0));
      const size = edit.replacementLayout?.fontSize ?? sourceSize;
      const text = app.normalizePdfVectorText(edit.newText);
      const font = await app.getPdfVectorFont(pdfLibDoc, fontCache, edit.fontFamily, edit.fontWeight, edit.fontStyle, {
        page,
        originalFontName: edit.originalFontName,
        strokeWidth: edit.replacementLayout?.fontStrokeWidthPt,
        text: text + '...'
      });
      if (!app.canEncodePdfVectorText(font, text)) throw new Error(`原字体无法写入替换文字：${edit.dataId}`);
      if (Math.abs(item.transform[1])>.01 || Math.abs(item.transform[2])>.01) {
        const fixed=edit.replacementLayout,layout=app.layoutFixedPdfText(text,font,size,fixed?.lineHeight||size*1.2,fixed?.width??Math.abs(item.width),fixed?.height??font.heightAtSize(size),{singleLine:true,baselineOffset:fixed?.baselineOffset ?? font.heightAtSize(size,{descender:false})});
        if(fixed)Object.assign(layout,fixed);
        page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(...item.transform.slice(0,4).map(value=>value/sourceSize),item.transform[4]+(fixed?.offsetX||0),item.transform[5]-(fixed?.offsetY||0)));
        try{drawPdfVectorLines(page,font,layout,0,layout.baselineOffset,{x:0,y:layout.baselineOffset-layout.height,width:layout.width,height:layout.height},fixed?.color);}finally{page.pushOperators(PDFLib.popGraphicsState());}
        return 'vector';
      }

      const pageWidth = page.getWidth(), pageHeight = page.getHeight();
      const sourceWidth = Math.abs(item.width || bounds.width), sourceX = item.transform[4];
      const singleLine = edit.replacementLayout?.singleLine ?? (!edit.bounds && !/[\r\n]/.test(text));
      const width = edit.replacementLayout?.width ?? (edit.bounds ? bounds.width : Math.max(sourceWidth, font.widthOfTextAtSize(text.replace(/\n/g, ''), size)));
      const centered = !edit.bounds && Math.abs(sourceX + sourceWidth / 2 - pageWidth / 2) < size * .3;
      const x = edit.replacementLayout?.x ?? (edit.bounds ? bounds.x : Math.max(0, Math.min(centered ? sourceX + (sourceWidth - width) / 2 : sourceX, Math.max(0, pageWidth - width))));
      const topY = edit.replacementLayout?.top != null ? pageHeight - edit.replacementLayout.top : edit.bounds ? bounds.y + bounds.height : item.transform[5] + font.heightAtSize(size, {descender: false});
      const lineHeight = edit.replacementLayout?.lineHeight || (edit.bounds ? size * 1.15 : Math.max(size, font.heightAtSize(size)));
      const layout = edit.replacementLayout?.lines ? {
        lines: edit.replacementLayout.lines,
        fontSize: size, letterSpacing:edit.replacementLayout.letterSpacing||0, wordSpacing:edit.replacementLayout.wordSpacing||0,
        lineHeight
      } : singleLine ? {
        lines: [text],
        fontSize: size,
        lineHeight
      } : app.layoutPdfVectorText(text, font, size, lineHeight, width, pageHeight);
      const height = edit.replacementLayout?.fixedBounds ? edit.replacementLayout.height : Math.min(topY, font.heightAtSize(size) + (layout.lines.length - 1) * lineHeight);
      layout.clip = !!edit.replacementLayout?.fixedBounds;
      layout.baselineOffset = edit.replacementLayout?.baselineOffset;
      layout.alignment=edit.replacementLayout?.alignment;
      drawPdfVectorLines(page, font, layout, x, topY, singleLine && !layout.clip ? null : {
        x,
        y: topY - height,
        width,
        height
      }, edit.replacementLayout?.color);
      return 'vector';
    };

// 覆盖源文件的打开动作，让所有导出的PDF从第一页顶部打开。
const setPdfOpenFirstPage = doc => {
      const first=doc.getPages()[0];
      if(!first)return;
      const {x,y,height}=first.getCropBox();
      doc.catalog.set(PDFLib.PDFName.of('OpenAction'),doc.context.obj([first.ref,PDFLib.PDFName.of('XYZ'),x,y+height,null]));
    };

const generateEditedPdf = async (options={}) => {
      const onlyPage=Number.isInteger(options.pageNum)&&options.pageNum>0&&options.pageNum<=app.pdfDoc.numPages?options.pageNum:null;
      await app.prepareImportedFonts();
      if(!options.layoutsPrepared)await app.prepareImportedReplacementLayouts(onlyPage);
      const plainImportedEdits = await app.collectPlainImportedEdits(onlyPage);
      // 合并本身只改变文本层的分段结构，原 PDF 的矢量文字并未发生变化。
      // 因此只把内容真正变化的合并区域写回 PDF，避免把几百个未改区域
      // 截图后重复嵌入，造成文件从几百 KB 膨胀到几十 MB。
      const editedMerges = app.mergeApi.mergeRecords.filter(merge => {
        if(onlyPage&&merge.pageNum!==onlyPage)return false;
        const initialText = merge._initialText == null ? merge.mergedText : merge._initialText;
        return app.fontSettings.enabled || app.regionEditor.has(merge.dataId) || !!merge.replacementFlow || String(merge.mergedText == null ? '' : merge.mergedText) !== String(initialText == null ? '' : initialText);
      });
      if (editedMerges.length === 0 && plainImportedEdits.length === 0) return null;

      const pdfLibDoc = await app.loadEditablePdf();
      const pages = pdfLibDoc.getPages();
      const fontCache = new Map();
      const imageCache = new Map();
      let vectorTextCount = 0;
      let rasterFallbackCount = 0;

      // 先从原内容流中真正移除被替换区域的旧文本对象。若只画白色矩形，
      // 旧文字虽然不可见，仍会参与复制和拖选，并与新文字交叉排序。
      const nativeFlowReplays = new Map(app.fontSettings.enabled ? [] : editedMerges.filter(record=>!app.regionEditor.has(record.dataId)).map(record => [record, app.captureOriginalMergeFlow(pdfLibDoc, pages[record.pageNum - 1], record, fontCache)]));
      // 同样位移的原表格文字批量原样重放，保留字形、字距和字号，避免逐格重排。
      const nativePlainGroups = new Map(), nativePlainReplays = new Map();
      for (const edit of plainImportedEdits) {
        const shift = edit.replacementLayout?.nativeShift, index = Number(/^p\d+-(\d+)$/.exec(edit.dataId)?.[1]);
        if (!shift || !index || edit.newText !== edit.originalText) continue;
        const key = `${edit.pageNum}:${shift.x.toFixed(6)}:${shift.y.toFixed(6)}`;
        if (!nativePlainGroups.has(key)) nativePlainGroups.set(key, {pageNum:edit.pageNum, shift, edits:[], indices:[]});
        const group = nativePlainGroups.get(key);group.edits.push(edit);group.indices.push(index);
      }
      for (const group of nativePlainGroups.values()) {
        const replay = app.captureOriginalMergeFlow(pdfLibDoc, pages[group.pageNum-1], {
          pageNum:group.pageNum, sourceIndices:group.indices, mergedText:'', _initialText:'',
          replacementFlow:{changed:false,x:group.shift.x,recordX:0,originalTop:group.shift.y,top:0}
        }, fontCache);
        if (replay) group.edits.forEach((edit,index) => nativePlainReplays.set(edit,index ? '' : replay));
      }
      const textRemovalBoxesByPage = new Map();
      const addTextRemovalBox = (pageNum, box) => {
        if (!box || !(box.width > 0) || !(box.height > 0)) return;
        if (!textRemovalBoxesByPage.has(pageNum)) textRemovalBoxesByPage.set(pageNum, []);
        textRemovalBoxesByPage.get(pageNum).push(box);
      };
      for (const removalMerge of editedMerges) {
        const removalPage = pages[removalMerge.pageNum - 1];
        if (!removalPage) continue;
        const removalPageHeight = removalPage.getSize().height;
        const removalMergeHeight = removalMerge.heightPt || removalMerge.fontSizePt * 1.3;
        await app.getPageTextContent(removalMerge.pageNum);
        const sourceBoxes = app.getOriginalSourceBoxes(removalMerge.pageNum, app.mergeApi.getMergeSourceIndices(removalMerge));
        if (sourceBoxes.length) {
          for (const box of sourceBoxes) addTextRemovalBox(removalMerge.pageNum, box);
          continue;
        }
        addTextRemovalBox(removalMerge.pageNum, {
          x: removalMerge.leftPt,
          y: removalPageHeight - removalMerge.topPt - removalMergeHeight,
          width: removalMerge.widthPt,
          height: removalMergeHeight + app.mergeApi.MERGE_COVER_TOP_OVERLAP_PT
        });
      }
      for (const _edit of plainImportedEdits) {
        addTextRemovalBox(_edit.pageNum, app.getPlainImportedEditBounds(_edit));
      }
      let removedOriginalTextCount = 0;
      textRemovalBoxesByPage.forEach((boxes, pageNum) => {
        const removalTargetPage = pages[pageNum - 1];
        if (removalTargetPage) {
          removedOriginalTextCount += app.removeUnderlyingPdfText(pdfLibDoc, removalTargetPage, boxes, fontCache);
          app.moveReplacementClosingRules(pdfLibDoc, removalTargetPage, pageNum);
        }
      });
      if (!removedOriginalTextCount) {
        console.warn('未识别到可安全移除的底层文本对象。');
      }

      // 处理合并记录
      let drawnMerges=0;
      for (const merge of editedMerges) {
        if(drawnMerges++%16===0)await app.yieldPdfUi();
        if (nativeFlowReplays.get(merge)) { app.appendOriginalTextFlow(pdfLibDoc, pages[merge.pageNum - 1], nativeFlowReplays.get(merge));vectorTextCount++;continue; }
        const page = pages[merge.pageNum - 1];
        if (!page) continue;
        const {
          height: pageHeight
        } = page.getSize();
        let mergeHeightPt = merge.replacementHeightPt || merge.heightPt || merge.fontSizePt * 1.3;
        let renderTopPt = merge.replacementTopPt ?? merge.topPt;
        let yPt = pageHeight - renderTopPt - mergeHeightPt;

        // 绘制合并后的文字（支持多行换行）
        // 替换后的文字保留原字号和字形，按内容换行。
        const isImportedText = merge.fitScale !== undefined;
        const fitScale = 1;
        const cssFontSize = (merge.cssFontSize || 12) * fitScale;
        const fontFamily = merge.importedFontFamily || merge.fontFamily || '"Microsoft YaHei", "SimSun", sans-serif';
        const fontStr = `${merge.fontWeight || 'normal'} ${cssFontSize}px ${fontFamily}`;
        const viewerScale = (merge.cssFontSize || 12) / merge.fontSizePt;
        const lineHeightCSS = merge.lineHeightPt * viewerScale * fitScale;

        // 优先写入真正的 PDF 文本对象，使修改内容可以选择、复制和搜索。
        try {
          const vectorFont = await app.getPdfVectorFont(pdfLibDoc, fontCache, fontFamily, app.inferFontWeight(merge.originalFontName, merge.fontWeight), merge.fontStyle || 'normal', {
            page,
            originalFontName: merge.replacementFontName || merge.originalFontName, strokeWidth: merge.fontStrokeWidthPt, text: merge.mergedText + '...'
          });
          const vectorText = app.normalizePdfVectorText(merge.mergedText);
          if (app.canEncodePdfVectorText(vectorFont, vectorText)) {
            const preferredFontSizePt = merge.fontSizePt * fitScale;
            let preferredLineHeightPt = merge.lineHeightPt * fitScale;
            const vectorLayout = merge.replacementFixed ? {...merge.replacementFixed} : app.layoutFixedPdfText(vectorText, vectorFont, preferredFontSizePt, preferredLineHeightPt, merge.widthPt, merge.heightPt);
            vectorLayout.alignment = merge.replacementFixed?.alignment || merge.textAlign || 'left';
            renderTopPt = vectorLayout.top ?? merge.topPt;mergeHeightPt = vectorLayout.height;
            yPt = pageHeight - renderTopPt - mergeHeightPt;
            drawPdfVectorLines(page, vectorFont, vectorLayout, vectorLayout.x ?? merge.leftPt, pageHeight - renderTopPt, {
              x: vectorLayout.x ?? merge.leftPt, y: pageHeight-renderTopPt-vectorLayout.height, width: vectorLayout.width, height: vectorLayout.height
            }, merge.fontColor);
            vectorTextCount++;
            continue;
          }
          throw new Error(`无法写入 ${merge.dataId} 的文字字符。`);
        } catch (vectorErr) {
          throw vectorErr;
        }

        // 特殊 Unicode 字符无法由 PDF 标准字体编码时，保留 Canvas 兼容回退。
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const dpr = PDF_EXPORT_RASTER_SCALE;
          const mergeScaleX = isImportedText ? 1 : merge.scaleX || 1;
          // 内容宽度 = 框选宽度 / scaleX（因为 scaleX 会拉伸内容）
          const cssW = merge.widthPt / mergeScaleX * viewerScale;
          const cssH = mergeHeightPt * viewerScale;
          canvas.width = Math.ceil(cssW * dpr);
          canvas.height = Math.ceil(cssH * dpr);
          ctx.scale(dpr, dpr);

          // 透明兼容层保留原始页面底色。
          ctx.clearRect(0, 0, cssW, cssH);

          // 英文优先按单词、中文按单字换行，避免英文单词被截断且兼容无空格中文。
          ctx.font = fontStr;
          ctx.fillStyle = '#000000';
          ctx.textBaseline = 'top';
          const tokens = app.mergeApi.tokenizeTextForWrap(merge.mergedText);
          let line = '';
          let lineY = 2;
          for (const _token3 of tokens) {
            if (!_token3) continue;
            const testLine = line + _token3;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > cssW - 4 && line !== '') {
              ctx.fillText(line.trimStart(), 2, lineY);
              line = _token3;
              lineY += lineHeightCSS;
              if (lineY + cssFontSize > cssH) break;
            } else {
              line = testLine;
            }
          }
          if (line && lineY + cssFontSize <= cssH) {
            ctx.fillText(line.trimStart(), 2, lineY);
          }
          const pngImage = await embedCanvasPng(pdfLibDoc, canvas, imageCache);
          page.drawImage(pngImage, {
            x: merge.leftPt,
            y: yPt,
            width: merge.widthPt,
            height: merge.heightPt
          });
          rasterFallbackCount++;
        } catch (err) {
          console.warn('合并文字 Canvas 渲染失败:', err);
        }
      }

      // 处理未合并但由 JSON 按 data-id 修改的普通文本。
      let plainEditCount = 0;
      for (const [editIndex,_edit2] of plainImportedEdits.entries()) {
        if(editIndex%32===0)await app.yieldPdfUi();
        if (nativePlainReplays.has(_edit2)) {
          app.appendOriginalTextFlow(pdfLibDoc, pages[_edit2.pageNum-1], nativePlainReplays.get(_edit2));
          plainEditCount++;vectorTextCount++;continue;
        }
        const plainEditResult = await drawPlainImportedEdit(pdfLibDoc, pages, _edit2, fontCache, imageCache);
        if (plainEditResult) {
          plainEditCount++;
          if (plainEditResult === 'vector') vectorTextCount++;
          if (plainEditResult === 'raster') rasterFallbackCount++;
        }
      }

      pdfLibDoc.setProducer('PDF Viewer');
      setPdfOpenFirstPage(pdfLibDoc);
      let outputDoc=pdfLibDoc;
      if(options.preview&&onlyPage){
        // 编辑预览只序列化这一页，完整文档仍在导出时按原顺序生成。
        outputDoc=await PDFLib.PDFDocument.create();
        const [page]=await outputDoc.copyPages(pdfLibDoc,[onlyPage-1]);outputDoc.addPage(page);
      }
      // 对象流可压缩新增的页面指令和资源索引；不影响 PDF 阅读器兼容性。
      return {
        bytes: await outputDoc.save({
          useObjectStreams: true
        }),
        previewPage:options.preview&&onlyPage?onlyPage:null,
        changedPages:[...new Set([...editedMerges.map(record=>record.pageNum),...plainImportedEdits.map(edit=>edit.pageNum)])],
        modificationCount: editedMerges.length + plainEditCount,
        vectorTextCount,
        rasterFallbackCount
      };
    };

app.downloadBtn.addEventListener('click', async () => {
      if (!app.pdfDoc) {
        app.setStatus('⚠️ 请先加载 PDF 文件');
        return;
      }
      if (app.mergeApi.smartMerge.running) {
        app.setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      if(app.jsonFileInput.dataset.importing){
        app.setStatus('📥 JSON 正在导入，请稍候…');
        return;
      }
      try {
        const sourceDoc=app.pdfDoc;
        app.setStatus('📦 正在生成 PDF...');
        if (app.mergeApi.mergeRecords.length > 0 || app.importedTexts.size > 0 || app.fontSettings.enabled || app.regionEditor.size) {
          const preview=await app.buildImportedBackground();
          if(sourceDoc!==app.pdfDoc)return;
          if(!preview){app.setStatus('页面内容正在更新，请稍后导出');return;}
          const editedPdfResult=preview?.result;
          if (editedPdfResult) {
            app.downloadBlob(editedPdfResult.bytes, app.getEditedFileName());
            let exportStatus = `✅ 已下载修改后的 PDF · ${editedPdfResult.vectorTextCount} 处可复制文本`;
            if (editedPdfResult.rasterFallbackCount > 0) {
              exportStatus += ` · ${editedPdfResult.rasterFallbackCount} 处特殊字符使用兼容图像`;
            }
            app.setStatus(exportStatus);
            return;
          }
        }

        // 内容未修改时也设置打开位置，避免继承原PDF指向后续页的打开动作。
        const doc=await app.loadEditablePdf();
        setPdfOpenFirstPage(doc);
        const bytes=await doc.save({useObjectStreams:true});
        if(sourceDoc!==app.pdfDoc)return;
        app.downloadBlob(bytes, app.currentFileName || 'document.pdf');
        app.setStatus('✅ 已下载 PDF');
      } catch (err) {
        console.error('下载失败:', err);
        app.setStatus(`❌ 下载失败: ${err.message || '未知错误'}`);
      }
    });
return {get setPdfOpenFirstPage(){return setPdfOpenFirstPage;},get PDF_EXPORT_RASTER_SCALE(){return PDF_EXPORT_RASTER_SCALE;},
get embedCanvasPng(){return embedCanvasPng;},
get drawPdfVectorLines(){return drawPdfVectorLines;},
get downloadBlob(){return downloadBlob;},
get getEditedFileName(){return getEditedFileName;},
get drawPlainImportedEdit(){return drawPlainImportedEdit;},
get generateEditedPdf(){return generateEditedPdf;}};
}});

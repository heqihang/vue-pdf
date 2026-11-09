import * as PDFLib from 'pdf-lib'
import { pdfjsLib } from '@/services/pdf-runtime.js'
/** content 功能模块，通过实时app接口访问其他功能。 */
export const PDFContent =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
const pageTextContentCache = new Map();

const pageSourceCoverCache = new Map();

const pageTextItemCache = new Map();

const pageSourceAppearanceCache = new Map();

const getPageSourceAppearances = async pageNum => {
      if (!pageSourceAppearanceCache.has(pageNum)) pageSourceAppearanceCache.set(pageNum, (async () => {
        const content = await getPageTextContent(pageNum), page = await app.pdfDoc.getPage(pageNum), ops = await page.getOperatorList(), names = pdfjsLib.OPS;
        const items = content.items.filter(item => item.str?.trim()), result = new Map(), stack = [];
        let state = { matrix: [1, 0, 0, 1, 0, 0], text: [1, 0, 0, 1, 0, 0], line: [1, 0, 0, 1, 0, 0], rgb: [0, 0, 0], font: '', size: 10, spacing: 0, wordSpacing: 0, scale: 1, leading: 0, rise: 0, renderMode: 0, strokeWidth: 0 };
        const move = (x, y) => { state.line = app.multiplyPdfMatrix(state.line, [1, 0, 0, 1, x, y]);state.text = state.line.slice(); };
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i], args = ops.argsArray[i];
          if (fn === names.save) stack.push({ ...state, matrix: state.matrix.slice(), text: state.text.slice(), line: state.line.slice(), rgb: state.rgb.slice() });
          else if (fn === names.restore) state = stack.pop() || state;
          else if (fn === names.transform) state.matrix = app.multiplyPdfMatrix(state.matrix, args);
          else if (fn === names.setFillRGBColor) state.rgb = Array.from(args).slice(0, 3);
          else if (fn === names.beginText) state.text = state.line = [1, 0, 0, 1, 0, 0];
          else if (fn === names.setTextMatrix) state.text = state.line = Array.from(args);
          else if (fn === names.setFont) [state.font, state.size] = args;
          else if (fn === names.setCharSpacing) state.spacing = args[0];
          else if (fn === names.setWordSpacing) state.wordSpacing = args[0];
          else if (fn === names.setHScale) state.scale = args[0] / 100;
          else if (fn === names.setLeading) state.leading = args[0];
          else if (fn === names.setTextRise) state.rise = args[0];
          else if (fn === names.setTextRenderingMode) state.renderMode = args[0];
          else if (fn === names.setLineWidth) state.strokeWidth = args[0];
          else if (fn === names.moveText) move(args[0], args[1]);
          else if (fn === names.setLeadingMoveText) { state.leading = -args[1];move(args[0], args[1]); }
          else if (fn === names.nextLine) move(0, -state.leading);
          else if (fn === names.showText) {
            let advance = 0;
            for (const glyph of args[0]) {
              if (typeof glyph === 'number') { advance -= glyph * state.size * state.scale / 1000;continue; }
              if (!glyph) continue;
              const matrix = app.multiplyPdfMatrix(state.matrix, state.text), x = matrix[4] + matrix[0] * advance + matrix[2] * state.rise, y = matrix[5] + matrix[1] * advance + matrix[3] * state.rise;
              const index = items.findIndex(item => item.fontName === state.font && Math.abs(item.transform[5] - y) < Math.abs(item.transform[3]) * .2 && x >= item.transform[4] - .2 && x < item.transform[4] + item.width - .1);
              if (index >= 0 && !result.has(index + 1)) result.set(index + 1, { rgb: state.rgb.slice(), color: `rgb(${state.rgb.join(', ')})`, fontWeight: state.renderMode === 2 && state.strokeWidth > 0 ? 'bold' : undefined, strokeWidth: state.renderMode === 2 ? state.strokeWidth : undefined });
              advance += ((glyph.width || 0) * state.size / 1000 + state.spacing + (glyph.isSpace ? state.wordSpacing : 0)) * state.scale;
            }
            state.text = app.multiplyPdfMatrix(state.text, [1, 0, 0, 1, advance, 0]);
          }
        }
        return result;
      })());
      return pageSourceAppearanceCache.get(pageNum);
    };

let importedBackgroundVersion = 0;

let importedBackgroundPromise = null;

let importedBackgroundLoadingTask = null;

const importedBackgroundRenders = new Map();

const importedBackgroundTouchedPages = new Set();
const pageBackgrounds=new Map();

// 让耗时排版分批让出主线程，不依赖可见标签页的动画帧。
const yieldPdfUi=()=>new Promise(resolve=>{
      if(typeof MessageChannel==='function'){
        const channel=new MessageChannel();
        channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};
        channel.port2.postMessage(0);
      }else setTimeout(resolve,0);
    });
const beginImportedPreviewUpdate=pageNum=>{
      if(!app.pdfDoc)return;
      app.forEachPageDiv(pageNum,pageDiv=>{pageDiv.dataset.pdfPreviewPending=String(importedBackgroundVersion);});
    };

const discardPageBackground = number => {
      const entry=pageBackgrounds.get(number);pageBackgrounds.delete(number);
      entry?.task?.destroy().catch(()=>{});
    };
const invalidateImportedBackground = pageNum => {
      importedBackgroundVersion++;
      const scoped=Number.isInteger(pageNum)&&pageNum>0;
      if(scoped){
        // 移动和拉伸没有改变字符及字体；保留昂贵的字体解析和其他页排版。
        app.plainReplacementLayoutCache.delete(pageNum);importedBackgroundRenders.delete(pageNum);
        discardPageBackground(pageNum);
      }else{
        app.replacementMetricDocument=null;app.replacementMetricFonts.clear();app.replacementSubsetCorpus=null;
        app.plainReplacementLayoutCache.clear();importedBackgroundRenders.clear();
        for(const number of pageBackgrounds.keys())discardPageBackground(number);
      }
      importedBackgroundPromise=null;
      importedBackgroundLoadingTask?.destroy().catch(()=>{});importedBackgroundLoadingTask=null;
    };

const buildImportedBackground = () => {
      if (importedBackgroundPromise) return importedBackgroundPromise;
      const sourceDoc = app.pdfDoc, version = importedBackgroundVersion;
      importedBackgroundPromise = (async () => {
        // 预览直接渲染与下载相同的矢量PDF；DOM仅保留选择、data-id和边框。
        const result=await app.generateEditedPdf();
        if(version!==importedBackgroundVersion||sourceDoc!==app.pdfDoc)return null;
        if(!result)return {doc:sourceDoc,pages:new Set(),result:null};
        const changedPages=new Set(result.changedPages||(await app.collectPlainImportedEdits()).map(edit=>edit.pageNum));
        if(!result.changedPages)for(const record of app.mergeRecords)if(app.fontSettings.enabled||app.regionEditor.has(record.dataId)||record.replacementFlow||record.mergedText!==(record._initialText??record.mergedText))changedPages.add(record.pageNum);
        // PDF.js会将输入缓冲区移交给Worker；复制一份，保留下载用的原始字节。
        const bytes=result.bytes.slice();
        if (version !== importedBackgroundVersion || sourceDoc !== app.pdfDoc) return null;
        const task = pdfjsLib.getDocument({
          data: bytes,
          cMapUrl: `${app.pdfResourceBase}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${app.pdfResourceBase}standard_fonts/`
        });
        importedBackgroundLoadingTask = task;
        const backgroundDoc = await task.promise;
        if (version !== importedBackgroundVersion || sourceDoc !== app.pdfDoc) {
          await task.destroy();
          return null;
        }
        return {doc: backgroundDoc, pages: changedPages, result};
      })().catch(error=>{
        if(version===importedBackgroundVersion&&sourceDoc===app.pdfDoc)importedBackgroundPromise=null;
        throw error;
      });
      return importedBackgroundPromise;
    };

// 单页任务合并：同一页重复请求共享生成结果，不重复解析、嵌字或启动Worker。
const buildImportedPageBackground = (pageNum,options={}) => {
      if(importedBackgroundPromise)return importedBackgroundPromise;
      const cached=pageBackgrounds.get(pageNum);
      if(cached?.source===app.pdfDoc){cached.users++;return cached.promise;}
      const entry={source:app.pdfDoc,task:null,promise:null,users:1};pageBackgrounds.set(pageNum,entry);
      entry.promise=(async()=>{
        const result=await app.generateEditedPdf({pageNum,preview:true,layoutsPrepared:!!options.layoutsPrepared});
        if(entry.source!==app.pdfDoc||pageBackgrounds.get(pageNum)!==entry)return null;
        if(!result)return {doc:entry.source,pages:new Set(),result:null,entry};
        entry.task=pdfjsLib.getDocument({data:result.bytes.slice(),cMapUrl:`${app.pdfResourceBase}cmaps/`,cMapPacked:true,standardFontDataUrl:`${app.pdfResourceBase}standard_fonts/`});
        const doc=await entry.task.promise;
        if(entry.source!==app.pdfDoc||pageBackgrounds.get(pageNum)!==entry){await entry.task.destroy();return null;}
        return {doc,pages:new Set([pageNum]),result,pageIndex:1,entry};
      })().catch(error=>{if(pageBackgrounds.get(pageNum)===entry)discardPageBackground(pageNum);throw error;});
      return entry.promise;
    };

const refreshImportedPageBackgrounds = async (pageNum,options={}) => {
      if (!app.pdfDoc || typeof pdfjsLib.getDocument !== 'function') return;
      const sourceDoc=app.pdfDoc,version=importedBackgroundVersion;
      const background=await (pageNum?buildImportedPageBackground(pageNum,options):buildImportedBackground());
      try{
      if(!background||version!==importedBackgroundVersion||sourceDoc!==app.pdfDoc)return;
      const pageDivs=[];
      app.forEachPageDiv(pageNum,pageDiv=>pageDivs.push(pageDiv));
      const currentPage=app.pdfViewer?.currentPageNumber||pageNum||1;
      pageDivs.sort((a,b)=>Math.abs(Number(a.dataset.pageNumber)-currentPage)-Math.abs(Number(b.dataset.pageNumber)-currentPage));
      const clearPending=pageDiv=>{if(pageDiv.dataset.pdfPreviewPending===String(version))delete pageDiv.dataset.pdfPreviewPending;};
      // 当前页优先，每批最多绘制两页，避免离屏页面挤占绘制资源。
      for(let offset=0;offset<pageDivs.length;offset+=2){
        if(version!==importedBackgroundVersion||sourceDoc!==app.pdfDoc)return;
        const tasks=[];
        for(const pageDiv of pageDivs.slice(offset,offset+2)){
          const number=Number(pageDiv.dataset.pageNumber);
          if(!background.pages.has(number)&&!importedBackgroundTouchedPages.has(number)){clearPending(pageDiv);continue;}
          const view=app.pdfViewer?.getPageView(number-1),canvas=view?.canvas||pageDiv.querySelector('.canvasWrapper canvas');
          if(!canvas||!view?.viewport||!canvas.width||!canvas.height)continue;
          const key=`${version}:${canvas.width}:${canvas.height}:${view.viewport.scale}:${view.viewport.rotation}`;
          const prior=importedBackgroundRenders.get(number);
          if(prior?.canvas===canvas&&prior.key===key){
            tasks.push(prior.promise.then(()=>{if(version===importedBackgroundVersion&&sourceDoc===app.pdfDoc)clearPending(pageDiv);}));
            continue;
          }
          pageDiv.dataset.pdfPreviewPending=String(version);
          const render={canvas,key};
          render.promise=(async()=>{
            const page=await(background.pages.has(number)?background.doc:sourceDoc).getPage(background.pages.has(number)?background.pageIndex||number:number);
            const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
            const viewport=view.viewport.clone(),releaseFrames=app.smartMerge.enableMergeFrameScheduler();
            try{
              await page.render({canvasContext:copy.getContext('2d'),viewport,
                transform:[copy.width/viewport.width,0,0,copy.height/viewport.height,0,0],
                annotationMode:pdfjsLib.AnnotationMode.ENABLE_FORMS}).promise;
            }finally{releaseFrames();}
            if(version!==importedBackgroundVersion||sourceDoc!==app.pdfDoc||view.viewport.scale!==viewport.scale||view.viewport.rotation!==viewport.rotation||view.canvas&&view.canvas!==canvas||canvas.width!==copy.width||canvas.height!==copy.height)return;
            // 同一个同步任务里交换底图和文字层可见状态，中间不会绘制双语叠影。
            const context=canvas.getContext('2d');context.save();context.setTransform(1,0,0,1,0,0);
            context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(copy,0,0);context.restore();
            if(background.pages.has(number))pageDiv.dataset.pdfPreview='1';else delete pageDiv.dataset.pdfPreview;
            importedBackgroundTouchedPages.add(number);clearPending(pageDiv);
          })().catch(error=>{if(importedBackgroundRenders.get(number)===render)importedBackgroundRenders.delete(number);throw error;});
          importedBackgroundRenders.set(number,render);tasks.push(render.promise);
        }
        await Promise.all(tasks);
        if(offset+2<pageDivs.length)await yieldPdfUi();
      }
      }finally{
        if(background?.entry)background.entry.users--;
        // 正在生成或绘制的单页不能淘汰；空闲后保留最多三页，限制Worker占用。
        for(const [number,entry]of pageBackgrounds)if(pageBackgrounds.size>3&&entry.users===0)discardPageBackground(number);
      }
    };

const loadEditablePdf = async () => {
      const sourceDoc = app.pdfDoc, doc = await PDFLib.PDFDocument.load(app.pdfBuffer || await sourceDoc.getData());
      for (const [index, page] of doc.getPages().entries()) {
        try { const size = page.getSize();if (!(size.width > 0 && size.height > 0)) throw new Error('Invalid page box'); }
        catch { const original = await sourceDoc.getPage(index + 1), [left, bottom, right, top] = original.view;page.setMediaBox(left, bottom, right - left, top - bottom);page.setCropBox(left, bottom, right - left, top - bottom); }
      }
      return doc;
    };

const getOriginalSourceBoxes = (pageNum, indices) => indices.map(index => pageSourceCoverCache.get(pageNum)?.get(index)).filter(Boolean);

const getPageTextContent = async pageNum => {
      if (!app.pdfDoc || !pageNum) return null;
      if (!pageTextContentCache.has(pageNum)) {
        pageTextContentCache.set(pageNum, app.pdfDoc.getPage(pageNum).then(async page => {
          const content = await page.getTextContent();
          const boxes = new Map();
          let index = 0;
          for (const item of content.items) {
            if (!item.str?.trim()) continue;
            const box = app.getPlainImportedEditBounds({item, textStyle: content.styles[item.fontName] || {}});
            if (box) boxes.set(++index, {...box,sourceTransform:item.transform});
            else index++;
          }
          pageSourceCoverCache.set(pageNum, boxes);
          return content;
        }).catch(err => {
          console.warn('读取 PDF 文本字体信息失败:', err);
          pageTextContentCache.delete(pageNum);
          pageSourceCoverCache.delete(pageNum);
          return null;
        }));
      }
      return pageTextContentCache.get(pageNum);
    };

const findTextContentItemForSpan = (textContent, span, spanIndex, pageNum) => {
      if (!textContent?.items) return null;
      let cached = pageTextItemCache.get(pageNum);
      if (!cached || cached.textContent !== textContent) {
        const cachedItems = textContent.items.filter(item => item && typeof item.str === 'string');
        cached = {
          textContent,
          items: cachedItems,
          normalizedTexts: cachedItems.map(item => app.cleanTextForMatch(item.str))
        };
        pageTextItemCache.set(pageNum, cached);
      }
      const items = cached.items;
      const normalizedTexts = cached.normalizedTexts;
      const spanText = app.cleanTextForMatch(span.textContent);
      if (items[spanIndex] && (!spanText || normalizedTexts[spanIndex] === spanText)) {
        return items[spanIndex];
      }
      for (let offset = 1; offset <= 5; offset++) {
        const before = items[spanIndex - offset];
        if (before && normalizedTexts[spanIndex - offset] === spanText) return before;
        const after = items[spanIndex + offset];
        if (after && normalizedTexts[spanIndex + offset] === spanText) return after;
      }
      for (let i = 0; i < items.length; i++) {
        if (normalizedTexts[i] === spanText) return items[i];
      }
      return items[spanIndex] || null;
    };

const dataUrlToUint8Array = dataUrl => {
      const base64 = dataUrl.split(',')[1];
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    };

const pdfBytesToBinaryString = bytes => {
      const parts = [];
      for (let i = 0; i < bytes.length; i += 32768) {
        parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
      }
      return parts.join('');
    };

const pdfBinaryStringToBytes = text => {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
      return bytes;
    };

const decodePdfStringBytes = value => {
      if (value[0] === '<') {
        let hex = value.slice(1, -1).replace(/\s/g, '');
        if (hex.length % 2) hex += '0';
        return Uint8Array.from(hex.match(/../g) || [], byte => parseInt(byte, 16));
      }
      const bytes = [];
      for (let i = 1; i < value.length - 1; i++) {
        let char = value[i];
        if (char === '\\') {
          char = value[++i];
          if (char === '\r' || char === '\n') {
            if (char === '\r' && value[i + 1] === '\n') i++;
            continue;
          }
          const escaped = {n: 10, r: 13, t: 9, b: 8, f: 12}[char];
          if (escaped != null) {
            bytes.push(escaped);
            continue;
          }
          if (/[0-7]/.test(char)) {
            let octal = char;
            while (octal.length < 3 && /[0-7]/.test(value[i + 1] || 'x')) octal += value[++i];
            bytes.push(parseInt(octal, 8) & 255);
            continue;
          }
        }
        bytes.push(char.charCodeAt(0) & 255);
      }
      return Uint8Array.from(bytes);
    };

const scanPdfContentTokens = source => {
      const tokens = [];
      let i = 0;
      const length = source.length;
      const isWhite = ch => ch === 0 || ch === 9 || ch === 10 || ch === 12 || ch === 13 || ch === 32;
      const isDelimiter = ch => isWhite(ch) || ch === 37 || ch === 40 || ch === 41 || ch === 47 || ch === 60 || ch === 62 || ch === 91 || ch === 93 || ch === 123 || ch === 125;
      while (i < length) {
        const code = source.charCodeAt(i);
        if (isWhite(code)) {
          i++;
          continue;
        }
        if (code === 37) {
          // % comment
          while (i < length && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) i++;
          continue;
        }
        const start = i;
        if (code === 40) {
          // (...) literal string, supports nesting and escapes
          let depth = 1;
          i++;
          while (i < length && depth > 0) {
            const c = source.charCodeAt(i++);
            if (c === 92) {
              i++;
              continue;
            }
            if (c === 40) depth++;
            if (c === 41) depth--;
          }
          tokens.push({
            type: 'string',
            value: source.slice(start, i),
            start,
            end: i
          });
          continue;
        }
        if (code === 60 && source.charCodeAt(i + 1) !== 60) {
          // <...> hex string
          i++;
          while (i < length && source.charCodeAt(i) !== 62) i++;
          if (i < length) i++;
          tokens.push({
            type: 'string',
            value: source.slice(start, i),
            start,
            end: i
          });
          continue;
        }
        if (code === 47) {
          // /Name
          i++;
          while (i < length && !isDelimiter(source.charCodeAt(i))) i++;
          tokens.push({
            type: 'name',
            value: source.slice(start, i),
            start,
            end: i
          });
          continue;
        }
        if (code === 60 && source.charCodeAt(i + 1) === 60 || code === 62 && source.charCodeAt(i + 1) === 62) {
          i += 2;
          tokens.push({
            type: 'delimiter',
            value: source.slice(start, i),
            start,
            end: i
          });
          continue;
        }
        if (code === 91 || code === 93 || code === 123 || code === 125) {
          i++;
          tokens.push({
            type: 'delimiter',
            value: source.slice(start, i),
            start,
            end: i
          });
          continue;
        }
        while (i < length && !isDelimiter(source.charCodeAt(i))) i++;
        const value = source.slice(start, i);
        const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
        tokens.push({
          type: numeric ? 'number' : 'word',
          value,
          number: numeric ? Number(value) : NaN,
          start,
          end: i
        });
      }
      return tokens;
    };

const multiplyPdfMatrix = (left, right) => [left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1], left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3], left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5]];

const formatPdfNumber=value=>PDFLib.PDFNumber.of(Math.abs(value)<1e-8?0:value).toString();

const isPdfPointInsideAnyBox = (x, y, boxes) => {
      const tolerance = 2.5;
      for (const box of boxes) {
        const left = box.sourceLeft ?? box.x - tolerance, right = box.sourceRight ?? box.x + box.width + tolerance;
        const baseline=box.sourceBaseline??(box.sourceTransform&&Math.abs(box.sourceTransform[1])<.01&&Math.abs(box.sourceTransform[2])<.01?box.sourceTransform[5]:null),vertical=baseline!=null?Math.abs(y-baseline)<=(box.sourceBaselineTolerance??Math.max(.5,Math.abs(box.sourceTransform[3])*.15)):y>=box.y-tolerance&&y<=box.y+box.height+tolerance;
        if (x >= left && x < right && vertical) return true;
      }
      return false;
    };

const removeCoveredTextBlocksFromStream = (source, boxes, fonts = new Map(), capture = false) => {
      const tokens = scanPdfContentTokens(source);
      if (tokens.some(token => token.type === 'word' && token.value === 'BI')) return { source, removed: 0 };
      let operands = [], matrix = [1, 0, 0, 1, 0, 0], textMatrix = matrix.slice(), lineMatrix = matrix.slice();
      let inText = false, leading = 0, currentPositionKnown = true;
      let fontName = '', fontSize = 0, horizontalScale = 1, charSpacing = 0, wordSpacing = 0;
      let fill = '0 g', stroke = '0 G', renderMode = 0, strokeWidth = 1, rise = 0;
      const stack = [], ranges = [];
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.type !== 'word') { operands.push(token); continue; }
        const op = token.value, nums = operands.filter(item => item.type === 'number').map(item => item.number);
        if (op === 'q') stack.push({ matrix: matrix.slice(), fontName, fontSize, horizontalScale, charSpacing, wordSpacing, leading, fill, stroke, renderMode, strokeWidth, rise });
        else if (op === 'Q') { const saved = stack.pop();if (saved) ({ matrix, fontName, fontSize, horizontalScale, charSpacing, wordSpacing, leading, fill, stroke, renderMode, strokeWidth, rise } = saved); }
        else if (op === 'cm' && nums.length >= 6) matrix = multiplyPdfMatrix(matrix, nums.slice(-6));
        else if (['g', 'rg', 'k'].includes(op)) fill = `${nums.join(' ')} ${op}`;
        else if (['G', 'RG', 'K'].includes(op)) stroke = `${nums.join(' ')} ${op}`;
        else if (op === 'w') strokeWidth = nums.at(-1) ?? 1;
        else if (op === 'BT') {
          inText = true; textMatrix = lineMatrix = [1, 0, 0, 1, 0, 0]; currentPositionKnown = true;
        } else if (op === 'ET') inText = false;
        else if (inText && op === 'Tm' && nums.length >= 6) {
          textMatrix = lineMatrix = nums.slice(-6); currentPositionKnown = true;
        } else if (inText && (op === 'Td' || op === 'TD') && nums.length >= 2) {
          const [x, y] = nums.slice(-2);
          if (op === 'TD') leading = -y;
          lineMatrix = multiplyPdfMatrix(lineMatrix, [1, 0, 0, 1, x, y]);
          textMatrix = lineMatrix.slice(); currentPositionKnown = true;
        } else if (inText && op === 'TL') leading = nums.at(-1) || 0;
        else if (inText && op === 'Tf') { fontName = operands.find(item => item.type === 'name')?.value || ''; fontSize = nums.at(-1) || 0; }
        else if (inText && op === 'Tz') horizontalScale = (nums.at(-1) ?? 100) / 100;
        else if (inText && op === 'Tc') charSpacing = nums.at(-1) || 0;
        else if (inText && op === 'Tw') wordSpacing = nums.at(-1) || 0;
        else if (inText && op === 'Tr') renderMode = nums.at(-1) || 0;
        else if (inText && op === 'Ts') rise = nums.at(-1) || 0;
        else if (inText && op === 'T*') {
          lineMatrix = multiplyPdfMatrix(lineMatrix, [1, 0, 0, 1, 0, -leading]);
          textMatrix = lineMatrix.slice(); currentPositionKnown = true;
        } else if (inText && (op === 'Tj' || op === 'TJ')) {
          const font=fonts.get(fontName),measured = font?.measureOperands(operands, fontSize, charSpacing, wordSpacing);
          // 同一条TJ可包含整排表头。保留未命中的字形及全部字距，仅用位移替代选中字形。
          if(currentPositionKnown&&measured&&font.codeBytes&&fontSize){
            const kept=[],selected=[];let advance=0,hits=0;
            for(const operand of operands){
              if(operand.type==='number'){kept.push(operand.value);selected.push(operand.value);advance-=operand.number*fontSize/1000;continue;}
              if(operand.type!=='string')continue;
              const bytes=decodePdfStringBytes(operand.value);
              for(let at=0;at<bytes.length;at+=font.codeBytes){
                const value='<'+Array.from(bytes.subarray(at,at+font.codeBytes),byte=>byte.toString(16).padStart(2,'0')).join('')+'>';
                const step=font.measureOperands([{type:'string',value}],fontSize,charSpacing,wordSpacing).width;
                const point=multiplyPdfMatrix(matrix,multiplyPdfMatrix(textMatrix,[1,0,0,1,advance*horizontalScale,rise]));
                const inside=isPdfPointInsideAnyBox(point[4],point[5],boxes),space=formatPdfNumber(-step/fontSize*1000);
                kept.push(inside?space:value);selected.push(inside?value:space);if(inside)hits++;advance+=step;
              }
            }
            if(hits)ranges.push({start:operands[0].start,end:token.end,replacement:`[${kept.join(' ')}] TJ`,replay:capture?`q ${matrix.map(formatPdfNumber).join(' ')} cm ${fill} ${stroke} ${strokeWidth} w BT ${fontName} ${fontSize} Tf ${charSpacing} Tc ${wordSpacing} Tw ${horizontalScale*100} Tz ${leading} TL ${rise} Ts ${renderMode} Tr ${textMatrix.map(formatPdfNumber).join(' ')} Tm [${selected.join(' ')}] TJ ET Q`:''});
            textMatrix=multiplyPdfMatrix(textMatrix,[1,0,0,1,measured.width*horizontalScale,0]);operands=[];continue;
          }
          const point = multiplyPdfMatrix(matrix, multiplyPdfMatrix(textMatrix, [1, 0, 0, 1, (measured?.leadingWidth || 0) * horizontalScale, 0]));
          // 后续若无显式定位，保留该片段，避免未知字宽造成邻接字段误删。
          let nextIndex = index + 1;
          while (nextIndex < tokens.length && tokens[nextIndex].type !== 'word') nextIndex++;
          const nextOperator = tokens[nextIndex];
          const repositioned = !nextOperator || ['Td', 'TD', 'Tm', 'T*', 'ET'].includes(nextOperator.value);
          if (currentPositionKnown && (measured || repositioned) && operands.length && isPdfPointInsideAnyBox(point[4], point[5], boxes)) {
            ranges.push({ start: operands[0].start, end: token.end, replacement: measured && fontSize ? `[${formatPdfNumber(-measured.width / fontSize * 1000)}] TJ` : '',
              replay: capture ? `q ${matrix.map(formatPdfNumber).join(' ')} cm ${fill} ${stroke} ${strokeWidth} w BT ${fontName} ${fontSize} Tf ${charSpacing} Tc ${wordSpacing} Tw ${horizontalScale * 100} Tz ${leading} TL ${rise} Ts ${renderMode} Tr ${textMatrix.map(formatPdfNumber).join(' ')} Tm ${source.slice(operands[0].start, token.end)} ET Q` : '' });
          }
          if (measured) textMatrix = multiplyPdfMatrix(textMatrix, [1, 0, 0, 1, measured.width * horizontalScale, 0]);
          else currentPositionKnown = false;
        }
        operands = [];
      }
      for (const range of [...ranges].reverse()) source = `${source.slice(0, range.start)}${range.replacement}\n${source.slice(range.end)}`;
      return { source, removed: ranges.length, replay: capture ? ranges.map(range => range.replay).join("\n") : '' };
    };

const removeUnderlyingPdfText = (pdfLibDoc, page, boxes, fontCache = new Map(), captureOnly = false) => {
      if (!boxes.length || !PDFLib.decodePDFRawStream || !PDFLib.PDFName) return 0;
      const contents = page.node.Contents();
      if (!contents) return 0;
      const fonts = new Map();
      const resources = pdfLibDoc.context.lookup(page.node.Resources()?.get(PDFLib.PDFName.of('Font')));
      for (const [key, ref] of resources?.entries?.() || []) {
        try {
          const name = pdfLibDoc.context.lookup(ref).get(PDFLib.PDFName.of('BaseFont'))?.decodeText?.();
          // 原指令的字节只能用该资源自己的编码解释；同族字体不能代替。
          const font = app.getOriginalPdfFont(pdfLibDoc, page, fontCache, name, '', ref);
          if (font) fonts.set(String(key), font);
        } catch (err) { /* 无可用字宽时保守处理已显式定位的文本。 */
        }
      }
      // /Contents 数组是同一段连续指令，流边界可能落在 BT、Tf 或 TJ 内。
      // 合并解码后再解析，保留跨流的操作数、文字矩阵及图形状态。
      const isArray = typeof contents.size === 'function' && typeof contents.get === 'function';
      try {
        const entries = isArray ? Array.from({ length: contents.size() }, (_, i) => contents.get(i)) : [contents];
        const source = entries.map(entry => pdfBytesToBinaryString(PDFLib.decodePDFRawStream(pdfLibDoc.context.lookup(entry)).decode())).join('\n');
        const result = removeCoveredTextBlocksFromStream(source, boxes, fonts, captureOnly);
        if (captureOnly) return result.replay || '';
        if (!result.removed) return 0;
        const ref = pdfLibDoc.context.register(pdfLibDoc.context.flateStream(pdfBinaryStringToBytes(result.source)));
        page.node.set(PDFLib.PDFName.of('Contents'), ref);
        return result.removed;
      } catch (err) {
        console.warn('移除替换区域旧文字失败，保留原内容:', err);
        return 0;
      }
    };

const captureOriginalMergeFlow = (doc, page, record, cache) => {
      const flow = record.replacementFlow;
      if (!flow || flow.changed || record.mergedText !== record._initialText) return null;
      const boxes = app.getOriginalSourceBoxes(record.pageNum, app.mergeApi.getMergeSourceIndices(record));
      const replay = removeUnderlyingPdfText(doc, page, boxes, cache, true);
      return replay ? `q 1 0 0 1 ${formatPdfNumber(flow.x - flow.recordX)} ${formatPdfNumber(flow.originalTop - flow.top)} cm\n${replay}\nQ` : null;
    };

const appendOriginalTextFlow = (doc, page, replay) => {
      if (replay) page.node.addContentStream(doc.context.register(doc.context.flateStream(pdfBinaryStringToBytes(replay))));
    };

const getPlainImportedEditBounds = edit => {
      if (edit.bounds) return edit.bounds;
      const item = edit.item;
      if (!item || !item.transform) return null;
      const transform = item.transform;
      if (Math.abs(transform[1] || 0) > .01 || Math.abs(transform[2] || 0) > .01) {
        const size=Math.max(1,Math.hypot(transform[0],transform[1])),width=Math.abs(item.width||size),ascent=edit.textStyle.ascent??.8,descent=edit.textStyle.descent??-.2;
        const points=[descent,ascent].flatMap(vertical=>[0,width].map(horizontal=>[transform[4]+transform[0]/size*horizontal+transform[2]*vertical,transform[5]+transform[1]/size*horizontal+transform[3]*vertical]));
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return {x:Math.min(...xs)-1,y:Math.min(...ys)-1,width:Math.max(...xs)-Math.min(...xs)+2,height:Math.max(...ys)-Math.min(...ys)+2};
      }
      const fontSizePt = Math.max(1, Math.abs(transform[3] || 0), Math.abs(item.height || 0));
      let ascent = Number.isFinite(edit.textStyle.ascent) ? edit.textStyle.ascent : 0.8;
      let descent = Number.isFinite(edit.textStyle.descent) ? edit.textStyle.descent : -0.2;
      if (ascent <= descent) {
        ascent = 0.8;
        descent = -0.2;
      }
      const padding = 1;
      return {
        sourceBaseline:transform[5],sourceBaselineTolerance:Math.max(.5,fontSizePt*.15),
        sourceLeft: transform[4] - .2, sourceRight: transform[4] + Math.max(1, Math.abs(item.width || 0)) - .05,
        x: transform[4] - padding,
        y: transform[5] + descent * fontSizePt - padding,
        width: Math.max(1, Math.abs(item.width || 0)) + padding * 2,
        height: Math.max(fontSizePt, (ascent - descent) * fontSizePt) + padding * 2
      };
    };
return {get pageTextContentCache(){return pageTextContentCache;},
get pageSourceCoverCache(){return pageSourceCoverCache;},
get pageTextItemCache(){return pageTextItemCache;},
get pageSourceAppearanceCache(){return pageSourceAppearanceCache;},
get getPageSourceAppearances(){return getPageSourceAppearances;},
get importedBackgroundVersion(){return importedBackgroundVersion;},set importedBackgroundVersion(value){importedBackgroundVersion=value;},
get importedBackgroundPromise(){return importedBackgroundPromise;},set importedBackgroundPromise(value){importedBackgroundPromise=value;},
get importedBackgroundLoadingTask(){return importedBackgroundLoadingTask;},set importedBackgroundLoadingTask(value){importedBackgroundLoadingTask=value;},
get importedBackgroundRenders(){return importedBackgroundRenders;},
get importedBackgroundTouchedPages(){return importedBackgroundTouchedPages;},
get yieldPdfUi(){return yieldPdfUi;},
get beginImportedPreviewUpdate(){return beginImportedPreviewUpdate;},
get invalidateImportedBackground(){return invalidateImportedBackground;},
get buildImportedBackground(){return buildImportedBackground;},
get refreshImportedPageBackgrounds(){return refreshImportedPageBackgrounds;},
get loadEditablePdf(){return loadEditablePdf;},
get getOriginalSourceBoxes(){return getOriginalSourceBoxes;},
get getPageTextContent(){return getPageTextContent;},
get findTextContentItemForSpan(){return findTextContentItemForSpan;},
get dataUrlToUint8Array(){return dataUrlToUint8Array;},
get pdfBytesToBinaryString(){return pdfBytesToBinaryString;},
get pdfBinaryStringToBytes(){return pdfBinaryStringToBytes;},
get decodePdfStringBytes(){return decodePdfStringBytes;},
get scanPdfContentTokens(){return scanPdfContentTokens;},
get multiplyPdfMatrix(){return multiplyPdfMatrix;},
get formatPdfNumber(){return formatPdfNumber;},
get isPdfPointInsideAnyBox(){return isPdfPointInsideAnyBox;},
get removeCoveredTextBlocksFromStream(){return removeCoveredTextBlocksFromStream;},
get removeUnderlyingPdfText(){return removeUnderlyingPdfText;},
get captureOriginalMergeFlow(){return captureOriginalMergeFlow;},
get appendOriginalTextFlow(){return appendOriginalTextFlow;},
get getPlainImportedEditBounds(){return getPlainImportedEditBounds;}};
}});

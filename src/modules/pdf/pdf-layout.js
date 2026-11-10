import * as PDFLib from 'pdf-lib'
import { pdfjsLib } from '@/services/pdf-runtime.js'
/** layout 功能模块，通过实时app接口访问其他功能。 */
export const PDFLayout =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
const formatPdfNumber=value=>PDFLib.PDFNumber.of(Math.abs(value)<1e-8?0:value).toString();

const isNarrativeSourceText = text => String(text).replace(/\s/g, '').length >= 30 && /。|[.!?](?:\s|$)|^[IVX]+级[：:]/.test(text);

const plainReplacementLayoutCache = new Map();

// 使用原文、单元格、相邻文字和页面边缘确定安全区域；不移动下一行。
const getSafeReplacementRegion = async (pageNum, sources, box, options = {}) => {
      const page = await app.pdfDoc.getPage(pageNum), content = await app.getPageTextContent(pageNum);
      await getReplacementRules(pageNum);
      const items = content.items.filter(item => item.str?.trim()), own = new Set(sources), first = sources[0];
      if(!first)return {...box,singleLine:!!options.singleLine,alignment:'left'};
      const size = options.size || Math.max(1, Math.hypot(first.transform[0],first.transform[1]),Math.hypot(first.transform[2],first.transform[3]));
      const [x0,y0,x1,y1] = page.view, height = y1-y0;
      let left = x0+.5, right = x1-.5, bottom = height-y0-.5;
      const upright = Math.abs(first.transform[1])<.01 && Math.abs(first.transform[2])<.01;
      if (!upright) {
        // 旋转文字沿自身基线计算可用长度，限制在原文长度和页面边缘内。
        const ux=first.transform[0]/size,uy=first.transform[1]/size,origin=first.transform.slice(4);
        let width=Math.max(0,box.width);
        for(const [u,at,min,max] of [[ux,origin[0],x0+.5,x1-.5],[uy,origin[1],y0+.5,y1-.5]])if(Math.abs(u)>.001)width=Math.min(width,Math.max(0,((u>0?max:min)-at)/u));
        for(const other of items)if(!own.has(other)){
          const dx=other.transform[4]-origin[0],dy=other.transform[5]-origin[1],along=dx*ux+dy*uy,cross=Math.abs(dx*uy-dy*ux);
          if(along>size*.3&&cross<size*.3)width=Math.min(width,Math.max(0,along-.5));
        }
        return {...box,width,singleLine:true,alignment:'left',rotated:true};
      }
      const originalRight=box.x+box.width, originalBottom=box.top+box.height;
      // 表格检测在 viewport 坐标中工作，输出再转回 PDF 的原始坐标。
      const cell = page.rotate%360===0 ? getReplacementCell(pageNum,box.x-x0,originalRight-x0,first.transform[5]-y0) : null;
      if(cell){
        // 仅换字体的原文保持原起点和已有宽度；不能把原有裁剪路径的内边距再次扣除。
        left=Math.max(left,options.allowTouch?Math.min(box.x,cell.left+x0+.5):cell.left+x0+.5);
        right=Math.min(right,options.allowTouch?Math.max(originalRight,cell.right+x0-.5):cell.right+x0-.5);
        bottom=Math.min(bottom,cell.bottom-y0-.25);
      }
      if(!cell && page.rotate%360===0){
        const rules=replacementCellCache.get(pageNum).edges.filter(edge=>edge.bottom-edge.top<.5&&edge.left+x0<=box.x+.5&&edge.right+x0>=originalRight-.5&&Math.abs(edge.top-y0-box.top)<size*4);
        if(rules.length){const nearest=rules.sort((a,b)=>Math.abs(a.top-y0-box.top)-Math.abs(b.top-y0-box.top))[0];left=Math.max(left,nearest.left+x0+.5);right=Math.min(right,nearest.right+x0-.5);}
      }
      for (const other of items) {
        if(own.has(other)||Math.abs(other.transform[1])>.01||Math.abs(other.transform[2])>.01)continue;
        const z=Math.max(1,Math.abs(other.transform[3])),style=content.styles[other.fontName]||{};
        const top=height-other.transform[5]-(style.ascent??.8)*z, end=height-other.transform[5]-(style.descent??-.2)*z;
        const x=other.transform[4],r=x+Math.abs(other.width);
        if(top<originalBottom-.1&&end>box.top+.1){
          if(x>box.x+size*.3)right=Math.min(right,x-(options.allowTouch&&x>=originalRight-.2?0:.6));
          if(r<=box.x+.1)left=Math.max(left,r+(options.allowTouch&&r<=box.x+.01?0:.6));
        }
        if(top>=box.top+size*.5&&r>box.x+.1&&x<originalRight-.1)bottom=Math.min(bottom,top-.25);
      }
      const originalCenter=box.x+box.width/2,center=cell?(cell.left+cell.right)/2+x0:(x0+x1)/2;
      const centered=options.expand && Math.abs(originalCenter-center)<size*.3;
      const rightAligned=options.expand&&!centered&&box.x>x0+(x1-x0)*.6&&options.color==='rgb(0, 0, 0)';
      let x=Math.max(left,box.x),width=Math.max(0,Math.min(right,options.expand?right:originalRight)-x),alignment='left';
      if(centered||rightAligned){
        const anchorRight=Math.min(right,originalRight),available=Math.max(0,(rightAligned?anchorRight:right)-left);
        width=Math.min(available,Math.max(box.width,options.measured||0));
        x=rightAligned?anchorRight-width:Math.max(left,Math.min(originalCenter-width/2,right-width));alignment=rightAligned?'right':'center';
      }
      return {x,top:box.top,width,height:Math.max(0,Math.min(originalBottom,bottom)-box.top),singleLine:!!options.singleLine,alignment};
    };

const createFixedPlainLayout = async (pageNum,id,text,sources,annotation) => {
      const page=await app.pdfDoc.getPage(pageNum),content=await app.getPageTextContent(pageNum);await page.getOperatorList();
      const item=sources[0],dominant=annotation?.dominantItem||item,style=content.styles[dominant.fontName]||{};
      // Worker 的字体消息可能晚于操作列表到达；恢复页面时等待字库，避免读取未就绪对象。
      const font=page.commonObjs.has(dominant.fontName)?page.commonObjs.get(dominant.fontName)
        :await new Promise(resolve=>page.commonObjs.get(dominant.fontName,resolve));
      app.originalPdfFontObjects.set(dominant.fontName,font);
      const index=content.items.filter(item=>item.str?.trim()).indexOf(dominant)+1,appearance=(await app.getPageSourceAppearances(pageNum)).get(index);
      const weight=app.inferFontWeight(font?.name,appearance?.fontWeight||'normal'),fontStyle=font?.italic||/italic|oblique/i.test(font?.name||'')?'italic':'normal';
      const family=app.getReplacementFontFamily(text,style.fontFamily||'serif',font?.name,font,weight);
      const metric=await app.getReplacementMetrics(pageNum,text+'...',family,font?.name,weight,fontStyle);
      const size=Math.max(1,Math.hypot(item.transform[0],item.transform[1]),Math.hypot(item.transform[2],item.transform[3]),Math.abs(item.height||0));
      const ascent=metric.heightAtSize(size,{descender:false}),fontHeight=metric.heightAtSize(size),pageHeight=page.view[3]-page.view[1];
      const singleLine=sources.every(source=>Math.abs(source.transform[5]-item.transform[5])<size*.15),color=annotation?.color||appearance?.color||'rgb(0, 0, 0)';
      const box=annotation&&!singleLine?{x:annotation.bounds.x,top:pageHeight-annotation.bounds.y-annotation.bounds.height,width:annotation.bounds.width,height:annotation.bounds.height}:{x:Math.min(...sources.map(source=>source.transform[4])),top:pageHeight-item.transform[5]-ascent,width:Math.max(...sources.map(source=>source.transform[4]+source.width))-Math.min(...sources.map(source=>source.transform[4])),height:fontHeight};
      const region=await getSafeReplacementRegion(pageNum,sources,box,{expand:singleLine,singleLine,size,color,allowTouch:app.fontSettings.enabled&&text===item.str&&!annotation,measured:metric.widthOfTextAtSize(text.replace(/[\r\n]+/g,' '),size)});
      const leading=Math.max(size*1.15,fontHeight);
      let displayText=text;
      if(!annotation){
        const previous=content.items.filter(other=>other.str?.trim()&&other!==item&&Math.abs(other.transform[5]-item.transform[5])<size*.15&&other.transform[4]+other.width<=item.transform[4]+.1).sort((a,b)=>b.transform[4]-a.transform[4])[0],prefix=previous?.str.trim();
        if(/^[\d.]+$/.test(prefix||'')&&text.startsWith(prefix)&&/^\s/.test(text.slice(prefix.length))&&item.transform[4]-previous.transform[4]-previous.width<=size*1.5)displayText=text.slice(prefix.length).trimStart();
      }
      const fixed=layoutFixedPdfText(displayText,metric,size,leading,region.width,region.height,{singleLine,baselineOffset:singleLine?ascent:undefined});
      return app.regionEditor.layout(id,displayText,metric,{id,item,text,...region,...fixed,alignment:region.alignment,fontWeight:weight,fontStyle,family,originalFontName:font?.name,color,fontStrokeWidthPt:appearance?.strokeWidth,fixedBounds:true});
    };

const getPlainReplacementLayouts = async pageNum => {
      if(!plainReplacementLayoutCache.has(pageNum)){
        const entry={layouts:new Map(),ruleShifts:[],promise:null};
        entry.promise=(async()=>{
          const content=await app.getPageTextContent(pageNum),items=content?.items.filter(item=>item.str?.trim())||[],excluded=app.getPageMergedSourceIndices(pageNum);
          if([...app.importedTexts.keys()].some(id=>id.startsWith(`p${pageNum}-a-`)))for(const row of await app.getPageAnnotationTexts(pageNum)){
            const text=app.getAnnotationImportedText(row);
            if(text===row.text||app.jsonApi.getAnnotationTextOwner(row))continue;
            row.sourceItems.forEach(({index})=>excluded.add(index));
            entry.layouts.set(row.id,await createFixedPlainLayout(pageNum,row.id,text,row.sourceItems.map(source=>source.item),row));
          }
          for(const [index,item]of items.entries()){
            const id=`p${pageNum}-${index+1}`;
            if(excluded.has(index+1)||(!app.regionEditor.has(id)&&!app.fontSettings.enabled&&(!app.importedTexts.has(id)||app.importedTexts.get(id)===item.str)))continue;
            entry.layouts.set(id,await createFixedPlainLayout(pageNum,id,app.importedTexts.get(id)??item.str,[item]));
          }
          return entry.layouts;
        })();plainReplacementLayoutCache.set(pageNum,entry);
      }
      return plainReplacementLayoutCache.get(pageNum).promise;
    };

const collectPlainImportedEdits = async onlyPage => {
      const edits = [];
      if (!app.pdfDoc || (!app.fontSettings.enabled && !app.regionEditor.size && app.importedTexts.size === 0)) return edits;
      const importedPages = new Set([...app.importedTexts.keys()].map(id => Number(/^p(\d+)-/.exec(id)?.[1])).filter(Number.isInteger));
      for (let pageNum = onlyPage || 1; pageNum <= (onlyPage || app.pdfDoc.numPages); pageNum++) {
        if (!app.fontSettings.enabled && !app.regionEditor.pages().has(pageNum) && !importedPages.has(pageNum)) continue;
        const textContent = await app.getPageTextContent(pageNum);
        if (!textContent?.items) continue;
        const layouts = await getPlainReplacementLayouts(pageNum);
        const removedIndices = app.getPageMergedSourceIndices(pageNum);
        if ([...app.importedTexts.keys()].some(id => id.startsWith(`p${pageNum}-a-`))) {
          for (const row of await app.getPageAnnotationTexts(pageNum)) {
            const newText = app.getAnnotationImportedText(row);
            if (newText === row.text || app.jsonApi.getAnnotationTextOwner(row)) continue;
            row.sourceItems.forEach(({ index }) => removedIndices.add(index));
            const item = row.sourceItems[0].item, page = await app.pdfDoc.getPage(pageNum);
            if (!page.commonObjs.has(item.fontName)) await page.getOperatorList();
            const fontItem = row.dominantItem || item, font = app.getLoadedPdfFont(pageNum, fontItem.fontName) || page.commonObjs.get(fontItem.fontName);
            const singleLine = !/[\r\n]/.test(newText) && row.sourceItems.every(source => Math.abs(source.item.transform[5] - item.transform[5]) < Math.abs(item.transform[3]) * .15);
            const family = app.getReplacementFontFamily(newText, row.textStyle.fontFamily || 'serif', font?.name, font);
            const replacementLayout = layouts.get(row.id);
            edits.push({ pageNum, dataId: row.id, originalText: row.text, newText, item, bounds: row.bounds, textStyle: row.textStyle, fontFamily: family, fontWeight: app.inferFontWeight(font?.name, 'normal'), fontStyle: font?.italic || /italic|oblique/i.test(font?.name || '') ? 'italic' : 'normal', originalFontName: font?.name || '', replacementLayout });
          }
        }
        let pdfPage = null;
        try {
          pdfPage = await app.pdfDoc.getPage(pageNum);
        } catch (pageErr) {
          console.warn('读取普通文本页面失败:', pageErr);
        }
        let sourceIndex = 0;
        for (const item of textContent.items) {
          const originalText = item.str || '';
          if (!originalText.trim()) continue;
          sourceIndex++;
          if (removedIndices.has(sourceIndex)) continue;
          const dataId = `p${pageNum}-${sourceIndex}`;
          const replacementLayout = layouts.get(dataId);
          if (!app.importedTexts.has(dataId) && !replacementLayout) continue;
          const newText = replacementLayout?.text ?? app.importedTexts.get(dataId) ?? originalText;
          if (newText === originalText && !replacementLayout) continue;
          if (pdfPage && !pdfPage.commonObjs.has(item.fontName)) await pdfPage.getOperatorList();
          const textStyle = textContent.styles && textContent.styles[item.fontName];
          let fontFamily = textStyle && textStyle.fontFamily ? textStyle.fontFamily : 'sans-serif';
          let fontWeight = 'normal';
          let fontStyle = 'normal';
          let originalFontName = '';
          if (pdfPage && item.fontName) {
            try {
              const fontObject = pdfPage.commonObjs.get(item.fontName);
              if (fontObject) {
                originalFontName = app.getReplacementSourceFont(newText, fontObject)?.name || fontObject.name || '';
                if (fontObject.loadedName) {
                  const safeFontName = fontObject.loadedName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                  fontFamily = `"${safeFontName}", ${fontFamily}`;
                }
                fontWeight = app.inferFontWeight(originalFontName, fontObject.bold || fontObject.black ? 'bold' : 'normal');
                if (fontObject.italic || /italic|oblique/i.test(originalFontName)) fontStyle = 'italic';
              }
            } catch (fontErr) {
              // 未渲染页面的字体对象可能尚未进入 commonObjs，使用 textContent 字体族。
            }
          }
          // PDF 内嵌字体通常是只含原文字符的子集。替换为新文本时若继续使用
          // 该子集，缺少的 x、w 等字形会逐字回退到另一字体，造成粗细不一致。
          fontFamily = app.getReplacementFontFamily(newText, fontFamily, originalFontName, app.getLoadedPdfFont(pageNum, item.fontName), fontWeight);
          fontWeight = replacementLayout?.fontWeight || fontWeight;
          edits.push({
            pageNum,
            dataId,
            originalText,
            newText,
            item,
            textStyle: textStyle || {},
            fontFamily,
            fontWeight,
            fontStyle,
            originalFontName,
            replacementLayout
          });
        }
      }
      return edits;
    };

const replacementRuleCache = new Map();

const replacementCellCache = new Map();

const getReplacementRules = pageNum => {
      if (!replacementRuleCache.has(pageNum)) replacementRuleCache.set(pageNum, (async () => {
        const page = await app.pdfDoc.getPage(pageNum), viewport = page.getViewport({scale: 1}),
          operators = await page.getOperatorList(), rules = [], edges = [], strokedEdges = [], boxes = [], stack = [];
        let matrix = viewport.transform.slice(), pathStart = 0;
        const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
        const line = (a, b) => {
          const edge = {
            left: Math.min(a[0], b[0]),
            right: Math.max(a[0], b[0]),
            top: Math.min(a[1], b[1]),
            bottom: Math.max(a[1], b[1])
          };
          if (edge.bottom - edge.top < .5 && edge.right - edge.left > 2 || edge.right - edge.left < .5 && edge.bottom - edge.top > 2) edges.push(edge);
          if (edge.bottom - edge.top < .5 && edge.right - edge.left > viewport.width * .5) rules.push((a[1] + b[1]) / 2);
        };
        for (let i = 0; i < operators.fnArray.length; i++) {
          const fn = operators.fnArray[i], args = operators.argsArray[i], ops = pdfjsLib.OPS;
          if (fn === ops.save) stack.push(matrix.slice());
          else if (fn === ops.restore) matrix = stack.pop() || viewport.transform.slice();
          else if (fn === ops.transform) matrix = app.multiplyPdfMatrix(matrix, args);
          else if ([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(fn)) { strokedEdges.push(...edges.slice(pathStart));pathStart = edges.length; }
          else if ([ops.fill, ops.eoFill, ops.endPath].includes(fn)) pathStart = edges.length;
          else if (fn === ops.constructPath) {
            let offset = 0, previous;
            for (const command of args[0]) {
              if (command === ops.moveTo) {
                previous = point(args[1][offset], args[1][offset + 1]);
                offset += 2;
              } else if (command === ops.lineTo) {
                const next = point(args[1][offset], args[1][offset + 1]);
                if (previous) line(previous, next);
                previous = next;
                offset += 2;
              } else if (command === ops.rectangle) {
                const [x, y, width, height] = args[1].slice(offset, offset + 4),
                  points = [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
                points.forEach((value, index) => line(value, points[(index + 1) % 4]));
                const box = {
                  left: Math.min(...points.map(p => p[0])),
                  right: Math.max(...points.map(p => p[0])),
                  top: Math.min(...points.map(p => p[1])),
                  bottom: Math.max(...points.map(p => p[1]))
                };
                if (box.right - box.left > 4 && box.bottom - box.top > 4 && box.right - box.left < viewport.width * .9) boxes.push(box);
                offset += 4;
              } else if (command === ops.curveTo) offset += 6;
              else if (command === ops.curveTo2 || command === ops.curveTo3) offset += 4;
            }
          }
        }
        replacementCellCache.set(pageNum, {height: viewport.height, boxes, edges, strokedEdges});
        return rules.sort((a, b) => a - b).filter((y, i, values) => !i || y - values[i - 1] > 1);
      })());
      return replacementRuleCache.get(pageNum);
    };

const getReplacementCell = (pageNum, left, right, baseline) => {
      const geometry = replacementCellCache.get(pageNum);
      if (!geometry) return null;
      const y = geometry.height - baseline, x = (left + right) / 2;
      const boxes = geometry.boxes.filter(box => box.left <= left + 1 && box.right >= right - 1 && box.top < y && box.bottom > y);
      if (boxes.length) return boxes.sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top))[0];
      const vertical = geometry.edges.filter(edge => edge.right - edge.left < .5 && edge.top < y && edge.bottom > y);
      const a = vertical.filter(edge => edge.left < x).sort((a, b) => b.left - a.left)[0],
        b = vertical.filter(edge => edge.right > x).sort((a, b) => a.right - b.right)[0];
      if (!a || !b || a.right > left + 1 || b.left < right - 1) return null;
      const horizontal = geometry.edges.filter(edge => edge.bottom - edge.top < .5 && edge.left <= a.right + 1 && edge.right >= b.left - 1);
      const top = horizontal.filter(edge => edge.top < y).sort((a, b) => b.top - a.top)[0]?.top,
        bottom = horizontal.filter(edge => edge.bottom > y).sort((a, b) => a.bottom - b.bottom)[0]?.bottom;
      return top != null && bottom != null ? {left: a.right, right: b.left, top, bottom} : null;
    };

const paragraphRuleShifts = new Map();

const moveReplacementClosingRules = (doc, page, pageNum) => {
      const shifts = paragraphRuleShifts.get(pageNum);
      if (!shifts?.length) return;
      const contents = page.node.Contents(), count = contents?.size?.() || (contents ? 1 : 0), context = doc.context;
      const references = Array.from({length: count}, (_, i) => contents.get ? contents.get(i) : contents);
      let changed = false;
      for (let i = 0; i < count; i++) {
        const ref = references[i], stream = context.lookup(ref);
        const source = app.pdfBytesToBinaryString(PDFLib.decodePDFRawStream(stream).decode()),
          tokens = app.scanPdfContentTokens(source), replacements = [], stack = [];
        if (tokens.some(token => token.type === 'word' && token.value === 'BI')) continue;
        let matrix = [1, 0, 0, 1, 0, 0], operands = [], path = [], start = 0;
        for (const token of tokens) {
          if (token.type !== 'word') {
            operands.push(token);
            continue;
          }
          const nums = operands.filter(value => value.type === 'number').map(value => value.number);
          if (token.value === 'q') stack.push(matrix.slice());
          else if (token.value === 'Q') matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
          else if (token.value === 'cm') matrix = app.multiplyPdfMatrix(matrix, nums.slice(-6));
          else if (token.value === 'm' || token.value === 'l') {
            if (!path.length) start = operands[0]?.start ?? token.start;
            const [x, y] = nums.slice(-2);
            path.push([matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
            const point=path.at(-1),shift=shifts.find(value=>(value.extendTop||value.grid)&&Math.abs(page.getHeight()-point[1]-value.from)<(value.grid ? .6 : 2)&&point[0]>=value.x-1&&point[0]<=value.x+value.width+1),det=matrix[0]*matrix[3]-matrix[1]*matrix[2];
            if(shift&&Math.abs(det)>.001){const dy=shift.from-shift.to,delta=[-matrix[2]*dy/det,matrix[0]*dy/det],coordinates=operands.filter(value=>value.type==='number').slice(-2);coordinates.forEach((coordinate,i)=>{if(Math.abs(delta[i])>.00001)replacements.push({start:coordinate.start,end:coordinate.end,value:formatPdfNumber(coordinate.number+delta[i])});});}

          } else if(token.value==='re'){
            start=operands[0]?.start??token.start;
            const [x,y,w,h]=nums.slice(-4);path=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
            const pointShifts=path.map(point=>shifts.find(shift=>(shift.extendTop||shift.grid)&&Math.abs(page.getHeight()-point[1]-shift.from)<(shift.grid ? .6 : 2)&&point[0]>=shift.x-1&&point[0]<=shift.x+shift.width+1)),det=matrix[0]*matrix[3]-matrix[1]*matrix[2];
            if(pointShifts.some(Boolean)&&Math.abs(det)>.001){const points=path.map((point,i)=>{const shift=pointShifts[i],dy=shift?shift.from-shift.to:0,px=point[0]-matrix[4],py=point[1]+dy-matrix[5];return[(matrix[3]*px-matrix[2]*py)/det,(-matrix[1]*px+matrix[0]*py)/det];});replacements.push({start,end:token.end,value:points.map((point,i)=>point.map(formatPdfNumber).join(' ')+(i?' l':' m')).join(' ')+' h'});}

          } else if (['S','f','f*','B','B*'].includes(token.value)) {
            if (path.length>=2&&Math.max(...path.map(p=>p[1]))-Math.min(...path.map(p=>p[1]))<1) {
              const top=page.getHeight()-Math.max(...path.map(p=>p[1])),left=Math.min(...path.map(p=>p[0])),right=Math.max(...path.map(p=>p[0]));
              const shift = shifts.find(value => !value.extendTop&&!value.grid&&Math.abs(value.from-top)<.9&&left>=value.x-1&&right<=value.x+value.width+1);
              const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
              if (shift && Math.abs(determinant) > .001) {
                const dy = shift.from - shift.to, x = -matrix[2] * dy / determinant, y = matrix[0] * dy / determinant;
                replacements.push({
                  start,
                  end: token.end,
                  value: `q 1 0 0 1 ${formatPdfNumber(x)} ${formatPdfNumber(y)} cm\n${source.slice(start, token.end)}\nQ`
                });
              }
            }
            path = [];
          } else if (['s', 'F', 'b', 'b*', 'n', 'c', 'v', 'y'].includes(token.value)) path = [];
          operands = [];
        }
        let edited = source;
        for (const replacement of replacements.sort((a,b)=>b.start-a.start)) edited = edited.slice(0, replacement.start) + replacement.value + edited.slice(replacement.end);
        if (replacements.length) {
          const data = context.flateStream(app.pdfBinaryStringToBytes(edited));
          references[i] = context.register(data);
          changed = true;
        }
      }
      if (changed) page.node.set(PDFLib.PDFName.of('Contents'), context.obj(references));
    };

const prepareReplacementParagraphFlow = async pageNum => {
      await getPlainReplacementLayouts(pageNum);
      paragraphRuleShifts.delete(pageNum);
      for(const record of app.mergeRecords)if(record.pageNum===pageNum)delete record.replacementFlow;
    };

const prepareImportedReplacementLayouts = async onlyPage => {
      const records=onlyPage?app.mergeRecords.filter(record=>record.pageNum===onlyPage):app.mergeRecords;
      for (const record of records) { if (app.importedTexts.has(record.dataId) && app.importedTexts.get(record.dataId) !== record._initialText) continue;const content=await app.getPageTextContent(record.pageNum),items=content?.items.filter(item=>item.str?.trim())||[],sources=app.getMergeSourceIndices(record).map(index=>({id:`p${record.pageNum}-${index}`,text:items[index-1]?.str||''}));if(sources.some(row=>app.importedTexts.has(row.id)&&app.importedTexts.get(row.id)!==row.text)) app.importedTexts.set(record.dataId,app.joinMergedTextParts(sources.map(row=>app.importedTexts.get(row.id)??row.text))); }
      const pages = new Set([...app.importedTexts.keys()].map(id => Number(/^p(\d+)-/.exec(id)?.[1])).filter(number => Number.isInteger(number) && number > 0 && number <= app.pdfDoc?.numPages));
      for(const pageNum of app.regionEditor.pages())pages.add(pageNum);
      if(app.fontSettings.enabled)for(let pageNum=1;pageNum<=app.pdfDoc.numPages;pageNum++)pages.add(pageNum);
      if(onlyPage){pages.clear();pages.add(onlyPage);}
      const sourceDoc=app.pdfDoc;
      let preparedPages=0;
      for (const pageNum of pages) { if(preparedPages++%8===0)await app.yieldPdfUi();if(app.pdfDoc!==sourceDoc)throw new Error("PDF 已切换");await getPlainReplacementLayouts(pageNum); }
      let preparedMerges=0;
      for (const record of records) {
        if(preparedMerges++%8===0)await app.yieldPdfUi();
        if(app.pdfDoc!==sourceDoc)throw new Error("PDF 已切换");
        const text = app.importedTexts.get(record.dataId) ?? record.mergedText;
        delete record.replacementCompact;
        if (text === record._initialText && !app.fontSettings.enabled && !app.regionEditor.has(record.dataId)) { delete record.replacementBand;delete record.replacementFixed;continue; }
        const content = await app.getPageTextContent(record.pageNum), page = await app.pdfDoc.getPage(record.pageNum);
        await page.getOperatorList();
        const nativeItems = content?.items.filter(item => item.str?.trim()) || [], source = app.getDominantSourceItem(app.getMergeSourceIndices(record).map(index => nativeItems[index - 1]).filter(Boolean), page);
        if (source?.fontName) {
          if (!page.commonObjs.has(source.fontName)) await page.getOperatorList();
          const font = page.commonObjs.get(source.fontName);
          app.originalPdfFontObjects.set(source.fontName, font);
          record.fontName = source.fontName;record.originalFontName = font?.name || record.originalFontName;
          record.replacementFonts = [...new Set(app.getMergeSourceIndices(record).map(index => content.items.filter(item => item.str?.trim())[index - 1]?.fontName).filter(Boolean))].map(name => {
            const original = page.commonObjs.get(name);app.originalPdfFontObjects.set(name, original);return app.importedFontFaces.get(original?.name) || original;
          });
          const replacementFont = app.getReplacementSourceFont(text, font);
          record.replacementFontName = replacementFont?.name || record.originalFontName;
          const appearance = (await app.getPageSourceAppearances(record.pageNum)).get(nativeItems.indexOf(source) + 1);
          record.fontColor = appearance?.color || record.fontColor;
          record.fontWeight = app.inferFontWeight(font?.name, appearance?.fontWeight || 'normal');record.fontStyle = font?.italic || /italic|oblique/i.test(font?.name || '') ? 'italic' : 'normal';record.fontStrokeWidthPt = appearance?.strokeWidth;
        }
        delete record.replacementBand;
        await prepareFixedMergedLayout(record, text);
      }
      for (const pageNum of pages) await prepareReplacementParagraphFlow(pageNum);
    };

const getReplacementLineHeight = (record, lines, size, preferred) => {
      const band = record?.replacementBand;
      if (record?.replacementCompact) preferred = Math.min(preferred, size * 1.12);
      if (!band || lines < 2) return preferred;
      const spacing = (band.bottom - band.top - size) / (lines - 1);
      return Math.max(size * (band.header ? .9 : 1), Math.min(preferred, spacing));
    };

// 合并框由合并时的坐标确定，后续文本替换不能扩框或推移其他内容。
const positionReplacementParagraph = record => ({top: record.topPt, height: record.heightPt});

const prepareFixedMergedLayout = async (record, text) => {
      const family = app.getReplacementFontFamily(text, record.fontFamily, record.replacementFontName || record.originalFontName, app.getLoadedPdfFont(record.pageNum, record.fontName), record.fontWeight);
      const font = await app.getReplacementMetrics(record.pageNum, text + '...', family, record.replacementFontName || record.originalFontName, record.fontWeight, record.fontStyle);
      const content=await app.getPageTextContent(record.pageNum),items=content.items.filter(item=>item.str?.trim()),sources=app.getMergeSourceIndices(record).map(index=>items[index-1]).filter(Boolean);
      const region=await getSafeReplacementRegion(record.pageNum,sources,{x:record.leftPt,top:record.topPt,width:record.widthPt,height:record.heightPt},{size:record.fontSizePt});
      record.replacementFixed = app.regionEditor.layout(record.dataId,text,font,{...layoutFixedPdfText(text, font, record.fontSizePt, record.lineHeightPt, region.width, region.height), family, x:record.leftPt, top:record.topPt, alignment: record.textAlign});
      record.replacementTopPt = record.replacementFixed.top ?? record.topPt;
      record.replacementHeightPt = record.replacementFixed.height;
    };

const applyPlainImportedText = (el, newText, replacementLayout) => {
      const layer = el.closest('.textLayer');
      if (!layer) return;
      const layerRect = layer.getBoundingClientRect();
      if (!el.dataset.jsonOriginalLayout) {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        el.dataset.jsonOriginalText = el.textContent || '';
        el.dataset.jsonOriginalLayout = JSON.stringify({
          css: el.getAttribute('style') || '', inlineLeft:el.style.left,inlineTop:el.style.top,transform:el.style.transform,transformOrigin:el.style.transformOrigin, left: (rect.left - layerRect.left) / layerRect.width,
          top: (rect.top - layerRect.top) / layerRect.height, width: rect.width / layerRect.width, height: rect.height / layerRect.height,
          size: parseFloat(style.fontSize) / layerRect.width, family: el.dataset.pdfFontFamily || style.fontFamily,
          weight: el.dataset.pdfFontWeight || style.fontWeight, fontStyle: el.dataset.pdfFontStyle || style.fontStyle, letterSpacing: style.letterSpacing
        });
      }
      const original = JSON.parse(el.dataset.jsonOriginalLayout);
      el.textContent = replacementLayout?.lines?.join('\n') ?? replacementLayout?.text ?? newText;
      removePlainTextCover(el);el.dataset.jsonLogicalText=newText;
      if (newText === el.dataset.jsonOriginalText && !replacementLayout) {
        el.setAttribute('style', original.css);el.classList.remove('is-json-replaced');delete el.dataset.jsonSingleLine;app.markTextOverflow(el, null);return;
      }
      const size = replacementLayout?.fontSize ? replacementLayout.fontSize*app.getPageScale(Number(layer.closest(".page")?.dataset.pageNumber)) : original.size * layerRect.width, left = original.left * layerRect.width;
      const naturalLatin = newText !== el.dataset.jsonOriginalText && (newText.match(/[A-Za-z]/g) || []).length > (newText.match(/[\u3400-\u9fff]/g) || []).length;
      const pageNumber = Number(layer.closest('.page')?.dataset.pageNumber);
      const top = replacementLayout?.top != null ? replacementLayout.top * app.getPageScale(pageNumber) : original.top * layerRect.height;
      const pageNum = Number(layer.closest('.page')?.dataset.pageNumber);
      const font = app.getLoadedPdfFont(pageNum, el.dataset.pdfFontName || replacementLayout?.item.fontName);
      const family = app.getReplacementFontFamily(newText, original.family, el.dataset.pdfOriginalFontName || font?.name, font, replacementLayout?.fontWeight || original.weight);
      const singleLine = replacementLayout?.singleLine ?? !/[\r\n]/.test(newText);
      const scale = app.getPageScale(pageNum);
      const measured = app.measureReplacementText(newText, font, size, family);
      const width = replacementLayout ? replacementLayout.width * scale : Math.max(original.width * layerRect.width, measured);
      const centered = Math.abs(left + original.width * layerRect.width / 2 - layerRect.width / 2) < size * .3;
      const renderLeft = replacementLayout ? replacementLayout.x * scale : Math.max(0, Math.min(centered ? left + (original.width * layerRect.width - width) / 2 : left, Math.max(0, layerRect.width - width)));
      if (singleLine) el.dataset.jsonSingleLine = '1';
      else delete el.dataset.jsonSingleLine;
      const lineHeight = replacementLayout?.lineHeight ? replacementLayout.lineHeight * scale : size * (parseFloat(el.dataset.pdfFontAscent || '0.8') - parseFloat(el.dataset.pdfFontDescent || '-0.2'));
      el.classList.add('is-json-replaced');
      const color = replacementLayout?.color || 'rgb(0, 0, 0)';
      if (el.style.setProperty) el.style.setProperty('--replacement-text-color', color);
      else el.style['--replacement-text-color'] = color;
      Object.assign(el.style, {
        left: `${renderLeft}px`, top: `${top}px`, width: `${width}px`, height: `${replacementLayout?.fixedBounds ? replacementLayout.height*scale : Math.max(original.height * layerRect.height, (replacementLayout?.height || 0) * scale, lineHeight)}px`,
        minWidth: '0', minHeight: '0', padding: '0', transform: 'none', background: 'transparent',
        fontFamily: family, fontWeight: '400', fontStyle: 'normal', fontStretch: 'normal', fontSynthesis: 'none', textDecoration: 'none', textShadow: 'none', textTransform: 'none', letterSpacing: `${(replacementLayout?.letterSpacing || 0)*scale}px`, wordSpacing: `${(replacementLayout?.wordSpacing || 0)*scale}px`, fontKerning: 'none', fontVariantLigatures: 'none',
        fontSize: `${size}px`, lineHeight: `${lineHeight}px`, color, textAlign: replacementLayout?.alignment || 'left', whiteSpace: singleLine ? 'pre' : 'pre-wrap', overflowWrap: singleLine ? 'normal' : 'anywhere', wordBreak: 'normal'
      });
      if (!replacementLayout?.fixedBounds && !singleLine) el.style.height = `${Math.max(1, parseFloat(el.style.height), el.scrollHeight)}px`;
      app.markTextOverflow(el, replacementLayout);
      el.dataset.jsonClipped=replacementLayout?.fixedBounds?'1':'';el.style.overflow=replacementLayout?.fixedBounds?'hidden':'visible';
      const source=replacementLayout?.item?.transform||app.pageSourceCoverCache.get(pageNum)?.get(Number(el.dataset.sourceIndex))?.sourceTransform;
      const view=app.pdfViewer?.getPageView(pageNum-1),viewport=view?.viewport;
      if(replacementLayout?.fixedBounds&&source&&viewport?.convertToViewportPoint){
        const z=Math.max(1,Math.hypot(source[0],source[1]),Math.hypot(source[2],source[3]),Math.abs(replacementLayout.item?.height||0)),u=[source[0]/z,source[1]/z],v=[source[2]/z,source[3]/z],rotated=Math.abs(source[1])>.01||Math.abs(source[2])>.01;
        const height=view.pdfPage.view[3]-view.pdfPage.view[1];
        const point=viewport.convertToViewportPoint(...(rotated?[source[4]+(replacementLayout.offsetX||0)+v[0]*replacementLayout.baselineOffset,source[5]-(replacementLayout.offsetY||0)+v[1]*replacementLayout.baselineOffset]:[replacementLayout.x,height-replacementLayout.top]));
        const [a,b,c,d]=viewport.transform,ux=rotated?u[0]:1,uy=rotated?u[1]:0,vx=rotated?v[0]:0,vy=rotated?v[1]:1;
        el.style.left=`${point[0]}px`;el.style.top=`${point[1]}px`;el.style.transform=`matrix(${(a*ux+c*uy)/scale},${(b*ux+d*uy)/scale},${-(a*vx+c*vy)/scale},${-(b*vx+d*vy)/scale},0,0)`;el.style.transformOrigin='0 0';
      }else if(source&&(Math.abs(source[1])>.01||Math.abs(source[2])>.01)){el.style.left=original.inlineLeft;el.style.top=original.inlineTop;el.style.transform=original.transform;el.style.transformOrigin=original.transformOrigin||'0 0';}
    };

const plainTextCovers = new WeakMap();

const removePlainTextCover = el => {
      plainTextCovers.get(el)?.remove();
      plainTextCovers.delete(el);
    };

const normalizePdfVectorText = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');

const wrapPdfVectorText = (text, font, fontSize, maxWidth) => {
      const output = [];
      const paragraphs = normalizePdfVectorText(text).split('\n');
      const pushLongToken = (token, currentLine) => {
        let line = currentLine;
        const chars = Array.from(token);
        for (const _char of chars) {
          const candidate = line + _char;
          if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
            output.push(line.trimStart());
            line = _char;
          } else {
            line = candidate;
          }
        }
        return line;
      };
      for (const _paragraph of paragraphs) {
        const tokens = app.mergeApi.tokenizeTextForWrap(_paragraph);
        let line = '';
        for (const token of tokens) {
          if (!token) continue;
          const candidate = line + token;
          if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
            line = candidate;
            continue;
          }
          if (line.trim()) output.push(line.trimStart());
          line = token.replace(/^\s+/, '');
          if (line && font.widthOfTextAtSize(line, fontSize) > maxWidth) {
            line = pushLongToken(line, '');
          }
        }
        if (line.trim() || _paragraph === '') output.push(line.trimStart());
      }
      return output;
    };

const layoutFixedPdfText = (text, font, preferredSize, preferredLineHeight, width, height, options = {}) => {
      const fontSize = Math.max(1, preferredSize || 10), lineHeight = Math.max(1, preferredLineHeight || fontSize * 1.2);
      width = Math.max(0, width || 0);height = Math.max(0, height || 0);
      const wrapped = options.singleLine ? [normalizePdfVectorText(text).replace(/\n/g,' ')] : wrapPdfVectorText(text, font, fontSize, Math.max(.001, width));
      const ascent = font.heightAtSize(fontSize, {descender: false}), descent = Math.max(0, font.heightAtSize(fontSize) - ascent);
      let baselineOffset = options.baselineOffset ?? Math.min(ascent, Math.max(0, height - descent));
      let capacity = height > 0 && width > 0 ? options.singleLine ? 1 : Math.max(1, 1 + Math.floor((height - baselineOffset - descent + .001) / lineHeight)) : 0;
      if (font.inkBoundsAtSize && capacity && !options.singleLine) {
        // Measure visible rows, not the font-wide ascender or hidden suffix.
        // Keep the original leading; only the baseline's unused headroom changes.
        const padding = Math.min(.15, fontSize * .01);
        let top = 0, bottom = 0;
        capacity = 0;
        for (const [index, line] of wrapped.entries()) {
          const ink = font.inkBoundsAtSize(line + '...', fontSize);
          top = Math.max(top, ink.ascent + padding - index * lineHeight);
          bottom = Math.max(bottom, index * lineHeight + ink.descent + padding);
          const baseline = options.baselineOffset ?? top;
          if (baseline + bottom > height + .001) break;
          capacity = index + 1;baselineOffset = baseline;
        }
        // An undersized source frame still gets a clipped, ellipsized first row.
        if (!capacity && wrapped.length) {
          capacity = 1;
          const ink = font.inkBoundsAtSize(wrapped[0] + '...', fontSize);
          baselineOffset = options.baselineOffset ?? Math.min(ink.ascent + padding, Math.max(0, height - ink.descent - padding));
        }
      }
      const lines = wrapped.slice(0, capacity);
      let truncated = wrapped.length > capacity;
      const graphemes = value => typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(value)].map(item => item.segment) : Array.from(value);
      const ellipsize = value => {
        let suffix = '...';
        while (suffix && font.widthOfTextAtSize(suffix, fontSize) > width) suffix = suffix.slice(1);
        const chars = graphemes(value.trimEnd());
        while (chars.length && font.widthOfTextAtSize(chars.join('') + suffix, fontSize) > width) chars.pop();
        return chars.join('').trimEnd() + suffix;
      };
      for (let i=0;i<lines.length;i++) if (font.widthOfTextAtSize(lines[i], fontSize) > width + .001 || truncated && i === lines.length-1) {
        lines[i] = ellipsize(lines[i]);truncated = true;
      }
      // 拉伸保留原基线；字体轮廓在边缘可能仅超出不足一个像素。
      // 忽略最多 0.25pt 的字形边缘误差，不改变排版、字号或真正截断的判定。
      const inkTolerance = Math.min(.25, fontSize * .025);
      const clipped = lines.some((line, index) => {
        if (!line.trim()) return false;
        const ink = font.inkBoundsAtSize?.(line, fontSize);
        const baseline = baselineOffset + index * lineHeight;
        return !!ink && (baseline - ink.ascent < -inkTolerance || baseline + ink.descent > height + inkTolerance);
      });
      const incomplete = !!normalizePdfVectorText(text).trim() && (truncated || clipped);
      const contentWidth=Math.min(width,lines.reduce((maximum,line)=>Math.max(maximum,font.widthOfTextAtSize(line,fontSize)),0));
      return {lines, fontSize, lineHeight, baselineOffset, width, height, contentWidth, truncated, clipped, incomplete, clip:true, singleLine:!!options.singleLine};
    };

const layoutPdfVectorText = (text, font, preferredSize, preferredLineHeight, width, height) => ({
      lines: wrapPdfVectorText(text, font, Math.max(1, preferredSize || 10), width),
      fontSize: Math.max(1, preferredSize || 10), lineHeight: preferredLineHeight || preferredSize * 1.2
    });
return {get isNarrativeSourceText(){return isNarrativeSourceText;},
get plainReplacementLayoutCache(){return plainReplacementLayoutCache;},
get getPlainReplacementLayouts(){return getPlainReplacementLayouts;},
get collectPlainImportedEdits(){return collectPlainImportedEdits;},
get replacementRuleCache(){return replacementRuleCache;},
get replacementCellCache(){return replacementCellCache;},
get getReplacementRules(){return getReplacementRules;},
get getReplacementCell(){return getReplacementCell;},
get paragraphRuleShifts(){return paragraphRuleShifts;},
get moveReplacementClosingRules(){return moveReplacementClosingRules;},
get prepareReplacementParagraphFlow(){return prepareReplacementParagraphFlow;},
get prepareImportedReplacementLayouts(){return prepareImportedReplacementLayouts;},
get getReplacementLineHeight(){return getReplacementLineHeight;},
get positionReplacementParagraph(){return positionReplacementParagraph;},
get applyPlainImportedText(){return applyPlainImportedText;},
get plainTextCovers(){return plainTextCovers;},
get removePlainTextCover(){return removePlainTextCover;},
get normalizePdfVectorText(){return normalizePdfVectorText;},
get wrapPdfVectorText(){return wrapPdfVectorText;},
get layoutFixedPdfText(){return layoutFixedPdfText;},
get layoutPdfVectorText(){return layoutPdfVectorText;}};
}});

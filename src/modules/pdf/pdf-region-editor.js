
/** 页面输入和显示统一使用 CSS px；仅在保存到 PDF 排版模型时换算，缩放后位置及字号一致。 */

  export const PDFRegionEditor = Object.freeze({ create: app => {
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    const overrides = new Map(), edited = new Set(), attributes = new WeakMap(), selector = '[data-id]';
    const canEdit=()=>!!app.mergeApi?.unmergeLocked&&!app.jsonFileInput.dataset.importing&&app.viewerContainer.classList.contains('show-span-boundaries');
    const regionId=element=>element.dataset.id?.replace(/-replacement$/, '');
    // 溢出框可能窄到连省略号都无法显示；显示文本为空仍须允许调整。
    const editable=element=>!!regionId(element)&&(element.dataset.textOverflow==='1'||!!element.textContent.trim())
      &&(element.dataset.textOverflow==='1'||element.dataset.spanBoundary==='1'||element.classList.contains('is-merged')||edited.has(regionId(element)));
    let target = null, busy = false, generation = 0, opener = null, timer = null, selectedId = null, navigationEpoch = 0, navigating = false;
    const navigationQueue=[];
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-font-dialog pdf-region-dialog';
    dialog.setAttribute('aria-labelledby', 'regionEditorTitle');
    dialog.innerHTML = `<form novalidate>
      <h2 id="regionEditorTitle">调整文字区域</h2>
      <label>字号（px）<input name="fontSize" type="number" min="1" max="200" step="1" inputmode="numeric" required></label>
      <label>行间距（px）<input name="lineHeight" type="number" min="1" max="300" step="1" inputmode="numeric" required></label>
      <p class="region-error" role="alert" aria-live="polite"></p>
      <div class="font-actions"><button type="button" data-reset>恢复默认</button><button type="button" data-cancel>取消</button><button type="submit">应用</button></div>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form'), error = dialog.querySelector('.region-error');
    const fields = Object.fromEntries(['fontSize','lineHeight'].map(name => [name, dialog.querySelector(`[name="${name}"]`)]));
    // 输入及粘贴统一为整数 px；PDF 排版模型仍按页面比例换算。
    const normalizeInteger=input=>{
      if(!input.value.trim())return;
      const value=Number(input.value);
      input.value=Number.isFinite(value)&&value>=0?String(Math.round(value)):'';
    };
    for(const input of Object.values(fields)){
      input.addEventListener('beforeinput',event=>{if(event.data&&/[^0-9]/.test(event.data))event.preventDefault();});
      input.addEventListener('keydown',event=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['.',',','e','E','+','-'].includes(event.key))event.preventDefault();});
      input.addEventListener('input',()=>normalizeInteger(input));
      input.addEventListener('change',()=>normalizeInteger(input));
      input.addEventListener('paste',event=>{
        event.preventDefault();
        const text=event.clipboardData?.getData('text')?.trim(),value=Number(text);
        if(text&&Number.isFinite(value)&&value>=0)input.value=String(Math.round(value));
      });
    }
    const close = () => {
      if (busy) return;
      target = null;
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
      opener = null;
    };
    const decorate = element => {
      const active=editable(element);
      if(active&&regionId(element)===selectedId)element.dataset.regionSelected='1';else delete element.dataset.regionSelected;
      if(active){
        const lines=app.overflowApi.getLayout(element)?.lines||element.textContent.split(/\r?\n/);
        const count=String(Math.max(1,lines.length));
        if(element.dataset.regionLines!==count)element.dataset.regionLines=count;
        if(overrides.has(regionId(element)))element.dataset.regionCustom='1';else delete element.dataset.regionCustom;
      }else{delete element.dataset.regionLines;delete element.dataset.regionCustom;}
      if(active){
        if(!attributes.has(element))attributes.set(element,Object.fromEntries(['tabindex','role','title','aria-label','aria-disabled'].map(name=>[name,element.getAttribute?.(name)??null])));
        element.dataset.regionEditable='1';
        if(!canEdit()){
          element.setAttribute('aria-disabled','true');element.setAttribute('tabindex','-1');
          element.setAttribute('title',!app.mergeApi?.unmergeLocked?'导入 JSON 替换内容后可调整区域':'当前为只读状态');
        }else{
          element.removeAttribute('aria-disabled');
          element.setAttribute('tabindex','0');element.setAttribute('role','button');
        }
        if(canEdit()&&element.dataset.textOverflow!=='1'){
          element.setAttribute('tabindex','0');element.setAttribute('role','button');
          element.setAttribute('title','单击选中；空格选中本页首框，Tab下一个，Shift＋Tab上一个；双击或Enter调整字号和行间距');
          element.setAttribute('aria-label','文字区域，空格选中本页首框，Tab下一个，Shift加Tab上一个；方向键移动，Ctrl加方向键调整宽高，Enter调整字号和行间距');
        }
      }else if(element.dataset.regionEditable){
        delete element.dataset.regionEditable;
        const saved=attributes.get(element);
        if(saved)for(const [name,value]of Object.entries(saved))if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);
        attributes.delete(element);
      }
    };
    const decorateAll=(scope=app.viewerDiv)=>scope.querySelectorAll(selector).forEach(decorate);
    const select=element=>{selectedId=element?regionId(element):null;decorateAll();app.regionResize?.selectionChanged?.();element?.focus({preventScroll:true});};
    const dirtyPages=new Set();let decorateWholeDocument=false;
    const schedule=changes=>{
      for(const change of changes||[]){
        const page=change.target?.closest?.('.page');
        if(page)dirtyPages.add(page);else decorateWholeDocument=true;
      }
      if(timer!==null)return;
      timer=setTimeout(()=>{
        timer=null;
        if(decorateWholeDocument)decorateAll();else for(const page of dirtyPages)if(page.isConnected)decorateAll(page);
        dirtyPages.clear();decorateWholeDocument=false;
      },32);
    };
    // Stable IDs recover editing targets when PDF.js rebuilds a page or zooms.
    const observer=typeof MutationObserver==='function'?new MutationObserver(schedule):null;
    observer?.observe(app.viewerDiv,{subtree:true,childList:true,attributes:true,attributeFilter:['data-id','data-text-overflow','data-span-boundary','class']});
    const has = id => overrides.has(id);
    const pages = () => new Set([...overrides.keys()].map(id => Number(/^p(\d+)-/.exec(id)?.[1])).filter(Number.isInteger));
    const measure = (font, style = {}) => ({
      ...font,
      widthOfTextAtSize: (text, size) => Math.max(0, font.widthOfTextAtSize(text, size)
        + Math.max(0, [...text].length - 1) * (style.letterSpacing || 0)
        + (text.match(/[ \u00a0]/g) || []).length * (style.wordSpacing || 0))
    });
    const layout = (id, text, font, base) => {
      const style = overrides.get(id);
      if (!style) return base;
      const frame = {...(style.frame || base),alignment:'left'};
      const result = app.layoutFixedPdfText(text, measure(font, style), style.fontSize, style.lineHeight,
        frame.width, frame.height, { singleLine: !!frame.singleLine, baselineOffset:style.positionBaseline });
      return { ...base, ...frame, ...result, alignment:'left', text:base.text??text, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing };
    };
    const limits = { fontSize:[1,200], letterSpacing:[-5,30], wordSpacing:[-5,40], lineHeight:[1,300] };
    const validate = value => {
      for (const [key,[min,max]] of Object.entries(limits)) if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error('请输入各输入框允许范围内的数值。');
    };
    const set = (id, value) => {
      if (!/^p\d+-/.test(id)) throw new Error('未找到区域编号。');
      validate(value);
      edited.add(id);
      overrides.set(id, { ...value, frame: value.frame ? {...Object.fromEntries(['x','top','offsetX','offsetY','width','height','singleLine','alignment','rotated','fixedBounds'].filter(key=>value.frame[key]!==undefined).map(key=>[key,value.frame[key]])),alignment:'left'} : undefined });
    };
    const locate = event => {
      if(!canEdit()||app.mergeMode||app.unmergeMode||app.smartMerge.running||app.jsonFileInput.dataset.importing)return null;
      const direct = event.target.closest?.(selector);
      if (direct && app.viewerDiv.contains(direct) && editable(direct)) return direct;
      const page = event.target.closest?.('.page');
      if (!page || !app.viewerDiv.contains(page) || !Number.isFinite(event.clientX)) return null;
      return [...page.querySelectorAll(selector)].filter(editable).map(element => ({ element, rect:element.getBoundingClientRect() }))
        .filter(({element,rect}) => {
          const padding=element.dataset.textOverflow==='1'&&rect.width<8?4:2;
          return rect.height>0&&event.clientX>=rect.left-padding&&event.clientX<=rect.right+padding&&event.clientY>=rect.top-padding&&event.clientY<=rect.bottom+padding;
        })
        .sort((a,b) => a.rect.width*a.rect.height-b.rect.width*b.rect.height)[0]?.element || null;
    };
    const resolve = async element => {
      if(!app.pdfDoc)return null;
      const doc=app.pdfDoc,pageNum=Number(element.closest('.page')?.dataset.pageNumber),id=regionId(element);
      if(!id||!pageNum)return null;
      const record=app.mergeRecords.find(record=>record.dataId===id),layouts=await app.getPlainReplacementLayouts(pageNum);
      if(app.pdfDoc!==doc)return null;
      const scale=app.getPageScale(pageNum),model=record?.replacementFixed||layouts.get(id)||app.overflowApi.getLayout(element);
      const css=getComputedStyle(element),rect=element.getBoundingClientRect();
      const match=/^matrix\(([^)]+)\)$/.exec(css.transform||''),raw=match?match[1].split(',').map(Number):[1,0,0,1,0,0];
      const sx=Math.hypot(raw[0],raw[1])||1,sy=Math.hypot(raw[2],raw[3])||1;
      // 原生文本层的 scaleX 用于匹配字宽。尺寸先换算为可见宽高，悬停时不能重复缩放。
      const boundaryMatrix=model?null:[raw[0]/sx,raw[1]/sx,raw[2]/sy,raw[3]/sy,0,0];
      const base=model||{fontSize:parseFloat(css.fontSize)/scale,lineHeight:parseFloat(css.lineHeight)/scale||parseFloat(css.fontSize)/scale*1.2,
        width:(Number.isFinite(parseFloat(css.width))?parseFloat(css.width)*sx:rect.width)/scale,
        height:(Number.isFinite(parseFloat(css.height))?parseFloat(css.height)*sy:rect.height)/scale,singleLine:!/[\r\n]/.test(element.textContent)};
      const view=app.pdfViewer?.getPageView(pageNum-1),pageRect=element.closest('.page').getBoundingClientRect();
      const m=boundaryMatrix||raw,w=base.width*scale,h=base.height*scale;
      const originLeft=rect.left-Math.min(0,m[0]*w,m[2]*h,m[0]*w+m[2]*h),originTop=rect.top-Math.min(0,m[1]*w,m[3]*h,m[1]*w+m[3]*h);
      const point=view?.viewport?.convertToPdfPoint?.(originLeft-pageRect.left,originTop-pageRect.top);
      const origin={x:record?.leftPt??point?.[0]??(originLeft-pageRect.left)/scale,top:record?.topPt??(point?view.pdfPage.view[3]-point[1]:(originTop-pageRect.top)/scale)};
      // 优先使用当前PDF布局的首行基线。首次编辑原生文本时，从源文字坐标恢复，
      // 避免把浏览器行盒高度当成PDF的字形基线。
      let baselineOffset=base.baselineOffset;
      if(!Number.isFinite(baselineOffset)){
        const index=Number(element.dataset.sourceIndex||/^p\d+-(\d+)$/.exec(id)?.[1]);
        if(index>0&&app.getPageTextContent&&view?.viewport?.convertToViewportPoint){
          const content=await app.getPageTextContent(pageNum);
          if(app.pdfDoc!==doc)return null;
          const item=content.items.filter(item=>item.str?.trim())[index-1];
          if(item?.transform){
            const point=view.viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
            const [a,b,c,d]=m,det=a*d-b*c,dx=point[0]+pageRect.left-originLeft,dy=point[1]+pageRect.top-originTop;
            if(Math.abs(det)>.00001)baselineOffset=(-b*dx+a*dy)/det/scale;
          }
        }
        if(!Number.isFinite(baselineOffset)||baselineOffset<0)baselineOffset=app.getPreviewBaselineOffset(css.fontFamily,base.fontSize*scale,base.lineHeight*scale,element.textContent,'400')/scale;
      }
      const saved=overrides.get(id),style={fontSize:saved?.fontSize??base.fontSize,lineHeight:saved?.lineHeight??base.lineHeight,letterSpacing:saved?.letterSpacing||0,wordSpacing:saved?.wordSpacing||0,positionBaseline:saved?.positionBaseline??baselineOffset};
      let frame={...origin,...base,...saved?.frame},boundarySourceFrame=null,boundaryShift=null;
      // 完整单行的蓝框贴合文字；首次编辑/拉伸同样使用该可见范围。
      if(!saved&&model?.singleLine&&!model.incomplete&&!model.truncated&&!model.clipped&&model.contentWidth>0&&model.contentWidth<model.width){
        boundarySourceFrame={...frame};
        const shift=model.alignment==='center'?(model.width-model.contentWidth)/2:model.alignment==='right'?model.width-model.contentWidth:0;
        const matrix=/^matrix\(([^)]+)\)$/.exec(css.transform||''),m=matrix?matrix[1].split(',').map(Number):[1,0,0,1,0,0];
        boundaryShift={x:m[0]*shift*scale,y:m[1]*shift*scale};
        const [a,b,c,d]=view?.viewport?.transform||[scale,0,0,-scale,0,0],det=a*d-b*c;
        const dx=(d*boundaryShift.x-c*boundaryShift.y)/det,dy=-(-b*boundaryShift.x+a*boundaryShift.y)/det;
        frame={...frame,x:frame.x+dx,top:frame.top+dy,width:model.contentWidth,offsetX:(frame.offsetX||0)+dx,offsetY:(frame.offsetY||0)+dy};
      }
      return {id,pageNum,doc,frame,boundarySourceFrame,boundaryShift,boundaryMatrix,element,style,base,record,scale,
        text:app.importedTexts.get(id)??record?.mergedText??base.text??element.dataset.jsonLogicalText??element.dataset.jsonOriginalText??element.textContent,
        family:base.family||record?.importedFontFamily||record?.fontFamily||css.fontFamily,
        color:base.color||record?.fontColor||'rgb(0, 0, 0)'};
    };
    const open = async element => {
      if(!canEdit()||busy||!app.pdfDoc||app.regionResize?.dragging)return;
      if(app.smartMerge.running||app.jsonFileInput.dataset.importing){app.setStatus('请等待当前处理完成后再调整区域。');return;}
      const sequence=++generation,current=await resolve(element);
      if(!canEdit()||!current||sequence!==generation)return;
      target=current;
      const {style,id,pageNum}=current;
      for(const [name,input] of Object.entries(fields)){
        input.value=String(Math.round(style[name]*current.scale));
        input.min=String(Math.ceil(limits[name][0]*current.scale));
        input.max=String(Math.floor(limits[name][1]*current.scale));
        input.step='1';
      }
      error.textContent='';opener=document.activeElement;
      if(!dialog.open)dialog.showModal();fields.fontSize.focus();
    };
    const refresh = async current => {
      app.invalidateImportedBackground(current.pageNum);
      await app.yieldPdfUi();
      await app.prepareImportedReplacementLayouts(current.pageNum);
      if (current.doc !== app.pdfDoc) return;
      app.applyImportedTexts(current.pageNum,{deferBackground:true});
      await app.refreshImportedPageBackgrounds(current.pageNum,{layoutsPrepared:true});
      if (current.doc === app.pdfDoc) {
        const page=app.pdfViewer.getPageView(current.pageNum-1)?.div||app.viewerDiv;
        decorateAll(page);app.overflowApi.scan(page);
      }
    };
    const apply = async reset => {
      if (!canEdit() || !target || busy || target.doc !== app.pdfDoc) return;
      const current = target, previous = overrides.get(current.id), previouslyEdited=edited.has(current.id), sequence=generation;
      try {
        if(!reset&&Object.values(fields).some(input=>!/^\d+$/.test(input.value.trim())||!Number.isSafeInteger(Number(input.value))))throw new Error('字号和行间距请输入整数。');
        if (reset) overrides.delete(current.id);
        else {
          const values=Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,input.value.trim()?Number(input.value)/current.scale:NaN]));
          set(current.id,{...current.style,...values,positionBaseline:Number.isFinite(current.style.positionBaseline)?current.style.positionBaseline*values.fontSize/current.style.fontSize:undefined,frame:current.frame});
        }
        busy = true;
        form.querySelectorAll('button,input').forEach(element => element.disabled = true);
        error.textContent = '正在更新此区域…';
        await refresh(current);
        if (current.doc !== app.pdfDoc) return;
        busy = false;close();app.setStatus(reset ? '已恢复该区域的默认排版。' : '已更新该区域的字号和行间距。');
      } catch (err) {
        if(!busy){error.textContent=err.message;return;}
        if (current.doc === app.pdfDoc) {
          if (previous) overrides.set(current.id, previous); else overrides.delete(current.id);
          if(!previouslyEdited)edited.delete(current.id);
          try { await refresh(current); } catch (restoreError) { console.warn('区域预览恢复失败:', restoreError); }
          error.textContent = err.message || '区域更新失败，请重试。';
        }
      } finally {
        if(sequence===generation){busy=false;form.querySelectorAll('button,input').forEach(element=>element.disabled=false);}
      }
    };
    const transform = async (current,frame,moving=false) => {
      if(!canEdit())throw new Error(!app.mergeApi?.unmergeLocked?'请先导入 JSON 替换内容，再调整区域。':app.jsonFileInput.dataset.importing?'JSON 正在导入，请稍候再编辑。':'预览模式只读，请先点击“显示边界”再编辑。');
      if(busy||dialog.open||current.doc!==app.pdfDoc)throw new Error('页面正在处理，请稍后重试。');
      frame={...current.frame,...frame,...(moving?{}:{singleLine:false})};
      if(!Number.isFinite(frame.width)||!Number.isFinite(frame.height)||frame.width<=0||frame.height<=0||moving&&(!Number.isFinite(frame.x)||!Number.isFinite(frame.top)))throw new Error('区域尺寸无效。');
      const previous=overrides.get(current.id),previouslyEdited=edited.has(current.id),sequence=++generation;
      busy=true;
      try{
        set(current.id,{...current.style,positionBaseline:current.style.positionBaseline??current.base?.baselineOffset,frame});
        await refresh(current);
        if(current.doc===app.pdfDoc)app.setStatus(moving?'已移动区域。':'已调整区域大小。');
      }catch(err){
        if(current.doc===app.pdfDoc){
          if(previous)overrides.set(current.id,previous);else overrides.delete(current.id);
          if(!previouslyEdited)edited.delete(current.id);
          try{await refresh(current);}catch(restoreError){console.warn('区域预览恢复失败:',restoreError);}
        }
        throw err;
      }finally{if(sequence===generation)busy=false;}
    };
    form.addEventListener('submit', event => { event.preventDefault(); return apply(false); });
    dialog.querySelector('[data-reset]').addEventListener('click', () => apply(true));
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    document.addEventListener('click', event => {
      if(app.regionResize?.suppressClick){event.preventDefault();event.stopImmediatePropagation();return;}
      const element=locate(event);
      if(!element){
        if(canEdit()&&!app.mergeMode&&!app.unmergeMode&&!app.smartMerge.running&&!app.jsonFileInput.dataset.importing&&app.viewerDiv.contains(event.target)){
          select(null);
          if(!event.target.closest?.('a,button,input,textarea,select,[contenteditable]'))app.viewerContainer.focus({preventScroll:true});
        }
        return;
      }
      event.preventDefault();event.stopImmediatePropagation();
      select(element);
    },true);
    document.addEventListener('dblclick',event=>{
      if(app.regionResize?.suppressClick){event.preventDefault();event.stopImmediatePropagation();return;}
      const element=locate(event);
      if(!element)return;
      event.preventDefault();event.stopImmediatePropagation();
      select(element);
      open(element).catch(err=>app.setStatus(`无法打开区域设置：${err.message}`));
    },true);
    const canNavigate=()=>canEdit()&&!!app.pdfDoc&&(!busy||app.regionResize?.keyboardPending)&&!dialog.open&&!app.mergeMode&&!app.unmergeMode&&!app.smartMerge.running&&!app.regionResize?.dragging;
    const pageRegions=page=>{
      app.boundaries?.refresh();decorateAll(page);
      const seen=new Set();
      return [...page.querySelectorAll(selector)].filter(element=>{
        if(!editable(element))return false;
        const css=getComputedStyle(element),rect=element.getBoundingClientRect(),id=regionId(element);
        if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||css.opacity==='0'||(rect.width<=0&&element.dataset.textOverflow!=='1')||rect.height<=0||seen.has(id))return false;
        seen.add(id);return true;
      }).map(element=>({element,rect:element.getBoundingClientRect()}))
        .sort((a,b)=>a.rect.top-b.rect.top||a.rect.left-b.rect.left).map(item=>item.element);
    };
    const selectByKey=async direction=>{
      const doc=app.pdfDoc,epoch=navigationEpoch,fromId=selectedId;
      const valid=()=>doc===app.pdfDoc&&epoch===navigationEpoch&&fromId===selectedId&&canNavigate();
      await app.regionResize?.whenKeyboardSettled?.();
      if(!valid())return false;
      const currentPage=Math.max(1,Math.min(doc.numPages,app.pdfViewer.currentPageNumber||1));
      const start=direction&&fromId?Number(/^p(\d+)-/.exec(fromId)?.[1])||currentPage:currentPage;
      const step=direction||1;
      for(let number=start;number>=1&&number<=doc.numPages;number+=step){
        await app.smartMerge.ensurePageTextLayer(number);
        if(!valid())return false;
        const page=app.pdfViewer.getPageView(number-1)?.div;
        if(page){
          const regions=pageRegions(page),found=direction&&number===start&&fromId?regions.findIndex(element=>regionId(element)===fromId):-1;
          const index=direction===0?0:(found>=0?found:direction>0?-1:regions.length)+direction;
          const next=regions[index];
          if(next){select(next);next.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});return true;}
        }
        if(direction===0)break;
      }
      app.setStatus(direction===0?'当前页没有可选中的文字框。':fromId?(direction>0?'已选中最后一个框。':'已选中第一个框。'):'没有可选中的文字框。');
      return true;
    };
    const navigate=async()=>{
      if(navigating)return;
      navigating=true;
      const epoch=navigationEpoch;
      try{
        while(epoch===navigationEpoch&&navigationQueue.length&&canNavigate()){
          if(!await selectByKey(navigationQueue.shift())){if(epoch===navigationEpoch)navigationQueue.length=0;break;}
        }
      }catch(error){if(epoch===navigationEpoch){navigationQueue.length=0;app.setStatus(`无法切换文字框：${error.message}`);}}
      finally{
        navigating=false;
        if(epoch===navigationEpoch)navigationQueue.length=0;
        if(navigationQueue.length&&canNavigate())void navigate();
      }
    };
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        navigationEpoch++;navigationQueue.length=0;
        select(null);app.regionResize?.reset();
        return;
      }
      const within=event.target===app.viewerContainer||app.viewerDiv.contains(event.target);
      if(!within||!canNavigate()||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.target.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),dialog'))return;
      if(event.key===' '||event.key==='Tab'){
        event.preventDefault();event.stopImmediatePropagation();
        navigationQueue.push(event.key===' '?0:event.shiftKey?-1:1);void navigate();return;
      }
      if(event.key!=='Enter')return;
      const element=event.target.closest?.(selector);
      if(!element||!editable(element))return;
      event.preventDefault();event.stopImmediatePropagation();
      select(element);open(element).catch(err=>app.setStatus(`无法打开区域设置：${err.message}`));
    },true);
    return Object.freeze({ get canEdit(){return canEdit();}, select, get selected(){return [...app.viewerDiv.querySelectorAll(selector)].find(element=>regionId(element)===selectedId&&editable(element))||null;}, has, pages, measure, layout, set, resolve, suspend:()=>{navigationEpoch++;navigationQueue.length=0;if(!busy){generation++;close();}}, snapshot:()=>({overrides:[...overrides],edited:[...edited]}), restore:saved=>{overrides.clear();edited.clear();for(const [id,value] of saved.overrides)set(id,value);for(const id of saved.edited)edited.add(id);decorateAll();}, resize:(current,frame)=>transform(current,frame), move:(current,frame)=>transform(current,frame,true), find:locate, get editing(){return busy||dialog.open;}, remove:id=>{edited.delete(id);const removed=overrides.delete(id);decorateAll();return removed;}, refresh:decorateAll, get:id=>overrides.get(id), get size(){return overrides.size;},
      reset() { navigationEpoch++;navigationQueue.length=0;dirtyPages.clear();decorateWholeDocument=false;generation++;selectedId=null;overrides.clear();edited.clear();if(timer!==null){clearTimeout(timer);timer=null;}decorateAll();busy=false;target=null;opener=null;error.textContent='';form.querySelectorAll('button,input').forEach(element=>element.disabled=false);if(dialog.open)dialog.close(); }
    });
  }});

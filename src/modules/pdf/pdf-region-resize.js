import * as PDFLib from 'pdf-lib'
import { pdfjsLib } from '@/services/pdf-runtime.js'
/** 区域拖拽改宽高，页面操作统一以 CSS px 计算，保存时换算 PDF 坐标；不缩放字形或字号。 */

  export const PDFRegionResize =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    // 与实线边框相同的顶部外扩量；文本预览在 clip 内抵消此偏移。
    const frameTopGap=2;
    const overlay=document.createElement('div'),preview=document.createElement('div'),clip=document.createElement('div'),erase=document.createElement('canvas');
    overlay.className='region-resize-overlay';clip.className='region-resize-clip';preview.className='region-resize-preview';erase.className='region-resize-erase';
    overlay.hidden=erase.hidden=true;preview.hidden=true;clip.append(preview);overlay.append(clip);
    for(const [axis,name]of [['move','拖动移动区域'],['x','拖动调整宽度'],['y','拖动调整高度']]){
      const button=document.createElement('button');button.type='button';button.className='region-resize-handle';button.dataset.axis=axis;button.hidden=true;button.title=axis==='move'?'拖动移动区域；方向键微调，Shift 加速':name;if(axis==='move')button.textContent='✥';button.setAttribute('aria-label',button.title);overlay.append(button);
    }
    document.body.append(erase,overlay);
    let current=null,drag=null,sequence=0,suppressedUntil=0,pointerTarget=null;
    // 链接注释层可能盖住文字；实际命中框时也同步最上层元素的光标。
    const setRegionPointer=target=>{
      if(target===pointerTarget)return;
      pointerTarget?.removeAttribute('data-region-pointer');
      pointerTarget=target?.setAttribute?target:null;
      pointerTarget?.setAttribute('data-region-pointer','1');
    };
    const boundaryObserver=new MutationObserver(()=>{
      if(current&&!drag){overlay.dataset.selected=current.element.dataset.regionSelected==='1'?'1':'0';
      overlay.dataset.incomplete=current.element.dataset.textOverflow==='1'?'1':'0';overlay.dataset.multiline=current.element.dataset.regionLines==='1'?'0':'1';}
    });
    const matrix=element=>{
      const match=/^matrix\(([^)]+)\)$/.exec(getComputedStyle(element).transform||'');
      const values=match?match[1].split(',').map(Number):[1,0,0,1,0,0];
      return values.every(Number.isFinite)&&Math.abs(values[0]*values[3]-values[1]*values[2])>.00001?values:[1,0,0,1,0,0];
    };
    const geometry=info=>{
      const sourceRect=info.element.getBoundingClientRect(),m=info.boundaryMatrix||matrix(info.element),source=info.boundarySourceFrame||info.frame,w=source.width*info.scale,h=source.height*info.scale;
      const xs=[0,m[0]*w,m[2]*h,m[0]*w+m[2]*h],ys=[0,m[1]*w,m[3]*h,m[1]*w+m[3]*h];
      const origin={x:sourceRect.left-Math.min(...xs)+(info.boundaryShift?.x||0),y:sourceRect.top-Math.min(...ys)+(info.boundaryShift?.y||0)};
      if(!info.boundarySourceFrame)return {m,origin,rect:sourceRect};
      const width=info.frame.width*info.scale,height=info.frame.height*info.scale;
      const vx=[0,m[0]*width,m[2]*height,m[0]*width+m[2]*height],vy=[0,m[1]*width,m[3]*height,m[1]*width+m[3]*height];
      const left=origin.x+Math.min(...vx),top=origin.y+Math.min(...vy),right=origin.x+Math.max(...vx),bottom=origin.y+Math.max(...vy);
      return {m,origin,rect:{left,top,right,bottom,width:right-left,height:bottom-top}};
    };
    const showEdge=axis=>{
      for(const button of overlay.querySelectorAll('.region-resize-handle'))button.hidden=button.dataset.axis!==axis;
    };
    const edgeAt=(info,event)=>{
      if(!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return null;
      const {m,origin}=geometry(info),w=info.frame.width*info.scale,h=info.frame.height*info.scale;
      const point=(x,y)=>({x:origin.x+m[0]*x+m[2]*y,y:origin.y+m[1]*x+m[3]*y});
      const distance=(a,b)=>{
        const x=b.x-a.x,y=b.y-a.y,length=x*x+y*y;
        if(length<.00001)return Infinity;
        const t=Math.max(0,Math.min(1,((event.clientX-a.x)*x+(event.clientY-a.y)*y)/length));
        return Math.hypot(event.clientX-a.x-t*x,event.clientY-a.y-t*y);
      };
      const edges=[['x',point(w,-frameTopGap),point(w,h)],['y',point(0,h),point(w,h)]];
      const nearest=edges.map(([axis,a,b])=>({axis,distance:distance(a,b)})).sort((a,b)=>a.distance-b.distance)[0];
      return nearest.distance<=7?nearest.axis:null;
    };
    const actionAt=(info,event)=>{
      if(!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return null;
      const {origin,m}=geometry(info);
      return Math.hypot(event.clientX-origin.x+m[2]*frameTopGap,event.clientY-origin.y+m[3]*frameTopGap)<=20?'move':edgeAt(info,event);
    };
    const position=(info,frame=info.frame,g=geometry(info))=>{
      Object.assign(overlay.style,{left:`${g.origin.x-g.m[2]*frameTopGap}px`,top:`${g.origin.y-g.m[3]*frameTopGap}px`,width:`${frame.width*info.scale}px`,height:`${frame.height*info.scale+frameTopGap}px`,transform:`matrix(${g.m.slice(0,4).join(',')},0,0)`});
      overlay.dataset.selected=info.element.dataset.regionSelected==='1'?'1':'0';
      overlay.dataset.incomplete=info.element.dataset.textOverflow==='1'?'1':'0';
      overlay.dataset.multiline=info.element.dataset.regionLines==='1'?'0':'1';
      info.element.dataset.regionOverlayActive='1';
      overlay.dataset.dragging=drag?.moved?'1':'0';
      if(drag?.moved)info.element.dataset.regionOverlayDragging='1';else delete info.element.dataset.regionOverlayDragging;
      overlay.hidden=false;
    };
    const clearActive=()=>{boundaryObserver.disconnect();current?.element.removeAttribute('data-region-overlay-active');current?.element.removeAttribute('data-region-overlay-dragging');};
    const hide=()=>{if(drag)return;setRegionPointer(null);showEdge(null);clearActive();current=null;sequence++;overlay.hidden=true;};
    const show=async (element,event)=>{
      if(!app.regionEditor.canEdit||app.mergeMode||app.unmergeMode){hide();return;}
      if(drag||app.regionEditor.editing||!app.pdfDoc||!keyboardOutline.hidden)return;
      if(current?.element===element&&element.isConnected&&Math.abs(current.scale-app.getPageScale(current.pageNum))<.0001){sequence++;position(current);showEdge(actionAt(current,event));return;}
      const own=++sequence,info=await app.regionEditor.resolve(element);
      if(!info||own!==sequence||drag||app.regionEditor.editing||!app.regionEditor.canEdit)return;
      clearActive();current=info;boundaryObserver.observe(element,{attributes:true,attributeFilter:['data-text-overflow','data-region-lines','data-region-selected']});position(info);showEdge(actionAt(info,event));
    };
    const shiftFrame=(info,dx,dy)=>{
      const t=app.pdfViewer.getPageView(info.pageNum-1).viewport.transform||[info.scale,0,0,-info.scale,0,0];
      const [a,b,c,d]=t,det=a*d-b*c;
      const x=(d*dx-c*dy)/det,y=-(-b*dx+a*dy)/det;
      return {...info.frame,alignment:'left',x:info.frame.x+x,top:info.frame.top+y,offsetX:(info.frame.offsetX||0)+x,offsetY:(info.frame.offsetY||0)+y};
    };
    const resizedFrame=(info,g,axis,dx,dy)=>{
      if(axis!=='x'&&axis!=='y')return {frame:{...info.frame},geometry:g};
      const [a,b,c,d]=g.m,det=a*d-b*c,scale=info.scale;
      const localX=(d*dx-c*dy)/det/scale,localY=(-b*dx+a*dy)/det/scale;
      const page=info.element.closest('.page').getBoundingClientRect(),minimum=4/scale;
      const isX=axis==='x',length=isX?info.frame.width:info.frame.height;
      let lo=minimum-length,hi=Infinity;
      // 只移动被拖动的边，对边固定；在屏幕坐标中约束边的两个端点，兼容旋转。
      for(const end of [0,isX?info.frame.height:info.frame.width]){
        const x=isX?info.frame.width:end,y=isX?end:info.frame.height;
        const px=g.origin.x+(a*x+c*y)*scale,py=g.origin.y+(b*x+d*y)*scale;
        for(const [velocity,base,min,max]of [[(isX?a:c)*scale,px,page.left+.5,page.right-.5],[(isX?b:d)*scale,py,page.top+.5,page.bottom-.5]]){
          if(Math.abs(velocity)<.00001)continue;
          const first=(min-base)/velocity,last=(max-base)/velocity;
          lo=Math.max(lo,Math.min(first,last));hi=Math.min(hi,Math.max(first,last));
        }
      }
      const delta=lo<=hi?Math.max(lo,Math.min(hi,isX?localX:localY)):0;
      const frame={...info.frame,[isX?'width':'height']:length+delta,singleLine:false,alignment:'left'};
      return {frame,geometry:g};
    };
    const clampedFrame=(info,g,axis,dx,dy)=>resizedFrame(info,g,axis,dx,dy).frame;
    const movedFrame=(info,g,dx,dy)=>{
      const page=info.element.closest('.page').getBoundingClientRect(),rect=g.rect;
      const clamp=(value,lo,hi)=>lo<=hi?Math.max(lo,Math.min(hi,value)):0;
      dx=clamp(dx,page.left+.5-rect.left,page.right-.5-rect.right);
      dy=clamp(dy,page.top+.5-rect.top,page.bottom-.5-rect.bottom);
      return {frame:shiftFrame(info,dx,dy),geometry:{...g,origin:{x:g.origin.x+dx,y:g.origin.y+dy}}};
    };
    // Paint only a temporary paper/background patch. Original rules and shading
    // stay visible while old letters are erased during the live text preview.
    const preparePaper=async state=>{
      let task=null;
      try{
        await app.prepareImportedFonts();
        if(drag!==state||state.phase!=='drag'||state.info.doc!==app.pdfDoc)return false;
        const doc=await app.loadEditablePdf(),one=await PDFLib.PDFDocument.create(),[page]=await one.copyPages(doc,[state.info.pageNum-1]);one.addPage(page);
        const match=/^p\d+-(\d+)$/.exec(state.info.id);
        let indices=state.info.record?app.getMergeSourceIndices(state.info.record):match?[+match[1]]:[];
        if(!indices.length){const row=(await app.getPageAnnotationTexts(state.info.pageNum)).find(row=>row.id===state.info.id);indices=row?.sourceItems.map(source=>source.index)||[];}
        const boxes=app.getOriginalSourceBoxes(state.info.pageNum,indices);
        if(!boxes.length||!app.removeUnderlyingPdfText(one,page,boxes,new Map()))return false;
        if(drag!==state||state.phase!=='drag')return false;
        task=pdfjsLib.getDocument({data:await one.save(),cMapUrl:`${app.pdfResourceBase}cmaps/`,cMapPacked:true,standardFontDataUrl:`${app.pdfResourceBase}standard_fonts/`});
        const pdf=await task.promise,source=await pdf.getPage(1),view=app.pdfViewer.getPageView(state.info.pageNum-1),viewport=view.viewport.clone();
        const canvas=view.canvas||state.info.element.closest('.page').querySelector('.canvasWrapper canvas'),rect=canvas.getBoundingClientRect(),paper=document.createElement('canvas');
        paper.width=canvas.width;paper.height=canvas.height;
        const release=app.smartMerge.enableMergeFrameScheduler();
        try{await source.render({canvasContext:paper.getContext('2d'),viewport,transform:[paper.width/viewport.width,0,0,paper.height/viewport.height,0,0]}).promise;}finally{release();}
        if(drag!==state||state.suppressPreview||state.info.doc!==app.pdfDoc)return false;
        const old=state.g.rect;erase.width=Math.max(1,Math.ceil(old.width*paper.width/rect.width));erase.height=Math.max(1,Math.ceil(old.height*paper.height/rect.height));
        Object.assign(erase.style,{left:`${old.left}px`,top:`${old.top}px`,width:`${old.width}px`,height:`${old.height}px`});
        erase.getContext('2d').drawImage(paper,(old.left-rect.left)*paper.width/rect.width,(old.top-rect.top)*paper.height/rect.height,old.width*paper.width/rect.width,old.height*paper.height/rect.height,0,0,erase.width,erase.height);
        erase.hidden=false;return true;
      }catch(error){console.warn('拖动文字预览未准备完成，松开后仍会更新准确排版。',error);return false;}
      finally{if(task)await task.destroy().catch(()=>{});}
    };
    const draw=state=>{
      if(state.suppressPreview){clearActive();preview.hidden=erase.hidden=overlay.hidden=true;return;}
      position(state.info,state.frame,state.draftG||state.g);
      if(!state.font||!state.paper)return;
      const key=`${state.frame.width}:${state.frame.height}:${!!state.frame.singleLine}`;
      if(state.layoutKey!==key){
        state.layoutKey=key;
        state.layout=app.layoutFixedPdfText(state.info.text,state.metric||=app.regionEditor.measure(state.font,state.info.style),state.info.style.fontSize,state.info.style.lineHeight,state.frame.width,state.frame.height,{singleLine:!!state.frame.singleLine,baselineOffset:state.info.style.positionBaseline??state.info.base.baselineOffset});
      }
      const layout=state.layout;
      const {scale,style}=state.info;
      const baseline=state.previewBaseline??=app.getPreviewBaselineOffset(state.info.family,style.fontSize*scale,style.lineHeight*scale,state.info.text,'400');
      preview.textContent=layout.lines.join('\n');
      Object.assign(preview.style,{top:`${layout.baselineOffset*scale-baseline}px`,height:`${Math.max(state.frame.height*scale,style.lineHeight*scale)}px`,fontFamily:state.info.family,fontSize:`${style.fontSize*scale}px`,lineHeight:`${style.lineHeight*scale}px`,letterSpacing:`${style.letterSpacing*scale}px`,wordSpacing:`${style.wordSpacing*scale}px`,fontKerning:'none',fontVariantLigatures:'none',color:state.info.color,textAlign:state.frame.alignment||'left'});
      overlay.dataset.incomplete=layout.incomplete?'1':'0';overlay.dataset.multiline=layout.lines.length>1?'1':'0';preview.hidden=false;
    };
    const start=event=>{
      if(!app.regionEditor.canEdit||app.mergeMode||app.unmergeMode)return;
      const handle=event.target.closest?.('.region-resize-handle');
      if(!handle||handle.hidden||!overlay.contains(handle)||!current||drag||app.regionEditor.editing||event.button>0)return;
      if(!current.element.isConnected||Math.abs(current.scale-app.getPageScale(current.pageNum))>.0001){hide();return;}
      event.preventDefault();event.stopImmediatePropagation();
      if(app.smartMerge.running||app.jsonFileInput.dataset.importing)return;
      const state={info:current,g:geometry(current),axis:handle.dataset.axis,x:event.clientX,y:event.clientY,frame:{...current.frame,alignment:'left',...(handle.dataset.axis==='move'?{}:{singleLine:false})},pointer:event.pointerId,moved:false,phase:'drag'};drag=state;
      showEdge(state.axis);handle.setPointerCapture?.(event.pointerId);
      app.getReplacementMetrics(current.pageNum,current.text+'...',current.family,current.base.originalFontName,'normal','normal').then(font=>{if(drag===state){state.font=font;draw(state);}}).catch(console.warn);
      draw(state);
    };
    const finish=async(event,cancel=false)=>{
      const state=drag;
      if(!state||state.phase!=='drag'||event.pointerId!==undefined&&event.pointerId!==state.pointer)return;
      event.preventDefault?.();event.stopImmediatePropagation?.();
      suppressedUntil=Date.now()+300;
      if(cancel||!state.moved){drag=null;preview.hidden=erase.hidden=true;hide();return;}
      state.phase='commit';
      try{await app.regionEditor[state.axis==='move'?'move':'resize'](state.info,state.frame);}
      catch(error){if(state.info.doc===app.pdfDoc)app.setStatus(`区域调整失败：${error.message}`);}
      finally{if(drag===state){drag=null;preview.hidden=erase.hidden=true;clearActive();current=null;if(state.info.element.isConnected&&state.info.doc===app.pdfDoc)show(state.info.element).catch(console.warn);else hide();}}
    };
    document.addEventListener('pointerdown',start,true);
    document.addEventListener('pointermove',event=>{
      if(drag){
        if(drag.phase!=='drag'||event.pointerId!==drag.pointer)return;
        event.preventDefault();event.stopImmediatePropagation();
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||= Math.hypot(dx,dy)>2;
        if(drag.moved&&!drag.paperTask){const state=drag;state.paperTask=preparePaper(state).then(ready=>{if(drag===state&&state.phase==='drag'){state.paper=ready;draw(state);}});}
        if(drag.axis==='move'){const next=movedFrame(drag.info,drag.g,dx,dy);drag.frame=next.frame;drag.draftG=next.geometry;}
        else {const next=resizedFrame(drag.info,drag.g,drag.axis,dx,dy);drag.frame=next.frame;drag.draftG=next.geometry;}draw(drag);return;
      }
      if(overlay.contains(event.target)){if(current)showEdge(actionAt(current,event));return;}
      if(app.regionEditor.editing){hide();return;}
      const element=app.regionEditor.find(event);
      setRegionPointer(element?event.target:null);
      if(element)show(element,event).catch(console.warn);
      else if(current?.element.isConnected&&actionAt(current,event))show(current.element,event).catch(console.warn);
      else hide();
    },true);
    document.addEventListener('pointerleave',()=>{if(!drag)hide();});
    document.addEventListener('pointerup',event=>finish(event),true);
    document.addEventListener('pointercancel',event=>finish(event,true),true);
    // 仅累计键盘操作；最后一次按键/松键满 1 秒后计算最终框并渲染一次。
    const selectionKey=()=>app.regionEditor.selected?.dataset.id?.replace(/-replacement$/, '');
    const keyboardQueue=[],keyboardWaiters=new Set();
    const notifyKeyboardSettled=()=>{
      if(keyboardRunning||keyboardQueue.length)return;
      for(const resolve of keyboardWaiters)resolve();keyboardWaiters.clear();
    };
    const whenKeyboardSettled=()=>keyboardRunning||keyboardQueue.length?new Promise(resolve=>keyboardWaiters.add(resolve)):Promise.resolve();
    const keyboardOutline=document.createElement('div');
    keyboardOutline.className='region-keyboard-outline';keyboardOutline.hidden=true;
    document.body.append(keyboardOutline);
    let keyboardBase=null,keyboardResolving=false,keyboardOutlineSource=null,keyboardVisualEpoch=0;
    const clearKeyboardOutline=()=>{
      keyboardVisualEpoch++;keyboardBase=null;
      keyboardOutlineSource?.removeAttribute('data-region-keyboard-active');keyboardOutlineSource=null;
      keyboardOutline.hidden=true;
    };
    let keyboardRunning=false,keyboardEpoch=0,keyboardTimer=null,lastKeyboardInput=0;
    const keyboardAllowed=()=>app.regionEditor.canEdit&&!app.mergeMode&&!app.unmergeMode&&!app.smartMerge.running&&!app.jsonFileInput.dataset.importing;
    const scheduleKeyboard=()=>{
      clearTimeout(keyboardTimer);
      keyboardTimer=setTimeout(()=>{keyboardTimer=null;void runKeyboard();},Math.max(0,1000-(Date.now()-lastKeyboardInput)));
    };
    const frameGeometry=(info,frame,g)=>{
      const [a,b,c,d]=g.m,w=frame.width*info.scale,h=frame.height*info.scale;
      const xs=[0,a*w,c*h,a*w+c*h],ys=[0,b*w,d*h,b*w+d*h];
      const left=g.origin.x+Math.min(...xs),top=g.origin.y+Math.min(...ys),right=g.origin.x+Math.max(...xs),bottom=g.origin.y+Math.max(...ys);
      return {...g,rect:{left,top,right,bottom,width:right-left,height:bottom-top}};
    };
    const keyboardDraft=(info,g,tasks)=>{
      let frame={...info.frame},resizing=false;
      for(const task of tasks){
        const draft={...info,frame};
        let next;
        if(task.resize){
          const axis=task.x?'x':'y',delta=task.x||task.y;
          const dx=(axis==='x'?g.m[0]:g.m[2])*delta,dy=(axis==='x'?g.m[1]:g.m[3])*delta;
          next=resizedFrame(draft,g,axis,dx,dy);resizing=true;
        }else next=movedFrame(draft,g,task.x,task.y);
        frame=next.frame;g=frameGeometry(info,frame,next.geometry);
      }
      return {frame,g,resizing};
    };
    const updateKeyboardOutline=async()=>{
      if(!keyboardQueue.length||!keyboardAllowed()||drag){clearKeyboardOutline();return;}
      const id=selectionKey(),doc=app.pdfDoc,epoch=keyboardEpoch;
      if(!id){clearKeyboardOutline();return;}
      if(!keyboardBase||keyboardBase.id!==id||keyboardBase.doc!==doc||keyboardBase.epoch!==epoch){
        if(keyboardResolving)return;
        keyboardResolving=true;
        const visualEpoch=keyboardVisualEpoch;
        try{
          const element=app.regionEditor.selected;
          const info=current?.element===element?current:await app.regionEditor.resolve(element);
          if(!info||visualEpoch!==keyboardVisualEpoch||id!==selectionKey()||doc!==app.pdfDoc||epoch!==keyboardEpoch||!keyboardQueue.length)return;
          keyboardBase={id,doc,epoch,info,g:geometry(info)};
        }catch(error){console.warn('键盘边框预览失败：',error);return;}
        finally{keyboardResolving=false;if(keyboardQueue.length&&visualEpoch!==keyboardVisualEpoch)void updateKeyboardOutline();}
      }
      const base=keyboardBase,element=app.regionEditor.selected;
      if(!base||!element)return;
      const tasks=keyboardQueue.filter(task=>task.id===id&&task.doc===doc&&task.epoch===epoch);
      const {frame,g}=keyboardDraft({...base.info,element},base.g,tasks);
      if(keyboardOutlineSource!==element){keyboardOutlineSource?.removeAttribute('data-region-keyboard-active');keyboardOutlineSource=element;}
      element.dataset.regionKeyboardActive='1';
      Object.assign(keyboardOutline.style,{left:`${g.origin.x-g.m[2]*frameTopGap}px`,top:`${g.origin.y-g.m[3]*frameTopGap}px`,width:`${frame.width*base.info.scale}px`,height:`${frame.height*base.info.scale+frameTopGap}px`,transform:`matrix(${g.m.slice(0,4).join(',')},0,0)`,borderColor:element.dataset.textOverflow==='1'?'#ef4444':element.dataset.regionLines==='1'?'#2563eb':'#059669'});
      keyboardOutline.hidden=false;
      // 键盘预览只画一个框，不更新文字、不创建底图或重新排版。
      hide();
    };
    const runKeyboard=async()=>{
      if(keyboardRunning||!keyboardQueue.length)return;
      if(Date.now()-lastKeyboardInput<1000){scheduleKeyboard();return;}
      keyboardRunning=true;
      const epoch=keyboardEpoch,doc=app.pdfDoc,id=selectionKey();
      const valid=()=>epoch===keyboardEpoch&&doc===app.pdfDoc&&keyboardAllowed()&&selectionKey()===id&&!drag;
      try{
        if(!valid()||app.regionEditor.editing){keyboardQueue.length=0;return;}
        const info=await app.regionEditor.resolve(app.regionEditor.selected);
        if(!info||!valid()){if(epoch===keyboardEpoch)keyboardQueue.length=0;return;}
        // 解析排版期间若又收到按键，重新等待，禁止提前刷新。
        if(Date.now()-lastKeyboardInput<1000)return;
        const tasks=keyboardQueue.splice(0).filter(task=>task.id===id&&task.doc===doc&&task.epoch===epoch);
        if(!tasks.length)return;
        const {frame,g,resizing}=keyboardDraft(info,geometry(info),tasks);
        if(!valid())return;
        if(['x','top','width','height','offsetX','offsetY'].every(key=>(frame[key]||0)===(info.frame[key]||0)))return;
        keyboardBase={id,doc,epoch,info:{...info,frame},g};
        hide();
        await app.regionEditor[resizing?'resize':'move'](info,frame);
      }catch(error){if(doc===app.pdfDoc)app.setStatus(`键盘调整失败：${error.message}`);}
      finally{
        keyboardRunning=false;
        clearKeyboardOutline();
        if(keyboardQueue.length){void updateKeyboardOutline();scheduleKeyboard();}else notifyKeyboardSettled();
      }
    };
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&drag){event.preventDefault();event.stopImmediatePropagation();return finish({},true);}
      if(!/^Arrow(Left|Right|Up|Down)$/.test(event.key)||!keyboardAllowed()||drag||app.regionEditor.editing&&!keyboardRunning||event.altKey||event.metaKey||event.isComposing||event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog'))return;
      const handle=event.target.closest?.('.region-resize-handle');
      const selected=app.regionEditor.selected||handle&&!handle.hidden&&overlay.contains(handle)&&current?.element;
      if(!selected)return;
      if(!app.regionEditor.selected)app.regionEditor.select(selected);
      event.preventDefault();event.stopImmediatePropagation();
      const step=(event.shiftKey?10:1)*(/Left|Up/.test(event.key)?-1:1);
      const x=/Left|Right/.test(event.key)?step:0,y=x?0:step;
      keyboardQueue.push({id:selectionKey(),doc:app.pdfDoc,epoch:keyboardEpoch,resize:!!event.ctrlKey,x,y});
      lastKeyboardInput=Date.now();void updateKeyboardOutline();scheduleKeyboard();
    },true);
    document.addEventListener('keyup',event=>{
      if(keyboardQueue.length&&/^Arrow(Left|Right|Up|Down)$/.test(event.key)){
        lastKeyboardInput=Date.now();scheduleKeyboard();
      }
    },true);
    document.addEventListener('click',event=>{if(Date.now()<suppressedUntil||overlay.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener('focusin',event=>{const element=app.regionEditor.find(event);if(element)show(element).catch(console.warn);},true);
    const selectionChanged=()=>{
      if(keyboardQueue.length&&keyboardQueue.some(task=>task.id!==selectionKey())){keyboardEpoch++;keyboardQueue.length=0;clearTimeout(keyboardTimer);keyboardTimer=null;clearKeyboardOutline();notifyKeyboardSettled();}
    };
    const reset=()=>{keyboardEpoch++;keyboardQueue.length=0;clearKeyboardOutline();clearTimeout(keyboardTimer);keyboardTimer=null;setRegionPointer(null);sequence++;drag=null;showEdge(null);clearActive();current=null;preview.hidden=erase.hidden=overlay.hidden=true;notifyKeyboardSettled();};
    window.addEventListener('resize',reset);
    window.addEventListener('scroll',()=>{if(!keyboardRunning){clearKeyboardOutline();if(keyboardQueue.length)void updateKeyboardOutline();}if(drag?.phase==='drag')finish({},true);else if(drag){clearActive();drag.suppressPreview=true;preview.hidden=erase.hidden=overlay.hidden=true;}else hide();},true);
    return Object.freeze({get dragging(){return !!drag;},get suppressClick(){return !!drag||Date.now()<suppressedUntil;},get keyboardPending(){return keyboardRunning||!!keyboardQueue.length;},reset,selectionChanged,whenKeyboardSettled,clampedFrame,movedFrame});
  }});


/** 保存独立的编辑工程：原 PDF 二进制 + 可恢复的数据模型，不保存 DOM 或栅格截图。 */

  const magic='PDFMERGE',maxPdf=100*1024*1024,maxMetadata=32*1024*1024;
  const recordKeys=['pageNum','spanIndices','sourceIndices','dataId','mergedText','_initialText','originalLines','preserveSourceAppearance','auditRowFrame','textAlign','leftPt','topPt','widthPt','heightPt','fontSizePt','cssFontSize','fontFamily','importedFontFamily','fontWeight','fontName','originalFontName','fontColor','lineHeightPt','scaleX','fitScale','isEdited','savedSpans','absorbedMergeRecords'];
  const copyRecord=record=>Object.fromEntries(recordKeys.filter(key=>record[key]!==undefined).map(key=>[key,key==='absorbedMergeRecords'?record[key].map(copyRecord):record[key]]));
  const fail=()=>{throw new Error('保存文件内容无效或已损坏，请选择“保存页面”下载的文件。');};
  const validId=(id,pages)=>typeof id==='string'&&/^p\d+-[\w-]+$/.test(id)&&+id.match(/^p(\d+)/)[1]>0&&+id.match(/^p(\d+)/)[1]<=pages;
  const validate=state=>{
    if(!state||state.format!=='pdf-merge-session'||typeof state.fileName!=='string'||!Number.isInteger(state.pageCount)||state.pageCount<1||state.pageCount>100000)fail();
    const array=value=>{if(!Array.isArray(value)||value.length>200000)fail();return value;};
    const seen=new Set();let count=0;
    const records=(values,depth=0)=>{
      if(depth>32)fail();
      for(const record of array(values)){
        if(++count>200000||!record||!Number.isInteger(record.pageNum)||record.pageNum<1||record.pageNum>state.pageCount||!validId(record.dataId,state.pageCount)||!record.dataId.startsWith(`p${record.pageNum}-`)||seen.has(record.dataId)||typeof record.mergedText!=='string')fail();
        seen.add(record.dataId);
        for(const key of ['leftPt','topPt','widthPt','heightPt','fontSizePt','lineHeightPt'])if(!Number.isFinite(record[key])||Math.abs(record[key])>1e7)fail();
        if(record.widthPt<=0||record.heightPt<=0||record.fontSizePt<=0||record.lineHeightPt<=0)fail();
        for(const key of ['scaleX','fitScale','cssFontSize'])if(record[key]!==undefined&&(!Number.isFinite(record[key])||record[key]<=0))fail();
        for(const key of ['fontFamily','importedFontFamily','fontWeight','fontName','originalFontName','fontColor','textAlign','_initialText'])if(record[key]!==undefined&&typeof record[key]!=='string')fail();
        for(const key of ['spanIndices','sourceIndices'])for(const index of array(record[key]||[]))if(!Number.isInteger(index)||index<(key==='spanIndices'?0:1))fail();
        if(record.originalLines!==undefined&&array(record.originalLines).some(line=>typeof line!=='string'))fail();
        for(const span of array(record.savedSpans||[]))if(!span||typeof span.textContent!=='string'||typeof span.style!=='string'||typeof span.className!=='string'||!span.dataset||Object.values(span.dataset).some(value=>typeof value!=='string'))fail();
        records(record.absorbedMergeRecords||[],depth+1);
      }
    };
    records(state.merges);
    const pairs=(values,check)=>{const ids=new Set();for(const row of array(values)){if(!Array.isArray(row)||row.length!==2||!validId(row[0],state.pageCount)||ids.has(row[0])||!check(row[1]))fail();ids.add(row[0]);}};
    pairs(state.texts,value=>typeof value==='string');
    if(!state.regions)fail();
    pairs(state.regions.overrides,value=>{
      if(!value||typeof value!=='object')return false;
      for(const [key,min,max]of [['fontSize',1,200],['lineHeight',1,300],['letterSpacing',-5,30],['wordSpacing',-5,40]])if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)return false;
      const frame=value.frame;if(!frame)return true;
      for(const key of ['x','top','offsetX','offsetY','width','height'])if(frame[key]!==undefined&&(!Number.isFinite(frame[key])||Math.abs(frame[key])>1e7))return false;
      return !(frame.width!==undefined&&frame.width<=0||frame.height!==undefined&&frame.height<=0);
    });
    for(const id of array(state.regions.edited))if(!validId(id,state.pageCount))fail();
    if(!state.fonts||!['simsun','nsimsun','sans-serif'].includes(state.fonts.chinese)||!['simsun','nsimsun','sans-serif'].includes(state.fonts.other))fail();
    if(typeof state.locked!=='boolean'||!Number.isInteger(state.page)||state.page<1||state.page>state.pageCount||!Number.isFinite(state.zoom)||state.zoom<25||state.zoom>500)fail();
    return state;
  };
  const encode=(state,pdf)=>{
    validate(state);
    const metadata=new TextEncoder().encode(JSON.stringify(state));
    if(metadata.length>maxMetadata||pdf.byteLength>maxPdf)throw new Error('保存内容超出限制（原 PDF 最大 100MB）。');
    const header=new Uint8Array(12);header.set(new TextEncoder().encode(magic));new DataView(header.buffer).setUint32(8,metadata.length,true);
    return new Blob([header,metadata,pdf],{type:'application/octet-stream'});
  };
  const decode=async file=>{
    if(file.size<17||file.size>maxPdf+maxMetadata+12)fail();
    const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
    if(new TextDecoder().decode(header.slice(0,8))!==magic)fail();
    const length=new DataView(header.buffer).getUint32(8,true),pdfSize=file.size-12-length;
    if(!length||length>maxMetadata||pdfSize<5||pdfSize>maxPdf)fail();
    const state=validate(JSON.parse(await file.slice(12,12+length).text()));
    const pdf=await file.slice(12+length).arrayBuffer();
    if(!new TextDecoder().decode(new Uint8Array(pdf,0,Math.min(1024,pdf.byteLength))).includes('%PDF-'))fail();
    return {state,pdf};
  };
  export const PDFSession =Object.freeze({create:app=>{
const scope = app.scope;
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    const saveButton=document.getElementById('saveMergeBtn'),restoreButton=document.getElementById('restoreMergeBtn'),input=document.getElementById('mergeSessionInput');
    const dialog=document.createElement('dialog');dialog.className='pdf-font-dialog';dialog.setAttribute('aria-label','保存或恢复页面进度');dialog.textContent='正在处理合并进度，请稍候…';dialog.addEventListener('cancel',event=>event.preventDefault());document.body.append(dialog);
    let busy=false;
    const idle=()=>{
      if(busy||app.loadingOverlay?.classList.contains('show')||app.smartMerge.running||app.jsonFileInput.dataset.importing||app.regionEditor.editing||app.regionResize.dragging||app.mergeSelecting||app.downloadBtn.disabled)throw new Error('当前操作尚未完成，请完成后再保存或恢复。');
    };
    const capture=()=>{
      if(!app.pdfDoc||!app.pdfBuffer)throw new Error('请先上传 PDF 文件。');
      const page=app.pdfViewer.currentPageNumber||1,rect=app.getPageDiv(page)?.getBoundingClientRect(),container=app.viewerContainer.getBoundingClientRect();
      return JSON.parse(JSON.stringify({format:'pdf-merge-session',savedAt:new Date().toISOString(),fileName:app.currentFileName,pageCount:app.pdfDoc.numPages,
        merges:app.mergeRecords.map(copyRecord),texts:[...app.importedTexts],regions:app.regionEditor.snapshot(),fonts:app.fontSettings.snapshot(),locked:app.mergeApi.unmergeLocked,
        page,zoom:app.currentZoom,scroll:rect?{x:(container.left-rect.left)/(rect.width||1),y:(container.top-rect.top)/(rect.height||1)}:null,
        boundaries:app.viewerContainer.classList.contains('show-span-boundaries'),mergeMode:app.mergeMode,unmergeMode:app.unmergeMode}));
    };
    const rebindFonts=async records=>{
      const pages=new Map();
      for(const record of records){if(!pages.has(record.pageNum))pages.set(record.pageNum,[]);pages.get(record.pageNum).push(record);}
      let index=0;
      for(const [pageNum,rows]of pages){
        if(index++%8===0)await app.yieldPdfUi();
        const content=await app.getPageTextContent(pageNum),names=Object.keys(content?.styles||{});
        const rename=text=>typeof text==='string'?text.replace(/g_d\d+_(f\w+)/g,(old,suffix)=>names.find(name=>name.endsWith(`_${suffix}`))||old):text;
        const visit=record=>{
          for(const key of ['fontFamily','fontName'])record[key]=rename(record[key]);
          record.importedFontFamily='';
          for(const span of record.savedSpans||[])span.style=rename(span.style);
          for(const child of record.absorbedMergeRecords||[])visit(child);
        };
        rows.forEach(visit);
      }
    };
    const apply=async({state,pdf},showBoundaries=!!state.boundaries,firstPage=false)=>{
      await app.loadPdf(pdf.slice(0),state.fileName);
      if(!app.pdfDoc||app.pdfDoc.numPages!==state.pageCount)throw new Error('保存文件中的 PDF 与进度不匹配。');
      app.mergeRecords=state.merges.map(copyRecord);app.mergeRecordSerial=0;
      // 被吸收的旧合并也保留编号，后续取消合并再合并不会出现重复 ID。
      const serial=records=>{for(const record of records){app.mergeRecordSerial=Math.max(app.mergeRecordSerial,Number(/-m(\d+)$/.exec(record.dataId)?.[1])||0);serial(record.absorbedMergeRecords||[]);}};serial(app.mergeRecords);
      app.importedTexts=new Map(state.texts);app.fontSettings.restore(state.fonts);app.regionEditor.restore(state.regions);
      app.mergeApi.unmergeLocked=state.locked;app.applyZoom(state.zoom);
      await rebindFonts(app.mergeRecords);
      const edited=app.importedTexts.size||app.fontSettings.enabled||app.regionEditor.size;
      if(edited){app.invalidateImportedBackground();await app.prepareImportedReplacementLayouts();}
      app.refreshMergeCovers();app.assignContentDataIds();
      if(edited){app.applyImportedTexts();await app.refreshImportedPageBackgrounds();}
      app.regionEditor.refresh();app.overflowApi.scan();app.updateUnmergeBtn();app.updateImportJsonBtn();
      app.setSpanBoundariesVisible(showBoundaries);
      if(!state.locked&&state.mergeMode)app.toggleMergeMode();
      else if(!state.locked&&state.unmergeMode)app.toggleUnmergeMode();
      const targetPage=firstPage?1:state.page;
      app.pdfViewer.currentPageNumber=targetPage;app.pdfViewer.scrollPageIntoView({pageNumber:targetPage});app.pageInput.value=targetPage;
      const page=app.getPageDiv(targetPage),rect=page?.getBoundingClientRect(),container=app.viewerContainer.getBoundingClientRect();
      if(firstPage){app.viewerContainer.scrollTop=0;app.viewerContainer.scrollLeft=0;}
      else if(rect&&state.scroll&&Number.isFinite(state.scroll.x)&&Number.isFinite(state.scroll.y)){
        app.viewerContainer.scrollLeft+=rect.left-container.left+state.scroll.x*rect.width;
        app.viewerContainer.scrollTop+=rect.top-container.top+state.scroll.y*rect.height;
      }
    };
    const run=async action=>{
      idle();busy=true;saveButton.disabled=restoreButton.disabled=true;dialog.showModal();
      try{return await action();}finally{busy=false;saveButton.disabled=restoreButton.disabled=false;dialog.close();}
    };
    const save=()=>run(async()=>{
      await app.yieldPdfUi();const blob=encode(capture(),app.pdfBuffer),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`${app.currentFileName.replace(/\.pdf$/i,'')||'document'}_合并进度.pdfmerge`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      app.setStatus('已保存全部页面的合并及编辑进度。刷新后点击“恢复页面”上传此文件即可继续。');
    });
    const restoreFile=file=>run(async()=>{
      const saved=await decode(file),previous=app.pdfDoc?{state:capture(),pdf:app.pdfBuffer.slice(0)}:null;
      try{await apply(saved,true,true);app.setStatus(`已恢复 · ${saved.state.merges.length} 处合并 · 第 1 页，可继续编辑。`);}
      catch(error){if(previous){try{await apply(previous);}catch(rollback){console.error('原进度恢复失败:',rollback);}}throw error;}
    });
    const report=error=>{console.error(error);app.setStatus(`操作失败：${error.message||'文件无效'}`);};
    saveButton.addEventListener('click',()=>save().catch(report));
    restoreButton.addEventListener('click',()=>{try{idle();input.click();}catch(error){report(error);}});
    input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)restoreFile(file).catch(report);});
    return Object.freeze({save,restoreFile,get busy(){return busy;}});
  }});

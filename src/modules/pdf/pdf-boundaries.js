
/** 蓝色边界仅标记非空、未合并的文字 span；不改变原文本和合并记录。 */

  export const PDFBoundaries =Object.freeze({create:(root, scope)=>{
    const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    const dirty=new Set();let timer=null,all=false;
    const eligible=span=>!!span.closest('.page')&&!!span.textContent.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu,'')
      &&!span.closest('.is-merged,[data-merge-span],.edit-cover')&&!span.querySelector('span');
    const scan=(scope=root)=>{
      if(!scope.isConnected)return;
      for(const span of scope.querySelectorAll('span')){
        if(eligible(span)){
          if(span.dataset.spanBoundary!=='1')span.dataset.spanBoundary='1';
        }else if(span.dataset.spanBoundary)delete span.dataset.spanBoundary;
      }
    };
    const schedule=target=>{
      const element=target?.nodeType===3?target.parentElement:target,page=element?.closest?.('.page');
      if(page)dirty.add(page);else all=true;
      if(timer!==null)return;
      timer=setTimeout(()=>{timer=null;if(all)scan();else dirty.forEach(scan);dirty.clear();all=false;},0);
    };
    const observer=new MutationObserver(changes=>{for(const change of changes)schedule(change.target);});
    observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','data-merge-span']});
    scan();
    return Object.freeze({refresh:()=>scan(),destroy(){observer.disconnect();clearTimeout(timer);dirty.clear();root.querySelectorAll('[data-span-boundary]').forEach(span=>delete span.dataset.spanBoundary);}});
  }});

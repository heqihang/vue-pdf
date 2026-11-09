
/** Page-only incomplete-text markers; never changes logical text or PDF export. */

  export const PDFOverflow = Object.freeze({
    create(root, scope) {
      const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
      const layouts = new WeakMap(), dirtyPages = new Set(), attributes = new WeakMap();
      const selector = '.textLayer [data-id], .annotationLayer .element-json-replacement';
      let timer = null, allPages = false, stopped = false;

      const setIncomplete = (element, incomplete) => {
        if (incomplete) {
          if (element.dataset.textOverflow !== '1') element.dataset.textOverflow = '1';
          if(!attributes.has(element)){
            const saved=Object.fromEntries(['tabindex','role','title','aria-label'].map(name=>[name,element.getAttribute?.(name)??null]));
            attributes.set(element,saved);
            element.setAttribute?.('tabindex','0');element.setAttribute?.('role','button');
            element.setAttribute?.('title','文字显示不完整，单击选中，双击调整字号和行间距');
            element.setAttribute?.('aria-label','文字显示不完整，按回车调整字号和间距');
          }
        } else {
          if(element.dataset.textOverflow)delete element.dataset.textOverflow;
          const saved=attributes.get(element);
          if(saved){for(const [name,value]of Object.entries(saved))if(value===null)element.removeAttribute?.(name);else element.setAttribute?.(name,value);attributes.delete(element);}
        }
        return incomplete;
      };

      const check = element => {
        if (layouts.has(element)) {
          const layout = layouts.get(element);
          return setIncomplete(element, layout.incomplete ?? !!(layout.truncated || layout.clipped));
        }
        // Native merge frames preserve the PDF's existing glyphs; their hidden
        // helper text must not be mistaken for overflowing visible content.
        if (element.dataset.sourceAppearance || !element.textContent.trim()) return setIncomplete(element, false);
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(style.color)) return setIncomplete(element, false);
        // In PDF-backed preview the text layer is only a selection proxy. Its
        // browser metrics can differ; the vector layout above is authoritative.
        if (element.closest('.page')?.dataset.pdfPreview === '1') return setIncomplete(element, false);
        const clips = value => /^(hidden|clip|scroll|auto)$/.test(value);
        const clipped = (clips(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
          || (clips(style.overflowY) && element.scrollHeight > element.clientHeight + 1);
        return setIncomplete(element, clipped);
      };

      const scan = (scope = root) => {
        if (stopped || !scope.isConnected) return;
        scope.querySelectorAll(selector).forEach(check);
      };

      const schedule = target => {
        if (stopped) return;
        const page = target?.closest?.('.page');
        if (page) dirtyPages.add(page);
        else allPages = true;
        if (timer !== null) return;
        // Avoid requestAnimationFrame: background tabs must not delay markers.
        timer = setTimeout(() => {
          timer = null;
          if (allPages) scan();
          else dirtyPages.forEach(scan);
          dirtyPages.clear();allPages = false;
        }, 32);
      };

      const mark = (element, layout) => {
        if (!element) return;
        // 蓝框只提示实际单行文字范围；安全排版宽度与可编辑区域保持原值。
        if(layout?.singleLine&&!layout.incomplete&&!layout.truncated&&!layout.clipped&&layout.width>0&&Number.isFinite(layout.contentWidth)){
          const fraction=Math.max(0,Math.min(1,layout.contentWidth/layout.width));
          const left=layout.alignment==='center'?(1-fraction)/2:layout.alignment==='right'?1-fraction:0;
          element.style.setProperty('--span-boundary-width',`${fraction*100}%`);
          element.style.setProperty('--span-boundary-left',`${left*100}%`);
        }else{
          element.style.removeProperty('--span-boundary-width');element.style.removeProperty('--span-boundary-left');
        }
        if (layout) {
          layouts.set(element, layout);
          setIncomplete(element, layout.incomplete ?? !!(layout.truncated || layout.clipped));
        } else {
          layouts.delete(element);
          setIncomplete(element, false);
        }
        schedule(element);
      };

      const observer = new MutationObserver(changes => {
        for (const change of changes) schedule(change.target.parentElement && change.target.nodeType !== 1 ? change.target.parentElement : change.target);
      });
      observer.observe(root, {subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'class', 'data-json-replacement', 'data-source-appearance', 'data-pdf-preview']});
      const refresh = () => schedule();
      window.addEventListener('resize', refresh);
      document.fonts?.addEventListener?.('loadingdone', refresh);
      schedule();
      return Object.freeze({mark, check, scan, schedule, getLayout:element=>layouts.get(element),
        destroy() {
          stopped = true;observer.disconnect();clearTimeout(timer);
          window.removeEventListener('resize', refresh);
          document.fonts?.removeEventListener?.('loadingdone', refresh);
          dirtyPages.clear();
          root.querySelectorAll('[data-text-overflow]').forEach(element => setIncomplete(element, false));
        }
      });
    }
  });

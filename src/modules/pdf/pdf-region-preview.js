import * as PDFLib from 'pdf-lib'
import { pdfjsLib } from '@/services/pdf-runtime.js'
/** 临时预览也用 PDF 字形绘制，避免浏览器回退字体改变字形、字号或间距。 */
export const PDFRegionPreview = Object.freeze({create: async (app, info) => {
  const { document, window } = app.scope;
  await app.prepareImportedFonts();
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([Math.max(.01, info.frame.width), Math.max(.01, info.frame.height)]);
  const font = await app.getPdfVectorFont(doc, new Map(), info.family,
    info.base.fontWeight || info.record?.fontWeight || 'normal', info.record?.fontStyle || 'normal',
    {text: info.text + '...', originalFontName: info.base.originalFontName || info.record?.originalFontName});
  const worker = new pdfjsLib.PDFWorker();
  let disposed = false, task = null, renderTask = null, contents = null;
  return Object.freeze({font,
    async render(layout, scale) {
      if (disposed) return null;
      const width = Math.max(.01, layout.width), height = Math.max(.01, layout.height);
      page.setSize(width, height);
      // 仅保留最新帧的内容流和字体资源，复用字库，避免拖动时不断累积页面。
      const resources = page.node.Resources();
      const fonts = resources && doc.context.lookup(resources.get(PDFLib.PDFName.of('Font')));
      if (fonts) for (const [key] of fonts.entries()) fonts.delete(key);
      const operators = [], append = page.pushOperators;
      page.pushOperators = (...items) => operators.push(...items);
      try { app.drawPdfVectorLines(page, font, layout, 0, height, {x:0, y:0, width, height}, info.color); }
      finally { page.pushOperators = append; }
      const next = doc.context.register(doc.context.flateStream(operators.map(String).join('\n') + '\n'));
      page.node.set(PDFLib.PDFName.of('Contents'), doc.context.obj([next]));
      if (contents) doc.context.delete(contents);
      contents = next;
      const bytes = await doc.save();
      if (disposed) return null;
      const own = pdfjsLib.getDocument({data:bytes, worker,
        cMapUrl:`${app.pdfResourceBase}cmaps/`, cMapPacked:true,
        standardFontDataUrl:`${app.pdfResourceBase}standard_fonts/`});
      task = own;
      try {
        const pdf = await own.promise, source = await pdf.getPage(1);
        if (disposed) return null;
        const ratio = Math.max(1, window.devicePixelRatio || 1), viewport = source.getViewport({scale:scale*ratio});
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));canvas.height = Math.max(1, Math.ceil(viewport.height));
        // 像素取整后的余量由外层裁剪，不把位图缩放到小数宽高，避免字号轻微变化。
        canvas.style.width = `${canvas.width/ratio}px`;canvas.style.height = `${canvas.height/ratio}px`;
        const release = app.smartMerge.enableMergeFrameScheduler();
        try {
          renderTask = source.render({canvasContext:canvas.getContext('2d'), viewport, background:'rgba(0,0,0,0)'});
          await renderTask.promise;
        } finally { renderTask = null;release(); }
        return disposed ? null : canvas;
      } finally { if (task === own) task = null;await own.destroy().catch(()=>{}); }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      renderTask?.cancel();
      const pending = task;task = null;
      Promise.resolve(pending?.destroy()).catch(()=>{}).finally(()=>worker.destroy());
    }
  });
}});

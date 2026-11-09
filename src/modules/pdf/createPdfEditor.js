import { createDomScope } from '@/utils/dom-scope.js'
import { pdfjsLib, pdfjsViewer, pdfResourceBase } from '@/services/pdf-runtime.js'
import { PDFFontSettings } from './pdf-font-settings.js'
import { PDFFonts } from './pdf-fonts.js'
import { PDFContent } from './pdf-content.js'
import { PDFLayout } from './pdf-layout.js'
import { PDFExport } from './pdf-export.js'
import { PDFJson } from './pdf-json.js'
import { PDFSmartMerge } from './smart-merge.js'
import { PDFMerge } from './pdf-merge.js'
import { PDFOverflow } from './pdf-overflow.js'
import { PDFRegionEditor } from './pdf-region-editor.js'
import { PDFRegionResize } from './pdf-region-resize.js'
import { PDFSession } from './pdf-session.js'
import { PDFBoundaries } from './pdf-boundaries.js'

/** PDF.js DOM 与 Vue DOM 分离，所有工厂共享当前实例而不是 window 全局状态。 */
export function createPdfEditor({ root, fontPrograms, ensureFontPrograms = async () => {}, onStatus = () => {} }) {
const scope = createDomScope(root);
const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame } = scope;

try {
let fontApi,contentApi,layoutApi,exportApi,overflowApi,fontSettingsApi,regionEditorApi,regionResizeApi;
let mergeApi;

let jsonApi;





const byId = id => scope.byId(id);

const viewerContainer = byId('viewerContainer');

const viewerDiv = byId('viewer');

const emptyDiv = byId('empty');

const fileInput = byId('fileInput');

const fileInfo = byId('fileInfo');

const fileNameEl = byId('fileName');

const clearBtn = byId('clearBtn');

const statusEl = byId('status');

const mainArea = byId('mainArea');

const pageNav = byId('pageNav');

const pageInput = byId('pageInput');

const pageTotal = byId('pageTotal');

const mergeBtn = byId('mergeBtn');

const unmergeBtn = byId('unmergeBtn');

const spanBoundariesBtn = byId('spanBoundariesBtn');

const downloadBtn = byId('downloadBtn');

const exportJsonBtn = byId('exportJsonBtn');

const importJsonBtn = byId('importJsonBtn');

const jsonFileInput = byId('jsonFileInput');

const toolbarActions = byId('toolbarActions');

const loadingOverlay = byId('loadingOverlay');

const MAX_FILE_SIZE = 100 * 1024 * 1024;

let pdfDoc = null;

let pdfViewer = null;

let pdfLinkService = null;

let eventBus = null;

const pageTextLayerRefreshTasks = new Map();

const setSpanBoundariesVisible = visible => {
      visible=!!visible;
      viewerContainer.classList.toggle('show-span-boundaries', visible);
      document.body.dataset.pageBoundaries=visible?'1':'0';
      if(!visible){regionResizeApi?.reset();regionEditorApi?.suspend();}
      regionEditorApi?.refresh();
      spanBoundariesBtn.textContent = visible ? '预览' : '显示边界';
      spanBoundariesBtn.title = visible ? '只读预览，隐藏全部边框' : '显示蓝色、绿色和红色边框';
      spanBoundariesBtn.setAttribute('aria-pressed', String(visible));
    };

spanBoundariesBtn.addEventListener('click', () => {
      setSpanBoundariesVisible(!viewerContainer.classList.contains('show-span-boundaries'));
    });

let pdfLoadingTask = null;

let loadRequestId = 0;

const ZOOM_MIN = 50;

const ZOOM_MAX = 500;

const ZOOM_STEP = 25;

let currentZoom = 125;

let currentFileName = '';

let pdfBuffer = null;

const getPageDiv = pageNum => {
      if (!pageNum) return null;
      return viewerDiv.querySelector(`.page[data-page-number="${pageNum}"]`);
    };

const forEachPageDiv = (pageNum, callback) => {
      if (pageNum) {
        const pageDiv = getPageDiv(pageNum);
        if (pageDiv) callback(pageDiv);
        return;
      }
      viewerDiv.querySelectorAll('.page').forEach(callback);
    };

const setStatus = msg => {
      onStatus(msg);
    };

const validateFileSize = file => file.size > MAX_FILE_SIZE
      ? `⚠️ 文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB`
      : null;

const updateImportJsonBtn = () => {
      importJsonBtn.disabled = false;
      importJsonBtn.title = '导入JSON';
    };

const getPageScale = pageNum => {
      const pageView = pdfViewer ? pdfViewer.getPageView(pageNum - 1) : null;
      return pageView ? pageView.viewport.scale : 1;
    };

const applyZoom = percent => {
      percent = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, percent));
      currentZoom = percent;
      // PDFViewer.setDocument() 会异步创建页面视图。在 pagesinit 之前设置缩放，
      // PDF.js 会尝试滚动到尚不存在的第 1 页并输出
      // `"1" is not a valid pageNumber parameter.`。
      if (pdfViewer && pdfViewer.pagesCount > 0) {
        pdfViewer.currentScaleValue = (currentZoom / 100).toString();
      }
    };

viewerContainer.addEventListener('wheel', e => {
      if (!pdfDoc) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          applyZoom(currentZoom + ZOOM_STEP);
        } else {
          applyZoom(currentZoom - ZOOM_STEP);
        }
      }
    }, {
      passive: false
    });

document.addEventListener('keydown', e => {
      // Esc 退出当前模式
      if (e.key === 'Escape') {
        if (mergeApi.smartMerge.closeDialog()) return;
        if (mergeApi.mergeMode) mergeApi.toggleMergeMode();
        if (mergeApi.unmergeMode) mergeApi.toggleUnmergeMode();
        return;
      }
      // 缩放快捷键: Ctrl++ 放大, Ctrl+- 缩小, Ctrl+0 重置
      if (!pdfDoc) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        applyZoom(currentZoom + ZOOM_STEP);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        applyZoom(currentZoom - ZOOM_STEP);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        applyZoom(100);
      }
    });

const recreateViewer = () => {
      if (pdfViewer) {
        try {
          pdfViewer.setDocument(null);
        } catch (e) {
        }
      }
      if (pdfLinkService) {
        try {
          pdfLinkService.setDocument(null);
        } catch (e) {
        }
      }
      viewerDiv.replaceChildren();
      eventBus = new pdfjsViewer.EventBus();
      pdfLinkService = new pdfjsViewer.PDFLinkService({
        eventBus
      });
      pdfViewer = new pdfjsViewer.PDFViewer({
        container: viewerContainer,
        viewer: viewerDiv,
        eventBus,
        linkService: pdfLinkService,
        textLayerMode: 1,
        annotationMode: 2,
        // 使用项目自身的区域编辑器，禁用未配置工具栏的 PDF.js 内置注释编辑器。
        annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
        removePageBorders: false
      });
      pdfLinkService.setViewer(pdfViewer);

      eventBus.on('pagerendered', evt => {
        app.assignContentDataIds(evt.pageNumber);
        app.importedBackgroundRenders.delete(evt.pageNumber);
        if (app.importedTexts.size || app.fontSettings.enabled || app.regionEditor.size) app.refreshImportedPageBackgrounds(evt.pageNumber).catch(err => console.warn('替换底图更新失败:', err));
      });
      eventBus.on('annotationlayerrendered', evt => {
        const number = evt.pageNumber, sourceDoc = pdfDoc;
        if (!number || evt.error) return;
        app.assignContentDataIds(number);
        app.getPageAnnotationTexts(number).then(() => {
          if (sourceDoc !== pdfDoc) return;
          app.assignContentDataIds(number);
          if (app.importedTexts.size || app.fontSettings.enabled || app.regionEditor.size) app.applyImportedTexts(number);
        }).catch(error => console.warn('注释元素更新失败:', error));
      });
      // 监听页面切换，更新页码显示（输入框聚焦时不覆盖用户正在输入的内容）
      eventBus.on('pagechanging', evt => {
        if (evt.pageNumber && document.activeElement !== pageInput) {
          pageInput.value = evt.pageNumber;
        }
      });

      // 监听文本层渲染完成（刷新合并覆盖层、分配 data-id 并重新应用已导入的文本）
      eventBus.on('textlayerrendered', evt => {
        const pageNum = evt && evt.pageNumber ? evt.pageNumber : null;
        if (!pageNum || evt.error) return;
        const refreshTask = (async () => {
          // 先为完整原始文本层记录稳定来源序号，再移除被合并的原始 span。
          app.assignContentDataIds(pageNum);
          const hasPageMerges = mergeApi.mergeRecords.some(record => record.pageNum === pageNum);
          if (hasPageMerges) {
            mergeApi.refreshMergeCovers(pageNum);
            app.assignContentDataIds(pageNum);
          }
          // 合并覆盖层移除原始 span 后，重新对齐到 PDF 的稳定来源序号。
          await app.reconcilePageSourceDataIds(pageNum);
          await app.getPageAnnotationTexts(pageNum);
          if (app.importedTexts.size > 0 || app.fontSettings.enabled || app.regionEditor.size) app.applyImportedTexts(pageNum);
        })();
        pageTextLayerRefreshTasks.set(pageNum, refreshTask);
        refreshTask.catch(err => {
          console.warn(`第 ${pageNum} 页文本层更新失败:`, err);
        });
      });
    };

const waitForViewerPagesInit = (bus, viewer, isCancelled) => {
      if (viewer && viewer.pagesCount > 0) return Promise.resolve(true);
      return new Promise(resolve => {
        let settled = false;
        let pollTimer = null;
        let timeoutTimer = null;
        const finish = initialized => {
          if (settled) return;
          settled = true;
          bus.off('pagesinit', onPagesInit);
          if (pollTimer) clearInterval(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(initialized);
        };
        const onPagesInit = () => {
          finish(true);
        };
        bus.on('pagesinit', onPagesInit);
        pollTimer = setInterval(() => {
          if (isCancelled && isCancelled()) {
            finish(false);
          } else if (viewer && viewer.pagesCount > 0) {
            finish(true);
          }
        }, 50);
        timeoutTimer = setTimeout(() => {
          finish(false);
        }, 15000);
      });
    };

const destroyPdfResource = (loadingTask, doc) => {
      const target = loadingTask && typeof loadingTask.destroy === 'function' ? loadingTask : doc;
      if (!target || typeof target.destroy !== 'function') return;
      try {
        const result = target.destroy();
        if (result && result.catch) result.catch(() => {
        });
      } catch (e) {
      }
    };

const loadPdf = async (buffer, name, requestId) => {
      requestId = requestId || ++loadRequestId;
      let task = null;
      let loadedDoc = null;
      let activeViewer = null;
      let activeLinkService = null;
      const discardStaleLoad = () => {
        if (pdfLoadingTask === task) pdfLoadingTask = null;
        if (pdfDoc === loadedDoc) pdfDoc = null;
        destroyPdfResource(task, loadedDoc);
      };
      try {
        reset({
          preserveLoadRequest: true
        });
        setStatus('⏳ 正在解析 PDF...');
        emptyDiv.style.display = 'none';
        loadingOverlay.classList.add('show');
        pdfBuffer = buffer.slice(0); // 保存原始 buffer 用于导出
        currentFileName = name; // 保存文件名用于导出

        task = pdfjsLib.getDocument({
          data: buffer,
          cMapUrl: `${pdfResourceBase}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${pdfResourceBase}standard_fonts/`
        });
        pdfLoadingTask = task;
        loadedDoc = await task.promise;
        if (requestId !== loadRequestId) {
          discardStaleLoad();
          return;
        }
        pdfDoc = loadedDoc;
        const detectedProfile = await mergeApi.smartMerge.detectSmartMergeDocumentProfile(loadedDoc);
        if (requestId !== loadRequestId) {
          discardStaleLoad();
          return;
        }
        mergeApi.smartMerge.profile = detectedProfile;

        // 必须先监听 pagesinit，再交给 PDFViewer 加载文档，避免漏掉初始化事件。
        const activeBus = eventBus;
        activeViewer = pdfViewer;
        activeLinkService = pdfLinkService;
        const pagesInitPromise = waitForViewerPagesInit(activeBus, activeViewer, () => requestId !== loadRequestId || activeViewer !== pdfViewer);
        activeLinkService.setDocument(pdfDoc);
        activeViewer.setDocument(pdfDoc);
        const pagesInitialized = await pagesInitPromise;
        if (requestId !== loadRequestId) {
          if (activeViewer === pdfViewer) {
            try {
              activeViewer.setDocument(null);
            } catch (e) {
            }
            try {
              activeLinkService.setDocument(null);
            } catch (e) {
            }
            viewerDiv.replaceChildren();
          }
          discardStaleLoad();
          return;
        }
        if (!pagesInitialized || !pdfViewer || pdfViewer.pagesCount < 1) {
          throw new Error('PDF 页面初始化失败');
        }
        pdfLoadingTask = null;

        // 页面视图已经存在，此时缩放不会再触发无效的第 1 页跳转。
        applyZoom(currentZoom);
        setSpanBoundariesVisible(true);

        // 显示工具栏操作区
        toolbarActions.classList.add('show');
        emptyDiv.style.display = 'none';
        fileNameEl.textContent = name;
        fileInfo.classList.add('show');
        // 显示页码导航
        pageTotal.textContent = pdfDoc.numPages;
        pageInput.value = 1;
        pageNav.classList.add('show');
        setStatus(`✅ 已加载 · ${pdfDoc.numPages} 页`);
        loadingOverlay.classList.remove('show');
        viewerContainer.scrollTop = 0;
      } catch (err) {
        if (requestId !== loadRequestId) {
          discardStaleLoad();
          return;
        }
        console.error(err);
        reset();
        setStatus(`❌ 加载失败: ${err.message || '文件无效'}`);
      }
    };

const reset = options => {
      options = options || {};
      if (!options.preserveLoadRequest) loadRequestId++;
      const previousLoadingTask = pdfLoadingTask;
      const previousPdfDoc = pdfDoc;
      pdfLoadingTask = null;
      pdfDoc = null;
      fontSettingsApi.reset();regionResizeApi.reset();regionEditorApi.reset();
      destroyPdfResource(previousLoadingTask, previousPdfDoc);
      mergeApi.mergeSelecting = false;
      if (mergeApi.mergeSelectRect && mergeApi.mergeSelectRect.isConnected) mergeApi.mergeSelectRect.remove();
      mergeApi.mergeSelectRect = null;
      mergeApi.smartMerge.reset();
      loadingOverlay.classList.remove('show');

      emptyDiv.style.display = 'flex';
      fileInfo.classList.remove('show');
      fileNameEl.textContent = '';
      // 隐藏工具栏操作区
      toolbarActions.classList.remove('show');
      // 隐藏页码导航
      pageNav.classList.remove('show');
      pageInput.value = 1;
      pageTotal.textContent = '0';
      // 清理合并与取消合并状态
      mergeApi.unmergeMode = false;
      unmergeBtn.classList.remove('active');
      viewerContainer.classList.remove('unmerge-mode');
      app.invalidateImportedBackground();
      app.importedBackgroundTouchedPages.clear();
      app.importedTexts.clear();
      for (const {face} of app.importedFontFaces.values()) if (face) document.fonts?.delete(face);
      app.importedFontFaces.clear();app.jsonImportSequence++;
      app.originalPdfFontObjects.clear();
      app.importedFontPreparation = null;
      mergeApi.mergeRecords = [];
      mergeApi.unmergeLocked = false;
      mergeApi.mergeRecordSerial = 0;
      app.replacementRuleCache.clear();
      app.replacementCellCache.clear();
      app.pageSourceAppearanceCache.clear();
      app.paragraphRuleShifts.clear();
      app.pageTextContentCache.clear();
      app.pageSourceCoverCache.clear();
      pageTextLayerRefreshTasks.clear();
      app.pageTextItemCache.clear();
      app.pageAnnotationTextCache.clear();
      app.fontFaceFamilyCache.clear();
      mergeApi.mergeMode = false;
      mergeBtn.classList.remove('active');
      viewerContainer.classList.remove('merge-mode');
      setSpanBoundariesVisible(false);
      updateImportJsonBtn();
      mergeApi.updateUnmergeBtn();
      mergeApi.clearMergeArtifacts();
      // 清理缩放状态
      currentZoom = 125;
      // 清理导出状态
      currentFileName = '';
      pdfBuffer = null;
      if (!options.disposing) recreateViewer();
      setStatus('✨ 准备就绪');
    };

clearBtn.addEventListener('click', () => {
      if (mergeApi.smartMerge.running) {
        setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      reset();
      fileInput.value = '';
    });

const jumpToPage = () => {
      if (!pdfDoc || !pdfViewer || pdfViewer.pagesCount < 1) return;
      let n = parseInt(pageInput.value, 10);
      if (isNaN(n)) {
        pageInput.value = pdfViewer && pdfViewer.currentPageNumber || 1;
        return;
      }
      // 限制在有效页码范围内
      n = Math.max(1, Math.min(pdfDoc.numPages, n));
      pageInput.value = n;
      if (pdfLinkService) pdfLinkService.goToPage(n);
      pageInput.blur();
    };

pageInput.addEventListener('change', jumpToPage);

pageInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToPage();
      }
    });

const validatePdfFile = file => {
      const isPdfMime = file && file.type === 'application/pdf';
      const isPdfName = file && /\.pdf$/i.test(file.name || '');
      // 某些浏览器或拖拽来源不会提供 MIME；此时允许以 .pdf 扩展名兜底。
      if (!file || !isPdfMime && !isPdfName) return '⚠️ 请选择 PDF 文件';
      return validateFileSize(file);
    };

const handlePdfFile = async file => {
      const errMsg = validatePdfFile(file);
      if (errMsg) {
        setStatus(errMsg);
        return;
      }
      if (mergeApi.smartMerge.running) {
        setStatus('🤖 智能合并正在进行中，请稍候…');
        return;
      }
      const requestId = ++loadRequestId;
      const hadLoadedPdf = !!pdfDoc;
      try {
        loadingOverlay.classList.add('show');
        emptyDiv.style.display = 'none';
        const buffer = await file.arrayBuffer();
        if (requestId !== loadRequestId) return;
        await loadPdf(buffer, file.name, requestId);
      } catch (err) {
        if (requestId !== loadRequestId) return;
        console.error(err);
        loadingOverlay.classList.remove('show');
        emptyDiv.style.display = hadLoadedPdf ? 'none' : 'flex';
        setStatus(`❌ 读取文件失败: ${err.message || '未知错误'}`);
      }
    };

fileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      await handlePdfFile(file);
      fileInput.value = '';
    });

let dragCounter = 0;

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      mainArea.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

mainArea.addEventListener('dragenter', () => {
      dragCounter++;
      mainArea.classList.add('drag-active');
    });

mainArea.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        mainArea.classList.remove('drag-active');
      }
    });

mainArea.addEventListener('drop', async e => {
      dragCounter = 0;
      mainArea.classList.remove('drag-active');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        await handlePdfFile(files[0]);
      } else {
        setStatus('⚠️ 请拖拽 PDF 文件');
      }
    });

let resizeTimer = null;

window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (pdfViewer) pdfViewer.update();
      }, 150);
    });
const app={ scope, fontPrograms, ensureFontPrograms, get boundaries(){ return boundariesApi; },get pageTextContentCache(){return contentApi?.pageTextContentCache;},
get pageSourceCoverCache(){return contentApi?.pageSourceCoverCache;},
get pageTextItemCache(){return contentApi?.pageTextItemCache;},
get pageAnnotationTextCache(){return jsonApi?.pageAnnotationTextCache;},
get fontSettings(){return fontSettingsApi;},
get regionEditor(){return regionEditorApi;},
get regionResize(){return regionResizeApi;},
get overflowApi(){return overflowApi;},
get replacementSubsetCorpus(){return fontApi?.replacementSubsetCorpus;},set replacementSubsetCorpus(value){fontApi.replacementSubsetCorpus=value;},
get fontFaceFamilyCache(){return fontApi?.fontFaceFamilyCache;},
get getCompleteSimSunVectorFont(){return fontApi?.getCompleteSimSunVectorFont;},
get AUTOMATIC_FONT_PROGRAMS(){return fontApi?.AUTOMATIC_FONT_PROGRAMS;},
get automaticFontFaces(){return fontApi?.automaticFontFaces;},
get prepareAutomaticFonts(){return fontApi?.prepareAutomaticFonts;},
get getAutomaticFont(){return fontApi?.getAutomaticFont;},
get getAutomaticVectorFont(){return fontApi?.getAutomaticVectorFont;},
get getDominantSourceItem(){return fontApi?.getDominantSourceItem;},
get originalFontKey(){return fontApi?.originalFontKey;},
get findPreparedOriginalFont(){return fontApi?.findPreparedOriginalFont;},
get readOriginalFontFaces(){return fontApi?.readOriginalFontFaces;},
get subsetOriginalFont(){return fontApi?.subsetOriginalFont;},
get getPreparedOriginalVectorFont(){return fontApi?.getPreparedOriginalVectorFont;},
get pageSourceAppearanceCache(){return contentApi?.pageSourceAppearanceCache;},
get getPageSourceAppearances(){return contentApi?.getPageSourceAppearances;},
get isNarrativeSourceText(){return layoutApi?.isNarrativeSourceText;},
get plainReplacementLayoutCache(){return layoutApi?.plainReplacementLayoutCache;},
get replacementFontMetrics(){return fontApi?.replacementFontMetrics;},
get measureReplacementText(){return fontApi?.measureReplacementText;},
get getPlainReplacementLayouts(){return layoutApi?.getPlainReplacementLayouts;},
get collectPlainImportedEdits(){return layoutApi?.collectPlainImportedEdits;},
get replacementRuleCache(){return layoutApi?.replacementRuleCache;},
get replacementCellCache(){return layoutApi?.replacementCellCache;},
get getReplacementRules(){return layoutApi?.getReplacementRules;},
get getReplacementCell(){return layoutApi?.getReplacementCell;},
get paragraphRuleShifts(){return layoutApi?.paragraphRuleShifts;},
get moveReplacementClosingRules(){return layoutApi?.moveReplacementClosingRules;},
get prepareReplacementParagraphFlow(){return layoutApi?.prepareReplacementParagraphFlow;},
get prepareImportedReplacementLayouts(){return layoutApi?.prepareImportedReplacementLayouts;},
get getReplacementLineHeight(){return layoutApi?.getReplacementLineHeight;},
get positionReplacementParagraph(){return layoutApi?.positionReplacementParagraph;},
get buildJsonSegmentsForPage(){return jsonApi?.buildJsonSegmentsForPage;},
get importedTexts(){return jsonApi?.importedTexts;},set importedTexts(value){jsonApi.importedTexts=value;},
get importedBackgroundVersion(){return contentApi?.importedBackgroundVersion;},set importedBackgroundVersion(value){contentApi.importedBackgroundVersion=value;},
get importedBackgroundPromise(){return contentApi?.importedBackgroundPromise;},set importedBackgroundPromise(value){contentApi.importedBackgroundPromise=value;},
get importedBackgroundLoadingTask(){return contentApi?.importedBackgroundLoadingTask;},set importedBackgroundLoadingTask(value){contentApi.importedBackgroundLoadingTask=value;},
get yieldPdfUi(){return contentApi.yieldPdfUi;},
get beginImportedPreviewUpdate(){return contentApi.beginImportedPreviewUpdate;},
get importedBackgroundRenders(){return contentApi?.importedBackgroundRenders;},
get importedBackgroundTouchedPages(){return contentApi?.importedBackgroundTouchedPages;},
get invalidateImportedBackground(){return contentApi?.invalidateImportedBackground;},
get buildImportedBackground(){return contentApi?.buildImportedBackground;},
get refreshImportedPageBackgrounds(){return contentApi?.refreshImportedPageBackgrounds;},
get getStableImportedFontFamily(){return fontApi?.getStableImportedFontFamily;},
get ORIGINAL_SIMSUN_LATIN(){return fontApi?.ORIGINAL_SIMSUN_LATIN;},
get readTrueTypeFont(){return fontApi?.readTrueTypeFont;},
get rebuildTrueTypeFont(){return fontApi?.rebuildTrueTypeFont;},
get originalLatinFont(){return fontApi?.originalLatinFont;},set originalLatinFont(value){fontApi.originalLatinFont=value;},
get completeOriginalFont(){return fontApi?.completeOriginalFont;},
get fontCoverageCache(){return fontApi?.fontCoverageCache;},
get importedFontFaces(){return fontApi?.importedFontFaces;},
get originalPdfFontObjects(){return fontApi?.originalPdfFontObjects;},
get importedFontPreparation(){return fontApi?.importedFontPreparation;},set importedFontPreparation(value){fontApi.importedFontPreparation=value;},
get prepareImportedFonts(){return fontApi?.prepareImportedFonts;},
get fontCoversText(){return fontApi?.fontCoversText;},
get getLoadedPdfFont(){return fontApi?.getLoadedPdfFont;},
get loadEditablePdf(){return contentApi?.loadEditablePdf;},
get replacementMetricDocument(){return fontApi?.replacementMetricDocument;},set replacementMetricDocument(value){fontApi.replacementMetricDocument=value;},
get jsonImportSequence(){return jsonApi?.jsonImportSequence;},set jsonImportSequence(value){jsonApi.jsonImportSequence=value;},
get originalFontSequence(){return fontApi?.originalFontSequence;},set originalFontSequence(value){fontApi.originalFontSequence=value;},
get replacementMetricFonts(){return fontApi?.replacementMetricFonts;},
get getPreviewBaselineOffset(){return fontApi?.getPreviewBaselineOffset;},
get getReplacementMetrics(){return fontApi?.getReplacementMetrics;},
get getReplacementSourceFont(){return fontApi?.getReplacementSourceFont;},
get getReplacementFontFamily(){return fontApi?.getReplacementFontFamily;},
get applyPlainImportedText(){return layoutApi?.applyPlainImportedText;},
get markTextOverflow(){return overflowApi?.mark;},
get applyImportedTexts(){return jsonApi?.applyImportedTexts;},
get plainTextCovers(){return layoutApi?.plainTextCovers;},
get removePlainTextCover(){return layoutApi?.removePlainTextCover;},
get getOriginalSourceBoxes(){return contentApi?.getOriginalSourceBoxes;},
get getPageTextContent(){return contentApi?.getPageTextContent;},
get unquoteFontFamily(){return fontApi?.unquoteFontFamily;},
get quoteFontFamily(){return fontApi?.quoteFontFamily;},
get isGenericFontFamily(){return fontApi?.isGenericFontFamily;},
get findFontFaceFamily(){return fontApi?.findFontFaceFamily;},
get inferFontWeight(){return fontApi?.inferFontWeight;},
get findTextContentItemForSpan(){return contentApi?.findTextContentItemForSpan;},
get resolveOriginalSpanFontInfo(){return fontApi?.resolveOriginalSpanFontInfo;},
get assignPageElementIds(){return jsonApi?.assignPageElementIds;},
get isPlainContentElement(){return jsonApi?.isPlainContentElement;},
get getPageAnnotationTexts(){return jsonApi?.getPageAnnotationTexts;},
get getAnnotationImportedText(){return jsonApi?.getAnnotationImportedText;},
get applyAnnotationImportedTexts(){return jsonApi?.applyAnnotationImportedTexts;},
get assignContentDataIds(){return jsonApi?.assignContentDataIds;},
get reconcilePageSourceDataIds(){return jsonApi?.reconcilePageSourceDataIds;},
get reconcileRenderedSourceDataIds(){return jsonApi?.reconcileRenderedSourceDataIds;},
get getSpanIndex(){return jsonApi?.getSpanIndex;},
get mergeApi(){return mergeApi;},set mergeApi(value){mergeApi=value;},
get jsonApi(){return jsonApi;},set jsonApi(value){jsonApi=value;},
get pdfResourceBase(){return pdfResourceBase;},
get byId(){return byId;},
get viewerContainer(){return viewerContainer;},
get viewerDiv(){return viewerDiv;},
get emptyDiv(){return emptyDiv;},
get fileInput(){return fileInput;},
get fileInfo(){return fileInfo;},
get fileNameEl(){return fileNameEl;},
get clearBtn(){return clearBtn;},
get statusEl(){return statusEl;},
get mainArea(){return mainArea;},
get pageNav(){return pageNav;},
get pageInput(){return pageInput;},
get pageTotal(){return pageTotal;},
get mergeBtn(){return mergeBtn;},
get unmergeBtn(){return unmergeBtn;},
get spanBoundariesBtn(){return spanBoundariesBtn;},
get downloadBtn(){return downloadBtn;},
get exportJsonBtn(){return exportJsonBtn;},
get importJsonBtn(){return importJsonBtn;},
get jsonFileInput(){return jsonFileInput;},
get toolbarActions(){return toolbarActions;},
get loadingOverlay(){return loadingOverlay;},
get MAX_FILE_SIZE(){return MAX_FILE_SIZE;},
get pdfDoc(){return pdfDoc;},set pdfDoc(value){pdfDoc=value;},
get pdfViewer(){return pdfViewer;},set pdfViewer(value){pdfViewer=value;},
get pdfLinkService(){return pdfLinkService;},set pdfLinkService(value){pdfLinkService=value;},
get eventBus(){return eventBus;},set eventBus(value){eventBus=value;},
get pageTextLayerRefreshTasks(){return pageTextLayerRefreshTasks;},
get setSpanBoundariesVisible(){return setSpanBoundariesVisible;},
get pdfLoadingTask(){return pdfLoadingTask;},set pdfLoadingTask(value){pdfLoadingTask=value;},
get loadRequestId(){return loadRequestId;},set loadRequestId(value){loadRequestId=value;},
get ZOOM_MIN(){return ZOOM_MIN;},
get ZOOM_MAX(){return ZOOM_MAX;},
get ZOOM_STEP(){return ZOOM_STEP;},
get currentZoom(){return currentZoom;},set currentZoom(value){currentZoom=value;},
get currentFileName(){return currentFileName;},set currentFileName(value){currentFileName=value;},
get pdfBuffer(){return pdfBuffer;},set pdfBuffer(value){pdfBuffer=value;},
get dataUrlToUint8Array(){return contentApi?.dataUrlToUint8Array;},
get PDF_EXPORT_RASTER_SCALE(){return exportApi?.PDF_EXPORT_RASTER_SCALE;},
get embedCanvasPng(){return exportApi?.embedCanvasPng;},
get getPdfStandardFontName(){return fontApi?.getPdfStandardFontName;},
get getOriginalPdfFont(){return fontApi?.getOriginalPdfFont;},
get getOriginalPdfMixedFont(){return fontApi?.getOriginalPdfMixedFont;},
get getPdfVectorFont(){return fontApi?.getPdfVectorFont;},
get normalizePdfVectorText(){return layoutApi?.normalizePdfVectorText;},
get canEncodePdfVectorText(){return fontApi?.canEncodePdfVectorText;},
get wrapPdfVectorText(){return layoutApi?.wrapPdfVectorText;},
get layoutFixedPdfText(){return layoutApi?.layoutFixedPdfText;},
get layoutPdfVectorText(){return layoutApi?.layoutPdfVectorText;},
get drawPdfVectorLines(){return exportApi?.drawPdfVectorLines;},
get pdfBytesToBinaryString(){return contentApi?.pdfBytesToBinaryString;},
get pdfBinaryStringToBytes(){return contentApi?.pdfBinaryStringToBytes;},
get decodePdfStringBytes(){return contentApi?.decodePdfStringBytes;},
get scanPdfContentTokens(){return contentApi?.scanPdfContentTokens;},
get multiplyPdfMatrix(){return contentApi?.multiplyPdfMatrix;},
get isPdfPointInsideAnyBox(){return contentApi?.isPdfPointInsideAnyBox;},
get removeCoveredTextBlocksFromStream(){return contentApi?.removeCoveredTextBlocksFromStream;},
get removeUnderlyingPdfText(){return contentApi?.removeUnderlyingPdfText;},
get captureOriginalMergeFlow(){return contentApi?.captureOriginalMergeFlow;},
get appendOriginalTextFlow(){return contentApi?.appendOriginalTextFlow;},
get getPlainImportedEditBounds(){return contentApi?.getPlainImportedEditBounds;},
get downloadBlob(){return exportApi?.downloadBlob;},
get getEditedFileName(){return exportApi?.getEditedFileName;},
get drawPlainImportedEdit(){return exportApi?.drawPlainImportedEdit;},
get generateEditedPdf(){return exportApi?.generateEditedPdf;},
get IMPORTED_CJK_SERIF_FONT_FAMILY(){return fontApi?.IMPORTED_CJK_SERIF_FONT_FAMILY;},
get IMPORTED_LATIN_SERIF_FONT_FAMILY(){return fontApi?.IMPORTED_LATIN_SERIF_FONT_FAMILY;},
get IMPORTED_LATIN_SANS_FONT_FAMILY(){return fontApi?.IMPORTED_LATIN_SANS_FONT_FAMILY;},
get IMPORTED_MONOSPACE_FONT_FAMILY(){return fontApi?.IMPORTED_MONOSPACE_FONT_FAMILY;},
get getPageDiv(){return getPageDiv;},
get forEachPageDiv(){return forEachPageDiv;},
get setStatus(){return setStatus;},
get validateFileSize(){return validateFileSize;},
get updateImportJsonBtn(){return updateImportJsonBtn;},
get getPageScale(){return getPageScale;},
get applyZoom(){return applyZoom;},
get recreateViewer(){return recreateViewer;},
get waitForViewerPagesInit(){return waitForViewerPagesInit;},
get destroyPdfResource(){return destroyPdfResource;},
get loadPdf(){return loadPdf;},
get reset(){return reset;},
get jumpToPage(){return jumpToPage;},
get validatePdfFile(){return validatePdfFile;},
get handlePdfFile(){return handlePdfFile;},
get dragCounter(){return dragCounter;},set dragCounter(value){dragCounter=value;},
get resizeTimer(){return resizeTimer;},set resizeTimer(value){resizeTimer=value;},
get smartMerge() { return mergeApi?.smartMerge; },
set smartMerge(value) { mergeApi.smartMerge = value; },
get MERGE_COVER_TOP_OVERLAP_PX() { return mergeApi?.MERGE_COVER_TOP_OVERLAP_PX; },
get MERGE_COVER_TOP_OVERLAP_PT() { return mergeApi?.MERGE_COVER_TOP_OVERLAP_PT; },
get MERGE_REGION_OFFSET_Y_PX() { return mergeApi?.MERGE_REGION_OFFSET_Y_PX; },
get mergeMode() { return mergeApi?.mergeMode; },
set mergeMode(value) { mergeApi.mergeMode = value; },
get unmergeMode() { return mergeApi?.unmergeMode; },
set unmergeMode(value) { mergeApi.unmergeMode = value; },
get mergeRecords() { return mergeApi?.mergeRecords; },
set mergeRecords(value) { mergeApi.mergeRecords = value; },
get mergeRecordSerial() { return mergeApi?.mergeRecordSerial; },
set mergeRecordSerial(value) { mergeApi.mergeRecordSerial = value; },
get mergeSelecting() { return mergeApi?.mergeSelecting; },
set mergeSelecting(value) { mergeApi.mergeSelecting = value; },
get mergeStartX() { return mergeApi?.mergeStartX; },
set mergeStartX(value) { mergeApi.mergeStartX = value; },
get mergeStartY() { return mergeApi?.mergeStartY; },
set mergeStartY(value) { mergeApi.mergeStartY = value; },
get mergeSelectRect() { return mergeApi?.mergeSelectRect; },
set mergeSelectRect(value) { mergeApi.mergeSelectRect = value; },
get applyReplacementFlowSpan() { return mergeApi?.applyReplacementFlowSpan; },
get ensureMergeDataId() { return mergeApi?.ensureMergeDataId; },
get getMergeSourceIndices() { return mergeApi?.getMergeSourceIndices; },
get getPageMergedSourceIndices() { return mergeApi?.getPageMergedSourceIndices; },
get fitMergedSpanText() { return mergeApi?.fitMergedSpanText; },
get updateUnmergeBtn() { return mergeApi?.updateUnmergeBtn; },
get createEditCover() { return mergeApi?.createEditCover; },
get addOriginalSourceCovers() { return mergeApi?.addOriginalSourceCovers; },
get hasOriginalMergeLines() { return mergeApi?.hasOriginalMergeLines; },
get getMergeDisplayText() { return mergeApi?.getMergeDisplayText; },
get restoreOriginalMergeLines() { return mergeApi?.restoreOriginalMergeLines; },
get createMergeSpan() { return mergeApi?.createMergeSpan; },
get INVISIBLE_CHARS_RE() { return mergeApi?.INVISIBLE_CHARS_RE; },
get stripInvisibleChars() { return mergeApi?.stripInvisibleChars; },
get cleanTextForMatch() { return mergeApi?.cleanTextForMatch; },
get isCjkCharacter() { return mergeApi?.isCjkCharacter; },
get joinMergedTextParts() { return mergeApi?.joinMergedTextParts; },
get tokenizeTextForWrap() { return mergeApi?.tokenizeTextForWrap; },
get shouldPreserveMergeSourceAppearance() { return mergeApi?.shouldPreserveMergeSourceAppearance; },
get restoreSpanFromSaved() { return mergeApi?.restoreSpanFromSaved; },
get toggleMergeMode() { return mergeApi?.toggleMergeMode; },
get deduplicateTextItems() { return mergeApi?.deduplicateTextItems; },
get performMerge() { return mergeApi?.performMerge; },
get clearMergeArtifacts() { return mergeApi?.clearMergeArtifacts; },
get refreshMergeCovers() { return mergeApi?.refreshMergeCovers; },
get toggleUnmergeMode() { return mergeApi?.toggleUnmergeMode; },
get unmergeRecord() { return mergeApi?.unmergeRecord; },
get findMergeAtClick() { return mergeApi?.findMergeAtClick; },
get handleUnmergeClick() { return mergeApi?.handleUnmergeClick; }};
const boundariesApi=PDFBoundaries.create(viewerDiv, scope);
overflowApi=PDFOverflow.create(viewerDiv, scope);
fontSettingsApi=PDFFontSettings.create(scope);
contentApi=PDFContent.create(app);fontApi=PDFFonts.create(app);layoutApi=PDFLayout.create(app);exportApi=PDFExport.create(app);jsonApi=PDFJson.create(app);mergeApi=PDFMerge.create(app);
regionEditorApi=PDFRegionEditor.create(app);
regionResizeApi=PDFRegionResize.create(app);
const sessionApi=PDFSession.create(app);
const api=Object.freeze({boundaries:boundariesApi,session:sessionApi,regionResize:regionResizeApi,regionEditor:regionEditorApi,fontSettings:fontSettingsApi,overflow:overflowApi,merge:mergeApi,json:jsonApi,fonts:fontApi,layout:layoutApi,content:contentApi,export:exportApi,get document(){return pdfDoc;}});
recreateViewer();
let disposed = false;
return Object.freeze({
  ...api,
  get document(){ return pdfDoc; },
  get state(){ return app; },
  loadFile: handlePdfFile,
  dispose() {
    if (disposed) return;
    disposed = true;
    // 先终止任务、关闭字体选择和预览，再解除全局监听及动态节点。
    try {
      // 先释放查看器页面和链接，再释放 PDFDocument。
      pdfViewer?.setDocument(null);
      pdfLinkService?.setDocument(null);
      reset({ disposing: true });
    } finally {
      boundariesApi.destroy();
      overflowApi.destroy();
      pdfViewer?._resizeObserver?.disconnect();
      scope.dispose();
    }
  }
});
 } catch (error) {
  scope.dispose();
  throw error;
 }
}

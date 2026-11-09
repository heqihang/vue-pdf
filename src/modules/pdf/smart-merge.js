import { pdfjsLib } from '@/services/pdf-runtime.js'
/**
 * 智能合并模块：弹窗、页码校验、版式识别、段落分组和后台逐页处理。
 * 由 HTML 提供 PDF/查看器的实时状态及通用合并、字体、data-id 辅助函数。
 * ES Module，由 Vue 编辑器实例提供生命周期与状态。
 */

  const create = app => {
    const scope = app.scope;
    const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    const {
      byId,
      viewerContainer,
      pageTextLayerRefreshTasks,
      getLoadedPdfFont,
      setStatus,
      updateImportJsonBtn,
      updateUnmergeBtn,
      getPageScale,
      cleanTextForMatch,
      joinMergedTextParts,
      getPageTextContent,
      findTextContentItemForSpan,
      shouldPreserveMergeSourceAppearance,
      assignContentDataIds,
      reconcilePageSourceDataIds,
      toggleMergeMode,
      performMerge,
      toggleUnmergeMode,
      deduplicateTextItems
    } = app;
    const smartMergeBtn = byId('smartMergeBtn');
    const smartMergeModal = byId('smartMergeModal');
    const smartMergeConfirm = byId('smartMergeConfirm');
    const smartMergeCancel = byId('smartMergeCancel');
    const smartMergeStartPage = byId('smartMergeStartPage');
    const smartMergeEndPage = byId('smartMergeEndPage');
    const smartMergeError = byId('smartMergeError');
    let smartMergeRunning = false;
    const idleWaiters=new Set();
    const whenIdle=()=>smartMergeRunning?new Promise(resolve=>idleWaiters.add(resolve)):Promise.resolve();
    let smartMergeDocumentProfile = 'generic';

    const getSmartMergedText = (paragraph, originalLines) => {
      if (!originalLines) return;
      const compact = originalLines.join(''), normalized = compact.replace(/\s/g, '');
      if (paragraph.lines.every(line => line.structuredCell?.startsWith('meddra-code-'))) return compact;
      if (smartMergeDocumentProfile === 'shr-drug-batch-table' && originalLines.every(text => /^[A-Za-z\d:/;：；,.+、－−–—()\-]+$/.test(text)) && /\d/.test(compact)) return compact;
      if (smartMergeDocumentProfile === 'shr-comparative-statistical-report') {
        if (/^(?:CN\d+|C\d+(?:D\d+)?|NON-CR\/NON-PD|CR|PR|SD|PD|ND|NE|NA|N\/A|UNKNOWN)$/i.test(normalized)) return normalized;
        if (originalLines.every(text => /^[\s\d.,%()[\]<>≤≥=+−–\-±/:T]+$/.test(text))) return /^[[(]?\d{4}\s*[-/]/.test(compact) ? normalized : compact;
      }
      if (smartMergeDocumentProfile === 'hpp737-statistical-listing') return joinMergedTextParts(originalLines).replace(/HPP\s+737/g, 'HPP737');
      if (smartMergeDocumentProfile === 'shr-data-review' || paragraph.lines.every(line => line.studyTextBlock || line.tableCell !== undefined)) return joinMergedTextParts(originalLines, smartMergeDocumentProfile === 'sim0718-ecrf', smartMergeDocumentProfile === 'shr-subject-listing');
    };

    const getAuditUserFrame = (paragraph, selectedSpans, pageNum, content) => {
      const viewport = app.pdfViewer?.getPageView(pageNum - 1)?.viewport, row = paragraph.lines[0].auditUserRow;
      if (!viewport || !content || !row) return null;
      const sources = content.items.filter(item => item.str?.trim());
      const measure = selected => {
        if (!selected) return null;
        const indexed = sources[Number(selected.span.dataset.sourceIndex) - 1];
        const item = indexed && cleanTextForMatch(indexed.str) === cleanTextForMatch(selected.span.textContent) ? indexed : findTextContentItemForSpan(content, selected.span, selected.index, pageNum);
        if (!item) return null;
        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform),
          height = Math.hypot(transform[2], transform[3]);
        if (Math.abs(transform[1]) > .01 || Math.abs(transform[2]) > .01) return null;
        const descent = Math.max(0, -(content.styles[item.fontName]?.descent ?? -.2)) * height;
        return {
          left: transform[4],
          top: transform[5] - height,
          right: transform[4] + item.width * viewport.scale,
          bottom: transform[5] + descent + .75 * viewport.scale,
          height
        };
      };
      const boxes = selectedSpans.map(measure), start = measure(row.start), next = measure(row.next);
      if (!start || boxes.some(box => !box) || row.next && !next) return null;
      const bounds = {
        left: Math.min(...boxes.map(box => box.left)),
        top: Math.min(...boxes.map(box => box.top)),
        right: Math.max(...boxes.map(box => box.right)),
        bottom: Math.max(...boxes.map(box => box.bottom))
      };
      // 相邻记录共用基线边界附近的空隙；留下 1px 间隔，描边不穿过原字形。
      const hasHan = text => /[\u3400-\u9fff]/.test(text || '');
      return {
        bounds,
        row: {
          top: row.first ? bounds.top - .75 * viewport.scale : start.top + (hasHan(selectedSpans[0].span.textContent) ? 0 : .2 * start.height) + 1,
          bottom: next ? next.top + (hasHan(row.nextUser?.text) ? 0 : .2 * next.height) : bounds.bottom + .75 * viewport.scale
        }
      };
    };

    /* ---- 智能合并 ---- */

    // 点击"智能合并"按钮：弹出确认框
    smartMergeBtn.addEventListener('click', () => {
      if(app.locked){setStatus('JSON 导入期间及导入后不能智能合并。');return;}
      if (!app.pdfDoc) {
        setStatus('⚠️ 请先加载 PDF 文件');
        return;
      }
      if (smartMergeRunning) {
        setStatus('🤖 智能合并正在进行中…');
        return;
      }
      const totalPages = app.pdfDoc.numPages || 1;
      smartMergeStartPage.max = totalPages;
      smartMergeEndPage.max = totalPages;
      smartMergeStartPage.placeholder = `1 - ${totalPages}`;
      smartMergeEndPage.placeholder = `1 - ${totalPages}`;
      smartMergeStartPage.value = '1';
      smartMergeEndPage.value = String(totalPages);
      smartMergeError.textContent = '';
      smartMergeModal.classList.add('show');
      setTimeout(() => {
        smartMergeStartPage.focus();
      }, 0);
    });

    /**
     * 将 textLayer 中的文字按视觉行归类。PDF.js 有时会把一行拆为多个 span，
     * 所以先合并同一基线上的 span，再判断相邻行是否属于同一个段落。
     */
      // 文字层不含绘制的勾选框。读取矢量边界，以单元格和单个选项限定续行。
    const isShrBatchHeader = text => /^(?:中心编号|受试者(?:编号|代码)|访视|研究药物|药物名称|药物?批号|药物?规格|剂型|生产日期|有效期)$/.test(text);
    const isShrBatchSpecification = text => /\d+(?:\.\d+)?\s*(?:mg|g)\s*\/\s*(?:片|粒|瓶)/i.test(text);
    const startsShrBatchSpecification = text => /^\d+(?:\.\d+)?\s*(?:mg|g)\s*\/\s*(?:片|粒|瓶)/i.test(text);
    const isShrBatchCodeList = text => /[+＋]/.test(text) && /[A-Za-z]/.test(text) && /^[A-Za-z\d+＋\s\-]+$/.test(text);
    const getSmartMergeFormLayout = async (textLayer, pageNum) => {
      const spans = [...textLayer.querySelectorAll('span')];
      const nativeTable = ['hpp737-statistical-listing', 'shr-subject-listing', 'shr-drug-batch-table', 'shr-crf-summary', 'shr-comparative-statistical-report', 'shr-data-review'].includes(smartMergeDocumentProfile);
      const shrSubjectListing = smartMergeDocumentProfile === 'shr-subject-listing';
      const hppStatisticalListing = smartMergeDocumentProfile === 'hpp737-statistical-listing';
      const tqcCrf = smartMergeDocumentProfile === 'tqc3721-ecrf';
      const structuredCrf = ['hpp737-ecrf', 'completed-crf', 'fmd-crf', 'sim0718-ecrf', 'shr-safety-narrative', 'shr-drug-batch-table', 'shr-crf-summary', 'shr-data-review'].includes(smartMergeDocumentProfile);
      const shrComparativeStatisticalReport = smartMergeDocumentProfile === 'shr-comparative-statistical-report';
      const shrStudyStatisticalReport = shrComparativeStatisticalReport || smartMergeDocumentProfile === 'shr-study-statistical-report';
      const shrStatisticalReport = shrStudyStatisticalReport || smartMergeDocumentProfile === 'shr-statistical-report';
      const statisticalReport = hppStatisticalListing || shrStatisticalReport || smartMergeDocumentProfile === 'statistical-report' && spans.some(span => /^程序路径/.test(span.textContent));
      const studyTables = smartMergeDocumentProfile === 'generic' && spans.some(span => /^eCollect/i.test(span.textContent));
      if (!tqcCrf && !structuredCrf && !shrSubjectListing && !statisticalReport && !studyTables && (!spans.some(span => /^表\s*[：:]/.test(span.textContent)) || !spans.some(span => /^生成时间\s*[：:]/.test(span.textContent)))) return null;
      const sourceDoc = app.pdfDoc;
      const page = await sourceDoc.getPage(pageNum);
      const viewport = page.getViewport({scale: 1});
      const links = hppStatisticalListing || tqcCrf || shrStatisticalReport || shrSubjectListing || structuredCrf && smartMergeDocumentProfile === 'hpp737-ecrf' ? (await page.getAnnotations()).filter(annotation => annotation.subtype === 'Link' && annotation.dest && annotation.rect) : [];
      // 已适配的表格用 PDF 原始坐标分组；DOM 字体度量和缩放舍入不能改变单元格归属。
      const sourceGeometry = new Map();
      if (tqcCrf || shrStatisticalReport || nativeTable || ['hpp737-ecrf', 'fmd-crf', 'sim0718-ecrf', 'shr-safety-narrative'].includes(smartMergeDocumentProfile)) {
        const content = await getPageTextContent(pageNum);
        let index = 0;
        for (const item of content?.items || []) {
          if (!item.str?.trim()) continue;
          const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(transform[2], transform[3]);
          sourceGeometry.set(++index, {
            text: cleanTextForMatch(item.str),
            left: transform[4],
            top: transform[5] - height,
            right: transform[4] + item.width,
            bottom: transform[5],
            height
          });
        }
      }
      const items = [...sourceGeometry.values()];
      const pageNumbers = items.filter(item => /^\d+$/.test(item.text) && item.left > viewport.width * .85);
      // TQC 目录可跨多页。目录入口链接与右侧页码在同一行，正文页还含文档编号表头。
      // 只跳过这种目录版式，不能把正文里的回跳链接、数值字段当作目录。
      const linkedPageNumbers = tqcCrf ? links.filter(link => {
        const rect = viewport.convertToViewportRectangle(link.rect);
        const centerY = (rect[1] + rect[3]) / 2, right = Math.max(rect[0], rect[2]);
        return pageNumbers.some(item => right < item.left && Math.abs((item.top + item.bottom) / 2 - centerY) < item.height);
      }) : [];
      const directory = tqcCrf ? linkedPageNumbers.length >= 2 && !items.some(item => /^TQC3721-D8-/.test(item.text)) : links.length > 0 && pageNumbers.length > 0;
      if (directory) return {
        structuredCrf: true,
        directory,
        links,
        sourceGeometry,
        width: viewport.width,
        mergeDirectoryWraps: shrComparativeStatisticalReport,
        directoryEntries: links.map(link => {
          const rect = viewport.convertToViewportRectangle(link.rect);
          return {
            left: Math.min(rect[0], rect[2]),
            right: Math.max(rect[0], rect[2]),
            top: Math.min(rect[1], rect[3]),
            bottom: Math.max(rect[1], rect[3])
          };
        }),
        edges: [],
        rules: [],
        boxes: []
      };
      if (tqcCrf) return null; // 正文沿用原有 TQC 分组规则。
      const operators = await page.getOperatorList();
      if (sourceDoc !== app.pdfDoc) return null;
      const boxes = [], rules = [], edges = [], textCells = [], stack = [];
      const strokeOperations = smartMergeDocumentProfile === 'sim0718-ecrf' ? new Set(['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'].map(name => pdfjsLib.OPS[name])) : null;
      let matrix = [1, 0, 0, 1, 0, 0];
      operators.fnArray.forEach((operation, index) => {
        const args = operators.argsArray[index];
        if (operation === pdfjsLib.OPS.save) stack.push(matrix.slice());
        else if (operation === pdfjsLib.OPS.restore) matrix = stack.pop() || matrix;
        else if (operation === pdfjsLib.OPS.transform) matrix = pdfjsLib.Util.transform(matrix, args);
        else if (operation === pdfjsLib.OPS.constructPath) {
          // 整页的白底矩形不是单元格，不能用它给正文赋表格边界。
          if (nativeTable && !shrSubjectListing && args[2] && Math.abs(args[2][1] - args[2][0]) > viewport.width * .9 && Math.abs(args[2][3] - args[2][2]) > viewport.height * .9) return;
          // 病程表逐行填充白色背景；仅保留真正的细边线，不能把背景矩形当作行界。
          if (['shr-safety-narrative', 'shr-crf-summary', 'shr-data-review'].includes(smartMergeDocumentProfile) && args[2]) {
            const bounds = args[2], width = Math.abs(bounds[1] - bounds[0]), height = Math.abs(bounds[3] - bounds[2]);
            if (Math.min(width, height) > 1.1) return;
          }
          if (strokeOperations) {
            // SIM 表单逐行填充文字背景；只有真正描边的路径才是表格线。
            let outlined = false;
            for (let next = index + 1; next < operators.fnArray.length; next++) {
              const paint = operators.fnArray[next];
              if (strokeOperations.has(paint)) {
                outlined = true;
                break;
              }
              if ([pdfjsLib.OPS.constructPath, pdfjsLib.OPS.endPath, pdfjsLib.OPS.fill, pdfjsLib.OPS.eoFill].includes(paint)) break;
            }
            if (!outlined) return;
          }
          // 列表虽无竖线，PDF 仍按单元格填充背景矩形；保留整格范围而非单行范围。
          if ((shrSubjectListing || shrComparativeStatisticalReport) && args[0]?.length === 1 && args[0][0] === pdfjsLib.OPS.rectangle) {
            const [x, y, width, height] = args[1], transform = pdfjsLib.Util.transform(viewport.transform, matrix);
            const points = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(point => [transform[0] * point[0] + transform[2] * point[1] + transform[4], transform[1] * point[0] + transform[3] * point[1] + transform[5]]);
            const left = Math.min(...points.map(p => p[0])), right = Math.max(...points.map(p => p[0]));
            const top = Math.min(...points.map(p => p[1])), bottom = Math.max(...points.map(p => p[1]));
            if (right - left > 3 && right - left < viewport.width * .8 && bottom - top > 3 && bottom - top < viewport.height * .4) textCells.push({
              left,
              right,
              top,
              bottom
            });
          }
          // 新表单中的单元格常是一整条矩形路径，必须读取四边，不能只取路径总包围框。
          if (structuredCrf) {
            const transform = pdfjsLib.Util.transform(viewport.transform, matrix);
            const point = (x, y) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
            const edge = (start, end) => {
              const [x1, y1] = point(...start), [x2, y2] = point(...end);
              const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2),
                bottom = Math.max(y1, y2);
              if (bottom - top < .75 && right - left > 2 || right - left < .75 && bottom - top > 2) edges.push({
                left,
                right,
                top,
                bottom
              });
              if (bottom - top < .75 && right - left > viewport.width * .5) rules.push(top);
            };
            let position = [0, 0], start = position, offset = 0;
            for (const operation of args[0]) {
              if (operation === pdfjsLib.OPS.rectangle) {
                const [x, y, width, height] = args[1].slice(offset, offset + 4);
                offset += 4;
                const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
                if (smartMergeDocumentProfile === 'fmd-crf') {
                  const transformed = points.map(([x, y]) => point(x, y));
                  const left = Math.min(...transformed.map(p => p[0])), right = Math.max(...transformed.map(p => p[0]));
                  const top = Math.min(...transformed.map(p => p[1])), bottom = Math.max(...transformed.map(p => p[1]));
                  if (right - left >= 6 && right - left <= 24 && bottom - top >= 6 && bottom - top <= 24 && Math.abs(right - left - (bottom - top)) < 2) boxes.push({
                    left,
                    right,
                    top,
                    bottom
                  });
                }
                points.forEach((point, index) => edge(point, points[(index + 1) % 4]));
                position = start = points[0];
              } else if (operation === pdfjsLib.OPS.moveTo || operation === pdfjsLib.OPS.lineTo) {
                const next = args[1].slice(offset, offset + 2);
                offset += 2;
                if (operation === pdfjsLib.OPS.lineTo) edge(position, next); else start = next;
                position = next;
              } else if (operation === pdfjsLib.OPS.closePath) {
                edge(position, start);
                position = start;
              } else if (operation === pdfjsLib.OPS.curveTo) {
                position = args[1].slice(offset + 4, offset + 6);
                offset += 6;
              } else if (operation === pdfjsLib.OPS.curveTo2 || operation === pdfjsLib.OPS.curveTo3) {
                position = args[1].slice(offset + 2, offset + 4);
                offset += 4;
              }
            }
            return;
          }
          const bounds = args[2];
          if (!bounds || bounds.length !== 4 || !Array.from(bounds).every(Number.isFinite)) return;
          // PDF.js 3 的路径范围为 [minX, maxX, minY, maxY]，新版为标准矩形顺序。
          const [x1, y1, x2, y2] = typeof args[0] === 'number' ? bounds : [bounds[0], bounds[2], bounds[1], bounds[3]];
          const transform = pdfjsLib.Util.transform(viewport.transform, matrix);
          const points = [[x1, y1], [x1, y2], [x2, y1], [x2, y2]].map(([x, y]) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]]);
          const left = Math.min(...points.map(point => point[0])), right = Math.max(...points.map(point => point[0]));
          const top = Math.min(...points.map(point => point[1])), bottom = Math.max(...points.map(point => point[1]));
          const width = right - left, height = bottom - top;
          if ((studyTables || statisticalReport || shrSubjectListing) && (height < (statisticalReport ? 1.1 : 0.75) && width > 2 || width < 0.75 && height > 2)) edges.push({
            left,
            right,
            top,
            bottom
          });
          if (width > viewport.width * 0.5 && height < 1) rules.push(top);
          if (left > viewport.width * 0.5 && width >= 6 && width <= 24 && height >= 6 && height <= 24 && Math.abs(width - height) < 2) boxes.push({
            left,
            right,
            top,
            bottom
          });
        }
      });
      // 统计表的横线常由各列分别绘制；合并相接线段后确认整行边界。
      if (statisticalReport || shrSubjectListing) {
        const rows = [];
        for (const edge of edges.filter(edge => edge.bottom - edge.top < 1.1).sort((a, b) => a.top - b.top || a.left - b.left)) {
          let row = rows.find(row => Math.abs(row.top - edge.top) < 0.75);
          if (!row) rows.push(row = {top: edge.top, segments: []});
          row.segments.push(edge);
        }
        for (const row of rows) {
          let left = Infinity, right = -Infinity;
          for (const edge of row.segments.sort((a, b) => a.left - b.left)) {
            if (edge.left > right + 1) left = edge.left;
            right = Math.max(right, edge.right);
            if (right - left > viewport.width * 0.5) rules.push(row.top);
          }
        }
      }
      const signaturePage = smartMergeDocumentProfile === 'shr-data-review' && /(?:签字页|EnvelopeID:|SignerEvents)/.test([...sourceGeometry.values()].map(item => item.text).join('').replace(/\s/g, ''));
      if (smartMergeDocumentProfile === 'shr-data-review' && !signaturePage) {
        const columns = [];
        for (const edge of edges.filter(edge => edge.bottom - edge.top < .75 && edge.right - edge.left > 20 && edge.top > viewport.height * .085)) {
          let column = columns.find(column => Math.abs(column.left - edge.left) < 1.1 && Math.abs(column.right - edge.right) < 1.1);
          if (!column) columns.push(column = {left: edge.left, right: edge.right, rows: []});
          if (!column.rows.some(top => Math.abs(top - edge.top) < .75)) column.rows.push(edge.top);
        }
        for (const column of columns) {
          column.rows.sort((a, b) => a - b);
          for (let index = 1; index < column.rows.length; index++) textCells.push({
            left: column.left,
            right: column.right,
            top: column.rows[index - 1],
            bottom: column.rows[index]
          });
        }
      }
      const reportCover = shrComparativeStatisticalReport && !rules.length && [...sourceGeometry.values()].some(item => item.text === '统计分析图表');
      let batchColumns;
      if (smartMergeDocumentProfile === 'shr-drug-batch-table') {
        const firstPage = pageNum === 1 ? page : await sourceDoc.getPage(1),
          firstViewport = firstPage.getViewport({scale: 1});
        batchColumns = (await getPageTextContent(1)).items.filter(item => isShrBatchHeader(item.str?.trim())).map(item => {
          const transform = pdfjsLib.Util.transform(firstViewport.transform, item.transform);
          return (transform[4] + item.width / 2) / firstViewport.width * viewport.width;
        }).sort((a, b) => a - b);
      }
      return {
        hppStatisticalListing,
        hppColumnEdges: hppStatisticalListing ? edges.filter(edge => edge.bottom - edge.top < 1.1) : undefined,
        batchColumns,
        signaturePage,
        structuredCrf,
        sourceGeometry,
        statisticalReport: statisticalReport && !reportCover,
        shrStatisticalReport: shrStatisticalReport && !reportCover,
        shrStudyStatisticalReport,
        shrComparativeStatisticalReport,
        nativeTable,
        textCells,
        width: viewport.width,
        edges: statisticalReport || shrSubjectListing ? [] : edges,
        rules: [...new Set(rules)].sort((a, b) => a - b),
        boxes: boxes.filter((box, index) => !boxes.slice(0, index).some(other => Math.abs(other.top - box.top) < 1 && Math.abs(other.left - box.left) < 1)).sort((a, b) => a.top - b.top)
      };
    };
    /** 按链接、业务字段和签名记录划分两类 eCRF；范围随页面比例变化。 */
    const groupItemsBy = (items, key) => {
      const groups = new Map();
      for (const item of items) {
        const id = key(item);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(item);
      }
      return groups;
    };
    /** 按文字和相邻位置索引去重，避免逐项扫描整页；历史范围沿用原有手动/智能规则。 */

      // 最近的边界只需一次遍历，不必为每个文字对象分配并排序候选数组。
    const closestEdge = (edges, axis, value, before) => {
        let nearest;
        for (const edge of edges) {
          const position = edge[axis];
          if ((before ? position < value : position > value) && (!nearest || (before ? position > nearest[axis] : position < nearest[axis]))) nearest = edge;
        }
        return nearest;
      };
    const markStructuredCrfItems = (items, layerRect, layout) => {
      if (!layout?.structuredCrf) return;
      if (layout.signaturePage) {
        for (const item of items) item.structuredIndependent = true;
        return;
      }
      const scale = layerRect.width / layout.width;
      const rules = layout.rules.map(top => top * scale);
      if (layout.directory) {
        for (const item of items) {
          item.structuredIndependent = true;
          if (!layout.mergeDirectoryWraps || /^[\d.\s_—–-]+$/.test(item.text)) continue;
          const x = (item.left + item.right) / (2 * scale), y = (item.top + item.bottom) / (2 * scale);
          const entry = layout.directoryEntries.findIndex(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
          if (entry < 0) continue;
          item.structuredCell = `directory-entry-${entry}`;
          item.structuredIndependent = false;
        }
        return;
      }
      if (['shr-safety-narrative', 'shr-drug-batch-table', 'shr-crf-summary', 'shr-data-review'].includes(smartMergeDocumentProfile)) return;
      if (smartMergeDocumentProfile === 'sim0718-ecrf') {
        const choices = groupItemsBy(items.filter(item => item.tableCell !== undefined && /^[○◉◯□☐⬚]/.test(item.text)), item => item.tableCell);
        for (const item of items) {
          // 校验信息、页脚和纯勾选符号不是相邻字段的正文。
          if (/^Data hash\s*:|^CRF V\d|^Confidential$|^\d+\s*\/\s*\d+$/.test(item.text) || /^[○◉◯□☐⬚▾\s]+$/.test(item.text)) {
            item.structuredIndependent = true;
            continue;
          }
          // 每个选项的续行只归属于本选项，兼容 PDF 中的实心圆“◉”。
          const starts = choices.get(item.tableCell) || [];
          if (starts.length) item.structuredCell = `sim-choice-${item.tableCell}-${starts.findLastIndex(start => start.top <= item.top + item.height * .4)}`;
        }
        // 同一说明单元格中的注意事项和填写指令分别成段；各段自己的换行仍可合并。
        for (const [cell, rows] of groupItemsBy(items.filter(item => item.tableCell !== undefined && !item.structuredCell && !item.structuredIndependent), item => item.tableCell)) {
          let paragraph = 0;
          for (const [index, item] of rows.entries()) {
            if (index && /[。！？?][”’）)]*\s*$/.test(rows[index - 1].text) && /^请(?:填写|记录)/.test(item.text)) paragraph++;
            item.structuredCell = `sim-instruction-${cell}-${paragraph}`;
          }
        }
        return;
      }
      if (smartMergeDocumentProfile === 'fmd-crf') {
        // 数字序号列单独保留；注释中“4、…”也可能是上一行行内枚举的续行。
        const enumerator = /^[a-z][、.)]/i;
        const fields = groupItemsBy(items.filter(item => enumerator.test(item.text) && !/[;；。!?！？]\s*$/.test(item.text)), item => item.tableCell);
        const boxes = layout.boxes.map(box => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value * scale])));
        for (const item of items) {
          const compact = item.text.replace(/\s/g, '');
          // 格式提示、纯序号和复选框答案分别保留，不能串成一段。
          if (/^[（(]?(?:D{2}\/(?:M{2,3})\/Y{4}|Y{4}\/(?:M{2,3})\/D{2})[)）]?$/i.test(compact) || /^(?:\d+|[（(]\d+[)）]|[a-z][、.)])$/i.test(compact) || /[:：]\s*$/.test(item.text) || enumerator.test(item.text) && /[;；。!?！？]\s*$/.test(item.text) || boxes.some(box => Math.abs((item.top + item.bottom - box.top - box.bottom) / 2) < item.height * .6 && item.left >= box.right - item.height * .2 && item.left - box.right < item.height * 1.5)) {
            item.structuredIndependent = true;
            continue;
          }
          // 同一大单元格中的枚举项各自成段，只有本项真正换行的内容才可相连。
          const starts = (fields.get(item.tableCell) || []).filter(start => Math.abs(start.left - item.left) < item.height * 2);
          if (starts.length) item.structuredCell = `fmd-list-${item.tableCell}-${starts.findLastIndex(start => start.top <= item.top + item.height * .3)}`;
          // 完整的计算公式与随后的处置提示是两条独立说明。
          if (/计算(?:方法|公式)\s*[：:]/.test(item.text) && /[%％]\s*$/.test(item.text)) item.structuredIndependent = true;
        }
        // 部分表头竖线不闭合，仍可按相邻、对齐的完整字段名确认短续行。
        for (const [index, start] of items.filter(item => /^(?:是否|是否由于|与试验用)$/.test(item.text)).entries()) {
          const tail = items.find(item => /^(?:持续|不良事件|药物的关系)$/.test(item.text) && item.top - start.top > start.height * .55 && item.top - start.bottom < start.height * .65 && Math.abs(item.left - start.left) < start.height * 1.8 && (!item.tableCell || !start.tableCell || item.tableCell === start.tableCell));
          if (tail && !start.structuredIndependent && !tail.structuredIndependent) start.structuredCell = tail.structuredCell = `fmd-caption-${index}`;
        }
        return;
      }
      if (smartMergeDocumentProfile === 'hpp737-ecrf') {
        const tableCells = groupItemsBy(items.filter(item => item.tableCell !== undefined), item => item.tableCell);
        // MedDRA 名称与方括号编号是两个字段；窄列中编号自己的续行仍可连接。
        for (const [cell, rows] of tableCells) {
          if (!/[\[［]\d{8}[\]］]/.test(rows.map(item => item.text).join(''))) continue;
          let code = -1, inCode = false;
          for (const item of rows) {
            if (/^[)）\s]*[\[［]\d{1,8}[\]］]?$/.test(item.text)) {
              code++;
              inCode = true;
            } else if (!inCode || !/^\d+[\]］]?$/.test(item.text)) {
              inCode = false;
              continue;
            }
            item.structuredCell = `meddra-code-${cell}-${code}`;
            if (/[\]］]$/.test(item.text)) inCode = false;
          }
        }
        // 问卷的编号标题和紧接的说明是不同字段；标题自身的短续行仍可合并。
        const questionnaire = items.some(item => /C-SSRS/.test(item.text));
        if (questionnaire) {
          const topics = items.filter(item => item.left < layerRect.width * .2 && /^\d+[.．]\s+/.test(item.text));
          for (const [index, topic] of topics.entries()) {
            const rightEdge = layout.edges.filter(edge => edge.bottom - edge.top > 2 && edge.left * scale > topic.right - topic.height * .2 && edge.top * scale <= topic.top && edge.bottom * scale >= topic.bottom).reduce((right, edge) => Math.min(right, edge.left * scale), layerRect.width * .94);
            let last = topic;
            // 短标题可能只换下一个末字；评分说明也可能整句换成两行或更多行。
            const headingRows = [topic];
            for (const following of items.filter(item => item.top > topic.top + topic.height * .5 && item.left < layerRect.width * .55).sort((a, b) => a.top - b.top || a.left - b.left)) {
              if (following.top - last.top < last.height * .5) continue;
              const shortTail = last === topic && topic.right - topic.left > layerRect.width * .35 && following.right - following.left < layerRect.width * .18 && following.text.replace(/\s/g, '').length <= 8 && !/[。！？?]/.test(following.text);
              const fullLine = rightEdge - last.right < last.height * 1.8;
              if (following.top - last.bottom >= last.height * .3 || Math.abs(following.left - topic.left) >= topic.height || /[。！？?]\s*$/.test(last.text) || /^\d+[.．]\s+/.test(following.text) || !shortTail && !fullLine) break;
              headingRows.push(following);
              last = following;
            }
            for (const item of items) {
              if (item.left >= layerRect.width * .55) continue;
              if (headingRows.some(row => Math.abs(item.top - row.top) < row.height * .3)) item.structuredCell = `questionnaire-heading-${index}`;
            }
          }
        }
        // 完整的栏目名和单独问句也适用于没有稽查记录的普通问卷页。
        if (questionnaire) {
          for (const item of items) {
            if (/^(?:实际尝试|被中断的尝试|自行中止的尝试|预备的行动或行为|自杀行为|完成的自杀|如果是\s*[,，]\s*请描述|您做过(?:自杀尝试|伤害自己的事情|可能导致自己死亡的危险事情)吗\s*[?？])$/.test(item.text)) item.structuredIndependent = true;
          }
        }
        // 宽单元格中多个短答案是多选值，各占一行；左侧字段名仍允许自动换行。
        const cellRows = [...tableCells.values()];
        for (const label of cellRows.filter(rows => /多选/.test(rows.map(item => item.text).join('').replace(/\s/g, '')))) {
          const bounds = label[0].tableBounds;
          for (const values of cellRows) {
            const cell = values[0].tableBounds;
            if (Math.abs(cell.left - bounds.right) < scale && Math.abs(cell.top - bounds.top) < scale && Math.abs(cell.bottom - bounds.bottom) < scale && values.every(item => item.text.length <= 20 && item.right - cell.left < (cell.right - cell.left) * .6)) {
              for (const item of values) item.structuredIndependent = true;
            }
          }
        }
        const guidance = groupItemsBy(items.filter(item => item.tableCell !== undefined && /^[A-Za-z][A-Za-z0-9_]*[（(:]/.test(item.text)), item => item.tableCell);
        for (const item of items) {
          const starts = guidance.get(item.tableCell) || [];
          if (starts.length) item.structuredCell = `guidance-${item.tableCell}-${starts.findLastIndex(start => start.top <= item.top + item.height * .3)}`;
        }
        const legendStarts = groupItemsBy(items.filter(item => item.left < layerRect.width * .3 && /^(?:\d+\s*=|注\s*[：:])/.test(item.text)), item => item.tableCell);
        for (const item of items) {
          const starts = (legendStarts.get(item.tableCell) || []).filter(start => Math.abs(start.left - item.left) < item.height * 2);
          if (starts.filter(start => /^\d+\s*=/.test(start.text)).length >= 2 && item.top >= starts[0].top - item.height * 1.1 && item.top <= starts.at(-1).top + item.height * 2) item.structuredCell = `legend-${item.tableCell}-${starts.findLastIndex(start => start.top <= item.top + item.height * .3)}`;
        }
        const starts = items.filter(item => item.left < layerRect.width * .55 && /^(?:Action|Value|Notes?|Comments?|Remarks?|Reason)\s*:/i.test(item.text));
        if (!starts.length) return;
        const timeItems = items.filter(item => item.left > layerRect.width * .65 && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(item.text));
        const timeLeft = Math.min(...timeItems.map(item => item.left));
        const users = items.filter(item => item.left > layerRect.width * .45 && item.right < timeLeft && timeItems.some(time => Math.abs(time.top - item.top) < item.height * .5));
        const userLeft = users.length ? Math.min(...users.map(item => item.left)) - users[0].height * .3 : layerRect.width * .52;
        const introWrapItems = new Set();
        if (!questionnaire) {
          const intro = items.filter(item => item.top < starts[0].top - item.height * .3 && item.tableCell === undefined && !item.structuredCell);
          for (const previous of intro) {
            if (previous.right - previous.left < layerRect.width * .75 || /[。！？?]\s*$/.test(previous.text)) continue;
            const next = intro.find(item => item.top - previous.top > previous.height * .55 && item.top - previous.bottom < previous.height * .3 && Math.abs(item.left - previous.left) < previous.height * 1.5 && Math.abs(item.height - previous.height) < previous.height * .1 && !/^(?:\d+[.．]\s+|[○◯□☐●■✓✔])/.test(item.text));
            if (next) {
              introWrapItems.add(previous);
              introWrapItems.add(next);
            }
          }
        }
        for (const item of items) {
          if (item.structuredIndependent) continue;
          if (item.top < starts[0].top - item.height * .3 || item.top > layerRect.height * .96) {
            // 首条稽查记录上方的问卷说明和贴近右边界的长字段仍可换行，页脚跳过。
            item.structuredIndependent = item.tableCell === undefined && (item.top > layerRect.height * .96 || !questionnaire && !introWrapItems.has(item));
            continue;
          }
          const index = starts.findLastIndex(start => start.top <= item.top + item.height * .3);
          const role = item.left >= timeLeft - item.height * .3 ? 'time' : item.left >= userLeft ? 'user' : 'text';
          // 稽查分栏不能覆盖已经确认的问卷标题与说明边界。
          if (role !== 'text' || !item.structuredCell?.startsWith('questionnaire-heading-')) item.structuredCell = `audit-${index}-${role}`;
          // 单独的蓝色栏目名与后面的 Action/Value 不是一条记录。
          if (role === 'text' && !starts.includes(item) && /(?:-\s*Row\s+\d+)$/.test(item.text)) item.structuredIndependent = true;
        }
        return;
      }
      const times = items.filter(item => item.left > layerRect.width * .6 && /^\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}/.test(item.text));
      const timeLeft = times.length ? Math.min(...times.map(item => item.left)) : layerRect.width * .6686;
      const numbers = items.filter(item => item.left > layerRect.width * .87 && /^\d+\.\d+$/.test(item.text));
      const numberLeft = numbers.length ? Math.min(...numbers.map(item => item.left)) - numbers[0].height * .25 : layerRect.width * .877;
      const signatures = items.filter(item => /^SignedOff\s*:/i.test(item.text));
      const fieldStarts = items.filter(item => item.left < timeLeft && /^(?:Code|Item|Result|Unit|Range|Status)\s*$/.test(item.text));
      for (const item of items) {
        const signature = signatures.find(signature => Math.abs(signature.top - item.top) < item.height * .45);
        if (signature) {
          item.structuredCell = `signature-${signatures.indexOf(signature)}`;
          continue;
        }
        if (item.top > layerRect.height * .93 || /^Completed\s*CRF$|^(?:Timepoint|Activity|Taken Time|Line #|Study, Visit:|Site, Group:|Link Name:|Slot Name:)$/i.test(item.text)) {
          item.structuredIndependent = true;
          continue;
        }
        const band = rules.filter(top => top <= item.top + item.height * .15).length;
        if (item.left >= numberLeft) {
          item.structuredIndependent = true;
          continue;
        }
        const role = item.left >= timeLeft - item.height * .2 ? 'time' : item.left < layerRect.width * .17 ? 'timepoint' : 'activity';
        const field = role === 'activity' ? fieldStarts.filter(start => start.top <= item.top + item.height * .3).length : 0;
        item.structuredCell = `completed-${band}-${role}-${field}`;
      }
    };
    const isShrSampleSize = text => /^(?:[\[［]\d+[\]］]\s*)?\(\s*N\s*=/.test(text);
    /** 统计汇总表没有竖线：用样本量列定位剂量表头，计数和不同数据行分别保留。 */
    const markShrStatisticalLines = (lines, layout, layerRect) => {
      const scale = layerRect.width / layout.width, rules = layout.rules.map(top => top * scale);
      // 曲线图的坐标、图例和风险人数是独立数据，不能按表格续行合并。
      if (layout.shrStudyStatisticalReport && lines.some(line => line.top < layerRect.height * .25 && /^图\s*\d+(?:\.\d+)+/.test(line.text))) {
        layout.chart = true;
        for (const line of lines) line.independentReportField = true;
        return;
      }
      const numeric = text => /\d/.test(text) && /^[\s\d.,%()[\]<>≤≥=+−–\-±/]+$/.test(text);
      const anchors = layout.shrSampleSizeAnchors ?? lines.filter(line => /^\(\s*N\s*=\s*\d+\s*\)$/.test(line.text));
      const headerBottom = anchors.length ? Math.max(...anchors.map(line => line.bottom)) : rules[0];
      const bodyTop = layout.shrBodyTop ?? rules.find(top => top > headerBottom) ?? rules[1];
      const bodyBottom = rules.at(-1);
      const values = lines.filter(line => line.top >= bodyTop && line.bottom <= bodyBottom + line.height && numeric(line.text));
      const dataLeft = layout.shrDataBoundary ?? Math.min(...values.filter(line => line.left > layerRect.width * .15).map(line => line.left));
      const title = lines.find(line => /^表\s*\d+(?:\.\d+)+/.test(line.text) && line.top < (rules[0] ?? layerRect.height));
      const noteRows = lines.filter(line => line.top > bodyBottom && line.top < layerRect.height * .8 && !/^(?:数据源|图表生成日期)/.test(line.text));
      const noteRight = Math.max(...noteRows.map(line => line.right));
      const labels = new Map();
      let previousNote, note = 0, titleTail = title;
      for (const [index, line] of lines.entries()) {
        line.independentReportField = true;
        // 百分号是独立单位，不能与上一行的等级或其他表头文字合并。
        if (/^[（(]?\s*[%％]\s*[)）]?$/.test(line.text)) {
          line.structuredIndependent = true;
          continue;
        }
        if (layout.shrComparativeStatisticalReport && /^[*†‡]+$/.test(line.text)) {
          line.structuredIndependent = true;
          continue;
        }
        if (isShrSampleSize(line.text) || line.top < bodyTop && /^(?:基线|CTCAE级别)$/.test(line.text)) {
          line.structuredIndependent = true;
          continue;
        }
        if (/^SHR-A1811/.test(line.text) && (!layout.shrComparativeStatisticalReport || line.top < rules[0]) || /^(?:Page\s+\d+|恒瑞机密|第\d+\/\d+页|数据源[：:]|图表生成日期[：:])/.test(line.text) || layout.shrStudyStatisticalReport && /^(?:Hengrui Confidential|数据抽取日期|数据截止日期)/.test(line.text)) continue;
        if (title && (line === title || line.top > titleTail.top && line.top < rules[0] && line.top - titleTail.bottom < line.height * .85 && Math.abs(line.left - title.left) < line.height)) {
          line.structuredCell = 'shr-report-title';
          line.independentReportField = false;
          titleTail = line;
          continue;
        }
        if (line.top < bodyTop) {
          if (layout.shrStudyStatisticalReport || !anchors.length || /^\(\s*N\s*=/.test(line.text) || !/^(?:[\d.]+\s*mg\/kg.*|及以上|以上)$/.test(line.text)) continue;
          const center = (line.left + line.right) / 2;
          const anchor = anchors.reduce((best, item) => Math.abs((item.left + item.right) / 2 - center) < Math.abs((best.left + best.right) / 2 - center) ? item : best);
          line.structuredCell = `shr-dose-${anchors.indexOf(anchor)}`;
          line.independentReportField = false;
        } else if (line.bottom <= bodyBottom + line.height * .2) {
          if ((numeric(line.text) || line.left >= dataLeft - line.height) && !(layout.shrComparativeStatisticalReport && line.tableCell !== undefined)) continue;
          const column = layout.shrLabelColumns?.findLastIndex(left => left <= line.left + line.height * .5) ?? 0;
          const label = labels.get(column), labelRight = layout.shrLabelColumns?.[column + 1] ?? dataLeft;
          const newRow = values.some(value => Math.abs(value.top - line.top) < line.height * .45 && !/^\([\d.]+\)$/.test(value.text));
          const wraps = label && !newRow && line.top - label.bottom < line.height * .65 && Math.abs(line.left - label.left) < line.height * 1.8 && (label.right >= labelRight - line.height * 2.5 || /^[(（]/.test(line.text));
          line.structuredCell = layout.shrComparativeStatisticalReport && line.tableCell !== undefined ? line.tableCell : wraps ? label.structuredCell : `shr-row-label-${index}`;
          line.independentReportField = false;
          labels.set(column, line);
        } else if (line.top > bodyBottom && line.top < layerRect.height * .8) {
          if (!previousNote || layout.shrComparativeStatisticalReport && (/^(?:本图|本表)/.test(line.text) || /[。！？][”’\"]?$/.test(previousNote.text) && /^[“\"「『]/.test(line.text) || /[.!?]$/.test(previousNote.text) && previousNote.right < layerRect.width * .92 - line.height * 2) || layout.shrStudyStatisticalReport && /^使用WHODrug/.test(line.text) || /^(?:注\s*[：:]|\[\d+\]|N\s*为|同一\s*SOC|使用\s*(?:CTCAE|MedDRA)|基线定义|年龄[（(]|体重指数[（(])/.test(line.text) || /[。！？]$/.test(previousNote.text) && previousNote.right < (layout.shrStudyStatisticalReport ? layerRect.width * .92 : noteRight) - line.height * 2 || line.top - previousNote.bottom > line.height * .65) note++;
          previousNote = line;
          line.structuredCell = `shr-report-note-${note}`;
          line.independentReportField = false;
        }
      }
      if (layout.shrComparativeStatisticalReport) {
        const fields = groupItemsBy(lines.filter(line => line.tableCell !== undefined && line.top < bodyTop && !line.structuredIndependent && !/^(?:n\s*\(|\(\s*N\s*=)/.test(line.text)), line => line.tableCell);
        for (const [cell, rows] of fields) {
          if (new Set(rows.map(line => line.top.toFixed(2))).size < 2) continue;
          if (rows.filter(line => /^(?:ATC\s*\d|系统器官|首选(?:术语|语|词)|试验人数|率差)/.test(line.text)).length > 1 && !rows.slice(0, -1).some(line => /\/$/.test(line.text))) continue;
          for (const line of rows) {
            line.structuredCell = `${cell}-caption`;
            line.independentReportField = false;
          }
        }
      }
      if (layout.shrComparativeStatisticalReport) {
        for (const [cell, rows] of groupItemsBy(lines.filter(line => line.tableCell !== undefined && line.top >= bodyTop && line.bottom <= bodyBottom), line => line.tableCell)) {
          const isStatus = text => /^(?:是|否|阳性|阴性)$/.test(text);
          const isValue = text => /^[\s\d.,%()[\]<>≤≥=+−–\-±/:T—]+$/.test(text);
          const independentStatus = rows.some(line => isStatus(line.text)) && rows.some(line => isValue(line.text)) && rows.every(line => isStatus(line.text) || isValue(line.text));
          if (!independentStatus) continue;
          for (const line of rows) line.structuredCell = `${cell}-${isValue(line.text) ? 'value' : 'status'}`;
        }
      }
      // 表头名称自己的换行可以合并，不能把 SOC、PT 和样本量等不同表头连在一起。
      for (const first of lines.filter(line => line.top < bodyTop && /^(?:系统器官|首选术语)/.test(line.text))) {
        const tail = lines.find(line => line.top > first.top + first.height * .55 && line.top - first.bottom < first.height * .65 && Math.abs(line.left - first.left) < first.height * 1.8 && /^(?:类?别\s*)?[（(](?:SOC|PT)[)）]$/.test(line.text));
        if (!tail) continue;
        for (const line of [first, tail]) {
          line.structuredCell = `shr-caption-${first.left}-${first.top}`;
          line.structuredIndependent = false;
          line.independentReportField = false;
        }
      }
    };
    /** 无逐行边线的 HPP 统计列表：按真实列线和记录基线划分续行范围。 */
    const markHppListingItems = (items, layerRect, layout) => {
      const scale = layerRect.width / layout.width;
      const rules = layout.rules.map(y => y * scale).filter((y, i, rows) => !i || y - rows[i - 1] > 1.5 * scale);
      if (rules.length < 2) {
        for (const item of items) item.structuredIndependent = true;
        return;
      }
      const top = rules[0], bodyTop = rules.at(-2), bottom = rules.at(-1);
      const segments = layout.hppColumnEdges.filter(edge => Math.abs(edge.top * scale - bodyTop) < scale && edge.right - edge.left > 3).sort((a, b) => a.left - b.left);
      const distinct = segments.filter((edge, i) => !i || Math.abs(edge.left - segments[i - 1].left) > 1);
      if (!distinct.length) {
        for (const item of items) item.structuredIndependent = true;
        return;
      }
      const columns = distinct.map((edge, i) => ({
        left: i ? (distinct[i - 1].right + edge.left) / 2 * scale : edge.left * scale,
        right: distinct[i + 1] ? (edge.right + distinct[i + 1].left) / 2 * scale : edge.right * scale,
        index: i
      }));
      const locate = item => columns.findIndex(column => (item.left + item.right) / 2 >= column.left - scale && (item.left + item.right) / 2 <= column.right + scale);
      for (const column of columns) column.title = items.filter(item => item.top >= top - item.height * .2 && item.bottom <= bodyTop + item.height * .3 && locate(item) === column.index).sort((a, b) => a.top - b.top || a.left - b.left).map(item => item.text).join('').replace(/\s/g, '');
      const body = items.filter(item => item.top >= bodyTop - item.height * .15 && item.bottom <= bottom + item.height * .2).sort((a, b) => a.top - b.top || a.left - b.left);
      const columnLines = new Map(), itemLine = new Map();
      for (const item of body) {
        const column = locate(item);
        if (column < 0) continue;
        if (!columnLines.has(column)) columnLines.set(column, []);
        const rows = columnLines.get(column), last = rows.at(-1);
        let row = last && Math.abs(last.top - item.top) < item.height * .35 ? last : null;
        if (!row) rows.push(row = {top: item.top, bottom: item.bottom, items: []});
        row.items.push(item);
        row.bottom = Math.max(row.bottom, item.bottom);
        itemLine.set(item, row);
      }
      for (const rows of columnLines.values()) for (const row of rows) row.text = row.items.sort((a, b) => a.left - b.left).map(item => item.text).join('').replace(/\s/g, '');
      const recordRows = (columnLines.get(0) || []).filter(row => /^\d{2}\/\d{3}$/.test(row.text)).map(row => row.top);
      const visitColumns = columns.filter(column => /访视/.test(column.title)).map(column => column.index);
      const dateColumns = columns.filter(column => /日期|时间|检查日/.test(column.title) && !/持续/.test(column.title)).map(column => column.index);
      const rowStarts = [...recordRows];
      const priorDates = new Map();
      for (const item of body) {
        const column = locate(item);
        if (column < 0) continue;
        const title = columns[column].title, text = itemLine.get(item).text;
        const visit = visitColumns.includes(column) && /^(?:筛选|基线|核心|扩展|治疗|随访|提前|计划|非计划|第\d|D\d|V\d)/.test(text);
        const date = dateColumns.includes(column) && /^\d{4}[-/]\d{1,2}[-/]/.test(text);
        const previousDate = priorDates.get(column);
        if (date) priorDates.set(column, item);
        const dateContinuation = date && previousDate && /\/$/.test(previousDate.text) && item.top - previousDate.bottom < item.height * .65;
        const atomic = column >= 2 && (/^(?:是|否|阴性|阳性|正常|异常(?:有临床意义|无临床意义)?|未测|未查)$/.test(text) || /^(?:\d+(?:\.\d+)?|[-–]|NE|NA)$/.test(text) && !/日期|时间|编号|范围|组别|访视|剂量|药量/.test(title));
        if (visit || date && !dateContinuation || atomic) rowStarts.push(item.top);
      }
      // 没有访视/日期的方案偏离表，类别列的独立段落给出下一条记录的起点。
      if (!visitColumns.length && !dateColumns.length) {
        for (const column of columns.filter(column => /类别|分类|子类/.test(column.title))) {
          let previous;
          for (const row of columnLines.get(column.index) || []) {
            const height = row.items[0].height,
              width = Math.max(...row.items.map(item => item.right)) - Math.min(...row.items.map(item => item.left));
            const previousWidth = previous && Math.max(...previous.items.map(item => item.right)) - Math.min(...previous.items.map(item => item.left));
            const nextDescription = /^(?:受试者在|受试者患者|研究药物不是|访视超出)/.test(row.text);
            if (!previous || row.top - previous.bottom > height * .65 || nextDescription || previousWidth < (column.right - column.left) * .55 && width > previousWidth + height) rowStarts.push(row.top);
            previous = row;
          }
        }
      }
      const rowHeight = Math.max(1, ...body.map(item => item.height));
      const dedupe = values => values.sort((a, b) => a - b).filter((y, i, a) => !i || y - a[i - 1] > rowHeight * .45);
      const rows = dedupe(rowStarts), records = dedupe(recordRows);
      const metadataTop = Math.min(layerRect.height, ...items.filter(item => /^(?:程序路径|文件路径|运行时间)/.test(item.text)).map(item => item.top));
      let note = 0, previousNote;
      for (const item of items.sort((a, b) => a.top - b.top || a.left - b.left)) {
        const columnIndex = locate(item), column = columns[columnIndex];
        if (item.top < top) {
          item.structuredIndependent = true;
          continue;
        }
        if (item.top >= metadataTop - item.height * .3) {
          item.structuredIndependent = true;
          continue;
        }
        if (item.top >= bottom) {
          if (!previousNote || /^(?:注|注释|说明|备注)\s*[：:]/.test(item.text) || item.top - previousNote.bottom > item.height * .65 || item.top > previousNote.top + item.height * .55 && /[。！？]$/.test(previousNote.text) && previousNote.right < layerRect.width * .9 - item.height * 2) note++;
          item.structuredCell = `hpp-note-${note}`;
          previousNote = item;
          continue;
        }
        if (!column) {
          item.structuredIndependent = true;
          continue;
        }
        if (item.top < bodyTop - item.height * .15) {
          // 同列 SOC/PT/不良事件名称是分开的表头；单位百分号也独立保留。
          if (/^[（(]?[%％][)）]?$/.test(item.text.replace(/\s/g, '')) || /系统器官分类/.test(column.title) && /首选术语/.test(column.title) || /系统器官分类|首选术语|不良事件名称/.test(item.text)) {
            item.structuredIndependent = true;
            continue;
          }
          item.tableCell = item.structuredCell = `hpp-header-${columnIndex}`;
          item.tableBounds = {left: column.left, right: column.right, top, bottom: bodyTop};
          continue;
        }
        const spanningRecord = columnIndex === 0 || /组别/.test(column.title);
        const starts = spanningRecord ? records : rows;
        const row = starts.findLastIndex(y => y <= item.top + item.height * .4);
        const rowTop = starts[row] ?? bodyTop, rowBottom = starts[row + 1] ?? bottom;
        item.tableCell = item.structuredCell = `hpp-body-${columnIndex}-${row}`;
        item.tableBounds = {left: column.left, right: column.right, top: rowTop, bottom: rowBottom};
        if (/^[\d.]+$/.test(itemLine.get(item)?.text || '') && !/日期|时间|组别/.test(column.title) || /^(?:是|否|正常|异常(?:有临床意义|无临床意义)?|阴性|阳性|NE|NA|N\/A)$/.test(itemLine.get(item)?.text || '')) item.structuredIndependent = true;
      }
      // 同一受试者的组别可能在多个数据行重复打印；每个新组别值独立，续行仍保留。
      for (const column of columns.filter(column => /组别/.test(column.title))) {
        let previous, part = 0;
        for (const row of columnLines.get(column.index) || []) {
          const cell = row.items[0].tableCell;
          if (!previous || cell !== previous.cell) part = 0;
          else if (/^(?:HPP737|安慰剂)/.test(row.text) && !/_$/.test(previous.text)) part++;
          for (const item of row.items) item.structuredCell = `${cell}-group-${part}`;
          previous = {cell, text: row.text};
        }
      }
      // SOC、PT 和报告名称以斜杠分隔；仅连接每个名称自己的换行。
      for (const column of columns.filter(column => /系统器官分类/.test(column.title) && /首选术语/.test(column.title))) {
        let previous, part = 0;
        for (const row of columnLines.get(column.index) || []) {
          const cell = row.items[0].tableCell;
          if (!previous || cell !== previous.cell) part = 0;
          else if (/\/$/.test(previous.text)) part++;
          for (const item of row.items) item.structuredCell = `${cell}-field-${part}`;
          previous = {cell, text: row.text};
        }
      }
      layout.hppColumns = columns;
      layout.hppBodyTop = bodyTop;
      layout.hppBodyBottom = bottom;
    };

    const getSmartMergeParagraphs = (textLayer, pageNum, formLayout = null) => {
      const layerRect = textLayer.getBoundingClientRect();
      const isCm313NarrativePage = smartMergeDocumentProfile === 'cm313-blank-crf' && [59, 60, 61, 62, 64, 65, 66, 67].indexOf(pageNum) !== -1;
      // 这四页的长篇入选/排除标准需要按业务段落合并，而不能被行末句号或
      // PDF 内部为了对齐而插入的较大字间距切碎。断点与页面上的自然分段一致：
      // 60/65 页从第 5 条 c) 开始第二段，62/67 页从第 10 条开始第二段。
      const isCm313TwoPartNarrativePage = smartMergeDocumentProfile === 'cm313-blank-crf' && [60, 62, 65, 67].indexOf(pageNum) !== -1;
      const isTqc3721Ecrf = smartMergeDocumentProfile === 'tqc3721-ecrf';
      const statisticalReport = !!formLayout?.statisticalReport;
      const reportRules = statisticalReport ? formLayout.rules.map(top => top * layerRect.width / formLayout.width) : [];
      const sourceItems = deduplicateTextItems([...textLayer.querySelectorAll('span')].filter(span => !span.classList.contains('is-merged') && !!cleanTextForMatch(span.textContent)).map((span, index) => {
        const rect = span.getBoundingClientRect();
        const text = cleanTextForMatch(span.textContent);
        const source = formLayout?.sourceGeometry?.get(Number(span.dataset.sourceIndex));
        const scale = layerRect.width / (formLayout?.width || layerRect.width);
        const useSource = source && source.text === text && !span.classList.contains('is-json-replaced');
        return {
          span,
          index,
          left: useSource ? source.left * scale : rect.left - layerRect.left,
          top: useSource ? source.top * scale : rect.top - layerRect.top,
          right: useSource ? source.right * scale : rect.right - layerRect.left,
          bottom: useSource ? source.bottom * scale : rect.bottom - layerRect.top,
          height: useSource ? source.height * scale : rect.height,
          text
        };
      }));
      // 原 PDF 底部的版本标记是页脚，不能成为最后一条稽查说明的续行。
      const footerItems = sourceItems.filter(item => item.top > layerRect.height * 0.8 && /^PRO_\d+(?:\.\d+)*\s*\(\s*\d+\s*\)$/i.test(item.text));
      const auditContentBottom = Math.min(layerRect.height, ...footerItems.map(item => item.top));
      const raw = sourceItems.filter(item => !footerItems.includes(item));
      if (formLayout?.shrStatisticalReport && !formLayout.directory) {
        // 先分开数字和文字、相邻剂量列，再按视觉行组合，避免间距过小导致跨列。
        let anchors = raw.flatMap(item => {
          if (/^\(\s*N\s*=\s*\d+\s*\)$/.test(item.text)) return [item];
          if (!/^\(\s*N\s*=\s*\d*$/.test(item.text)) return [];
          // 样本量偶尔被拆为 '(N=' 和 '98)'，仍需定位到完整数据列中心。
          const tail = raw.find(part => /^\d*\)$/.test(part.text) && Math.abs(part.top - item.top) < item.height * .3 && Math.abs(part.left - item.right) < item.height * .2);
          return tail ? [{...item, right: tail.right, bottom: Math.max(item.bottom, tail.bottom)}] : [];
        });
        const scale = layerRect.width / formLayout.width, bodyBottom = formLayout.rules.at(-1) * scale;
        const rules = formLayout.rules.map(top => top * scale);
        const units = formLayout.shrStudyStatisticalReport ? raw.filter(item => /^n\s*\(\s*%\s*\)$/.test(item.text)) : [];
        let headerBottom = Math.max(...anchors.map(item => item.bottom));
        let bodyTop = anchors.length ? headerBottom : rules[1];
        if (formLayout.shrStudyStatisticalReport) {
          const markers = units.length ? units : anchors;
          const firstTop = Math.min(...markers.map(item => item.top));
          const header = markers.filter(item => Math.abs(item.top - firstTop) < item.height * .5);
          headerBottom = header.length ? Math.max(...header.map(item => item.bottom)) : rules[0];
          bodyTop = rules.find(top => top > headerBottom) ?? rules[1];
          anchors = anchors.filter(item => item.top < bodyTop);
          formLayout.shrBodyTop = bodyTop;
        }
        formLayout.shrSampleSizeAnchors = anchors;
        const columns = anchors.length || !formLayout.shrStudyStatisticalReport ? anchors : units.length ? units : raw.filter(item => item.top < bodyTop && /^[\d.]+\s*mg\/kg/.test(item.text));
        const centers = columns.map(item => (item.left + item.right) / 2).sort((a, b) => a - b);
        // 用真实数据列中心之间的中点划分标签列；标签中的数字不能拆成统计值。
        let dataBoundary = centers.length > 1 ? centers[0] - (centers[1] - centers[0]) / 2 : layerRect.width * .15;
        if (formLayout.shrComparativeStatisticalReport && columns.length) {
          const first = columns.reduce((left, item) => item.left < left.left ? item : left);
          const x = (first.left + first.right) / (2 * scale), y = (first.top + first.bottom) / (2 * scale);
          const cells = formLayout.textCells.filter(cell => cell.left <= x && cell.right >= x && cell.top <= y && cell.bottom >= y).sort((a, b) => b.right - b.left - (a.right - a.left));
          if (cells.length) dataBoundary = cells[0].left * scale;
        }
        if (formLayout.shrStudyStatisticalReport) {
          formLayout.shrDataBoundary = dataBoundary;
          // 转换表有检查项目、剂量组、基线判断等多个文字列，各列独立接续。
          const top = Math.min(...units.map(item => item.top));
          const labels = raw.filter(item => Math.abs(item.top - top) < item.height * .5 && item.left < dataBoundary && !/^n\s*\(/.test(item.text)).map(item => item.left).sort((a, b) => a - b);
          formLayout.shrLabelColumns = labels.filter((left, index) => !index || left - labels[index - 1] > 9 * scale);
        }
        for (const item of raw) {
          if (!formLayout.shrComparativeStatisticalReport && item.left >= dataBoundary && item.top >= bodyTop && item.bottom <= bodyBottom + item.height * .2 && /\d/.test(item.text) && /^[\s\d.,%()[\]<>≤≥=+−–\-±/]+$/.test(item.text) || /^\(\s*N\s*=/.test(item.text)) {
            item.structuredIndependent = true;
            continue;
          }
          if (formLayout.shrStudyStatisticalReport && item.top >= bodyTop && item.bottom <= bodyBottom + item.height * .2 && item.left < dataBoundary && formLayout.shrLabelColumns.length > 1) {
            item.structuredCell = `shr-label-column-${formLayout.shrLabelColumns.findLastIndex(left => left <= item.left + item.height * .5)}`;
          }
          if (anchors.length && item.top < headerBottom) {
            const center = (item.left + item.right) / 2;
            const anchor = anchors.reduce((best, point) => Math.abs((point.left + point.right) / 2 - center) < Math.abs((best.left + best.right) / 2 - center) ? point : best);
            item.structuredCell = `shr-header-column-${anchors.indexOf(anchor)}`;
          }
        }
      }
      if (formLayout?.textCells?.length) {
        const scale = layerRect.width / formLayout.width;
        for (const item of raw) {
          const x = (item.left + item.right) / (2 * scale), y = (item.top + item.bottom) / (2 * scale);
          const candidates = formLayout.textCells.filter(box => box.left <= x && box.right >= x && box.top <= y && box.bottom >= y && item.left >= box.left * scale - item.height * .25 && item.right <= box.right * scale + item.height * (formLayout.shrComparativeStatisticalReport ? .65 : .25));
          candidates.sort((a, b) => b.right - b.left - (a.right - a.left) || b.bottom - b.top - (a.bottom - a.top));
          const cell = candidates[0];
          if (!cell) continue;
          item.tableCell = `listing-${[cell.left, cell.right, cell.top, cell.bottom].map(v => v.toFixed(2)).join('-')}`;
          if (formLayout.shrComparativeStatisticalReport) item.structuredCell = item.tableCell;
          item.tableBounds = Object.fromEntries(Object.entries(cell).map(([key, value]) => [key, value * scale]));
        }
      }
      if (formLayout?.hppStatisticalListing) markHppListingItems(raw, layerRect, formLayout);
      // 给药列表的原因栏逐行填充背景；按受试者记录重建整格，不能把背景行当成字段。
      if (formLayout?.shrComparativeStatisticalReport && raw.some(item => item.text === '受试者号') && raw.some(item => item.text === '访视')) {
        const scale = layerRect.width / formLayout.width, bodyTop = formLayout.rules[1] * scale,
          bodyBottom = formLayout.rules.at(-1) * scale;
        const visit = raw.find(item => item.text === '访视');
        const records = raw.filter(item => /^C\d+D\d+$/.test(item.text) && Math.abs((item.left + item.right - visit.left - visit.right) / 2) < item.height && item.top >= bodyTop && item.bottom <= bodyBottom).sort((a, b) => a.top - b.top);
        const captions = groupItemsBy(raw.filter(item => item.tableCell !== undefined && item.top < bodyTop), item => item.tableCell);
        for (const [caption, parts] of captions) {
          if (!/^(?:是否未给药|计划剂量是否|输液是否中断).*原因/.test(parts.map(item => item.text).join(''))) continue;
          const bounds = parts[0].tableBounds;
          for (const [index, record] of records.entries()) {
            const top = record.top - record.height * .25,
              bottom = records[index + 1]?.top - record.height * .25 || bodyBottom;
            const items = raw.filter(item => item.tableCell !== undefined && item.top >= top && item.bottom <= bottom + item.height * .2 && (item.left + item.right) / 2 > bounds.left && (item.left + item.right) / 2 < bounds.right);
            if (new Set(items.map(item => item.top.toFixed(2))).size < 2 || !items.some(item => /[A-Za-z]{3,}|[\u3400-\u9fff]{3,}/.test(item.text))) continue;
            for (const item of items) {
              item.tableCell = item.structuredCell = `${caption}-reason-${index}`;
              item.tableBounds = {left: bounds.left, right: bounds.right, top, bottom};
            }
          }
        }
      }
      if (formLayout?.nativeTable && smartMergeDocumentProfile !== 'shr-data-review') {
        const metadata = raw.filter(item => /^(?:Source Data[:：]|Date of Data |Date of Table |数据源[:：]|数据抽取日期|数据截止日期|图表生成日期)/i.test(item.text) || (item.top < layerRect.height * .12 || item.top > layerRect.height * .9) && /^(?:SHR-A1811|Page\s+\d+|Hengrui Confidential|恒瑞机密|第\d+\/\d+页|\d+\s*\/\s*\d+\s*$)/.test(item.text));
        for (const item of raw) if (metadata.some(marker => Math.abs(marker.top - item.top) < item.height * .4)) item.structuredIndependent = true;
      }
      if (formLayout?.shrStatisticalReport) {
        const sampleSizes = raw.filter(item => isShrSampleSize(item.text));
        for (const item of raw) if (sampleSizes.some(sample => Math.abs(sample.top - item.top) < item.height * .4 && (sample === item || sample.tableCell !== undefined && sample.tableCell === item.tableCell || /^[\[［]\d+[\]］]$/.test(item.text) && Math.abs(sample.left - item.right) < item.height))) item.structuredIndependent = true;
      }
      // 研究报告中的表格使用实际横、竖线确认四边闭合的单元格。
      // 把 ID 赋给原始文字对象，避免同行片段先跨列拼接，再发生错误续行。
      if (formLayout?.edges?.length) {
        const scale = layerRect.width / formLayout.width;
        const horizontal = formLayout.edges.filter(edge => edge.bottom - edge.top < 0.75);
        const vertical = formLayout.edges.filter(edge => edge.right - edge.left < 0.75);
        raw.forEach(item => {
          const x = (item.left + item.right) / (2 * scale), y = (item.top + item.bottom) / (2 * scale);
          const sides = vertical.filter(edge => edge.top <= y && edge.bottom >= y);
          const left = closestEdge(sides, 'left', x, true);
          const right = closestEdge(sides, 'left', x, false);
          if (!left || !right) return;
          const rows = horizontal.filter(edge => edge.left <= left.left + 0.75 && edge.right >= right.left - 0.75);
          const top = closestEdge(rows, 'top', y, true);
          const bottom = closestEdge(rows, 'top', y, false);
          if (!top || !bottom || sides.some(edge => edge.left > left.left + 0.75 && edge.left < right.left - 0.75) || left.top > top.top + 0.75 || right.top > top.top + 0.75 || left.bottom < bottom.top - 0.75 || right.bottom < bottom.top - 0.75) return;
          if (item.left < left.left * scale - item.height * 0.3 || item.right > right.left * scale + item.height * 0.3) return;
          item.tableCell = [left.left, right.left, top.top, bottom.top].map(value => value.toFixed(2)).join('-');
          item.tableBounds = {
            left: left.left * scale,
            right: right.left * scale,
            top: top.top * scale,
            bottom: bottom.top * scale
          };
        });
      }
      if (smartMergeDocumentProfile === 'shr-drug-batch-table') {
        const anchors = raw.filter(item => /^CN\d+$/.test(item.text)).sort((a, b) => a.top - b.top || a.left - b.left);
        const records = anchors.filter((item, index) => !index || Math.abs(item.top - anchors[index - 1].top) > item.height * .35);
        let columns = formLayout?.batchColumns?.map(left => left * layerRect.width / formLayout.width);
        if (records.length) {
          const firstRow = raw.filter(item => Math.abs(item.bottom - records[0].bottom) < item.height * .6).sort((a, b) => a.left - b.left);
          const identifiers = firstRow.filter(item => /^CN\d+$/.test(item.text)),
            visit = firstRow.find(item => /^C\d+(?:D\d+)?$/.test(item.text));
          const dosage = firstRow.find(item => /(?:mg|g)\/(?:片|粒|瓶)/i.test(item.text)),
            form = firstRow.find(item => /^(?:片剂|胶囊剂|注射剂)/.test(item.text));
          const drug = visit && firstRow.find(item => item.left > visit.right && /[A-Za-z]/.test(item.text));
          const batch = drug && dosage && firstRow.find(item => item.left > drug.right && item.right <= dosage.left + item.height);
          const specification = dosage && form && firstRow.filter(item => item.left >= dosage.left && item.right <= form.left);
          const dates = form && firstRow.filter(item => item.left > form.right);
          if (identifiers.length === 2 && visit && drug && batch && specification?.length && dates?.length === 2) {
            columns = [...identifiers, visit, drug, batch].map(item => (item.left + item.right) / 2);
            columns.push((specification[0].left + specification.at(-1).right) / 2, (form.left + form.right) / 2, ...dates.map(item => (item.left + item.right) / 2));
          }
        }
        for (const item of raw) {
          if (isShrBatchHeader(item.text)) {
            item.structuredIndependent = true;
            continue;
          }
          if (!records.length || item.bottom < records[0].top || item.top > records.at(-1).bottom + item.height * 2) continue;
          if (!columns?.length) {
            const row = records.findIndex(record => Math.abs(record.bottom - item.bottom) < item.height * .35);
            if (row >= 0) item.structuredCell = `batch-row-${row}`;
            continue;
          }
          const sourceBounds = item.tableBounds;
          const center = sourceBounds && sourceBounds.bottom - sourceBounds.top > item.height * 1.25 ? (sourceBounds.top + sourceBounds.bottom) / 2 : (item.top + item.bottom) / 2;
          const row = records.findIndex((record, index) => !records[index + 1] || center < (record.top + record.bottom + records[index + 1].top + records[index + 1].bottom) / 4);
          const x = (item.left + item.right) / 2;
          const column = columns.findIndex((left, index) => !columns[index + 1] || x < (left + columns[index + 1]) / 2);
          item.tableCell = item.structuredCell = `batch-row-${row}-column-${column}`;
          item.tableBounds = {
            left: Math.min(item.left, column ? (columns[column - 1] + columns[column]) / 2 : 0),
            right: Math.max(item.right, columns[column + 1] ? (columns[column] + columns[column + 1]) / 2 : layerRect.width),
            top: Math.min(item.top, sourceBounds?.top ?? (row ? (records[row - 1].bottom + records[row].top) / 2 : records[0].top - item.height)),
            bottom: Math.max(item.bottom, sourceBounds?.bottom ?? (records[row + 1] ? (records[row].bottom + records[row + 1].top) / 2 : records.at(-1).bottom + item.height * 2))
          };
        }
        for (const items of groupItemsBy(raw.filter(item => item.tableCell?.startsWith('batch-row-')), item => item.tableCell).values()) {
          const bounds = {
            left: Math.min(...items.map(item => item.tableBounds.left)),
            right: Math.max(...items.map(item => item.tableBounds.right)),
            top: Math.min(...items.map(item => item.tableBounds.top)),
            bottom: Math.max(...items.map(item => item.tableBounds.bottom))
          };
          for (const item of items) item.tableBounds = bounds;
        }
      }
      if (smartMergeDocumentProfile === 'shr-data-review') {
        const markers = raw.filter(item => /^CN\d+$/.test(item.text) || item.left < layerRect.width * .45 && /^(?:意向性治疗分析集|安全性分析集|(?:PK\s*)?浓度分析集|免疫原性分析集)/.test(item.text));
        for (const item of raw) {
          if (/^•$/.test(item.text) || item.top < layerRect.height * .085 || item.top > layerRect.height * .9) {
            item.structuredIndependent = true;
            continue;
          }
          if (item.tableCell === undefined) continue;
          const box = item.tableBounds;
          const rows = markers.filter(marker => marker.top >= box.top - marker.height && marker.bottom <= box.bottom + marker.height).map(marker => {
            const tail = /^CN/.test(marker.text) ? [] : raw.filter(part => part.tableCell === marker.tableCell && part.top > marker.top + marker.height * .55 && part.top - marker.bottom < marker.height * .8 && /^(?:ITT|SS|PKCS|ADAS)[）)]/.test(part.text));
            return {...marker, bottom: Math.max(marker.bottom, ...tail.map(part => part.bottom))};
          }).sort((a, b) => a.top - b.top);
          if (!rows.length || /^(?:方案偏离详述|数据分析集|纳入人群|是否新抗|[15]\s*例(?:违禁用药|违反入排))/.test(item.text)) {
            item.structuredIndependent = true;
            continue;
          }
          const center = (item.top + item.bottom) / 2;
          const row = rows.findIndex((marker, index) => !rows[index + 1] || center < (marker.top + marker.bottom + rows[index + 1].top + rows[index + 1].bottom) / 4);
          item.structuredCell = `${item.tableCell}-review-row-${row}`;
        }
      }
      raw.sort((a, b) => a.top - b.top || a.left - b.left);
      markStructuredCrfItems(raw, layerRect, formLayout);
      const visualRows = [];
      raw.forEach(item => {
        const line = visualRows.length ? visualRows[visualRows.length - 1] : null;
        // 同一文本行允许少量基线偏差，兼容不同字号/上标。
        const tolerance = Math.max(3, item.height * 0.45);
        if (!line || Math.abs(item.top - line.top) > tolerance) {
          visualRows.push({
            top: item.top,
            bottom: item.bottom,
            left: item.left,
            right: item.right,
            height: item.height,
            items: [item]
          });
        } else {
          line.items.push(item);
          line.top = Math.min(line.top, item.top);
          line.bottom = Math.max(line.bottom, item.bottom);
          line.left = Math.min(line.left, item.left);
          line.right = Math.max(line.right, item.right);
          line.height = Math.max(line.height, item.height);
        }
      });
      // eCollect 研究标题页眉的行距略大于正文；仅在同一研究标题块内放宽。
      // 首行由标识定位，续行必须字号一致且对齐，不能吞并章节标题或表单字段。
      if (smartMergeDocumentProfile === 'generic') {
        const rowText = row => [...row.items].sort((a, b) => a.left - b.left).map(item => item.text).join('').replace(/\s+/g, '');
        const header = visualRows.find(row => row.top < layerRect.height * 0.06 && /^eCollect/i.test(rowText(row)));
        if (header) {
          const markBlock = (first, name, matches) => {
            first.studyTextBlock = name;
            let previous = first;
            for (const row of visualRows.slice(visualRows.indexOf(first) + 1)) {
              const gap = row.top - previous.bottom;
              const overlap = Math.min(row.right, previous.right) - Math.max(row.left, previous.left);
              if (Math.abs(row.height - first.height) > first.height * 0.15 || gap < -first.height * 0.3 || gap > first.height * 0.82 || overlap <= 0 || !matches(row)) break;
              row.studyTextBlock = name;
              previous = row;
            }
          };
          markBlock(header, 'study-header', row => row.top < layerRect.height * 0.065 && Math.abs(row.left - header.left) < header.height);
          // 受试者章节也可能有同版式封面，按页眉与标题内容匹配，不限制页码。
          const headerText = visualRows.filter(row => row.studyTextBlock === 'study-header').map(rowText).join('');
          const title = visualRows.find(row => row.top > layerRect.height * 0.15 && row.top < layerRect.height * 0.7 && row.height >= header.height * 1.6 && row.right - row.left > layerRect.width * 0.5 && headerText.includes(rowText(row)));
          if (title) markBlock(title, 'study-title', row => headerText.includes(rowText(row)));
        }
      }
      const beginsNumberedField = text => /^(?:\d{1,2}[A-Za-z]?(?:-\d{1,2}[A-Za-z]?)?[.)]|[A-Za-z]\d?[.)])\s*[A-Z]/.test(text || '');
      const beginsDotFieldLabel = text => /^\d{1,2}[A-Za-z]?(?:-\d{1,2}[A-Za-z]?)?\.\s*[A-Z]/.test(text || '');
      const isUppercaseLabelContinuation = text => {
        const value = (text || '').replace(/[^A-Za-z]+/g, ' ').trim();
        if (!value || value.split(/\s+/).length < 2) return false;
        return value === value.toUpperCase();
      };
      const isFormFieldLabel = text => {
        const value = (text || '').replace(/\s+/g, ' ').trim();
        if (beginsDotFieldLabel(value)) return true;
        return /^(?:Active Substance|Drug Characterization|Form Strength|Form of Admin|Lot Number|Daily Dose|Route of Admin|Indications|Therapy Dates|Therapy Duration|Action\(s\) Taken With Drug|Causality(?: as per (?:reporter|Mfr))?|DeChallenge|ReChallenge|Labeling|Dosage Text|Test Name|Test Date|Result Unstructured Data(?: \(free text\))?|Study Name|Registration Number|Registration Country|EudraCT Number|Protocol No\.?|Center No\.?|Subject Id|Event Description)\s*:?[\s]*$/i.test(value);
      };
      const isStandaloneDateOrPage = text => {
        const value = (text || '').trim();
        return /^(?:\d{1,2}[/-][A-Za-z]{3}[/-]\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|Page\s+\d+\s+of\s+\d+|空白模板|eCRF版本\s*:.*)$/i.test(value);
      };
      const isCheckboxOptionStart = text => {
        const value = (text || '').trim();
        return /^[○◯□☐●■✓✔]/.test(value) || /^(?:PATIENT DIED|LIFE THREATENING|INVOLVED OR|RESULTS IN|CONGENITAL ANOMALY|OTHER MEDICALLY)\b/i.test(value);
      };
      const isCm313NarrativePartStart = text => {
        if (!isCm313TwoPartNarrativePage) return false;
        const value = (text || '').replace(/\s+/g, ' ').trim();
        if (pageNum === 60 || pageNum === 65) {
          return /^c\)\s*受试者既往接受过/.test(value);
        }
        return /^排除标准\s*2\.?0\s*[：:]?/.test(value) || /^10\.\s*人类免疫缺陷病毒/.test(value);
      };

      // TQC3721 稽查痕迹中的“操作 / 值 / 备注 / 理由”均为独立字段。即使上下两行
      // 距离很近，也不能把后一字段当作前一字段的自动换行。
      const isTqcAuditFieldStart = text => {
        if (!isTqc3721Ecrf) return false;
        return /^(?:操作|值|备注|理由)\s*[：:]/.test((text || '').trim());
      };

      // 用药/治疗说明页中的剂量单位、剂型、频率、给药途径等各自都是独立
      // 说明段。它们内部可以跨多行，但下一条带业务前缀的说明必须另起一段。
      const isTqcStructuredDescriptionStart = text => {
        if (!isTqc3721Ecrf) return false;
        const value = (text || '').replace(/\s+/g, ' ').trim();
        return /^(?:既往及伴随用药(?:\([^)]*\))?(?:\/既往及伴随治疗(?:\([^)]*\))?)?|既往及伴随治疗(?:\([^)]*\))?)\s*[：:]/.test(value);
      };
      const isTqcLabAssessment = text => {
        if (!isTqc3721Ecrf) return false;
        return /^(?:正常|异常无临床意义|异常有临床意义|未查)$/.test((text || '').replace(/\s+/g, ''));
      };
      const isTqcLabUnit = text => {
        if (!isTqc3721Ecrf) return false;
        const value = (text || '').replace(/\s+/g, '');
        return value.length > 0 && value.length <= 16 && /^[A-Za-z0-9μµ⁰¹²³⁴⁵⁶⁷⁸⁹/*%.^-]+$/.test(value);
      };
      const isTqcLabReferenceRange = text => {
        if (!isTqc3721Ecrf) return false;
        return /^[xX](?:<=|>=|<|>|=)/.test((text || '').replace(/\s+/g, ''));
      };
      const beginsTqcQueryAction = text => {
        if (!isTqc3721Ecrf) return false;
        return /^操作\s*[：:].*质疑\s*[：:]/.test((text || '').trim());
      };

      // 表单的一条视觉行中可能同时存在多个单元格。先按横向空隙和字段编号
      // 拆为独立片段，避免把整行表格误认为一个文本段落。
      const auditColumns = visualRows.flatMap(row => {
        const user = row.items.find(item => /^用户$/.test(item.text));
        const audit = row.items.find(item => /^稽查(?:痕迹)?$/.test(item.text));
        const time = row.items.find(item => /^(?:时间|日期)(?:\s*\([^)]*\))?$/.test(item.text));
        return user && audit && time && audit.left < user.left && user.left < time.left ? [{
          top: row.top,
          auditLeft: audit.left,
          userLeft: user.left,
          timeLeft: time.left
        }] : [];
      });
      // 稽查说明可能被拆为同一行的多个对象，再从左栏起点换行。
      // 用时间列限定每条记录的范围；同一时间记录内的左栏文字属于一个整体，
      // 不能因中途出现句号、引号或 Data Entry Error 而拆成多个合并框。
      auditColumns.forEach((header, headerIndex) => {
        const endTop = Math.min(auditColumns[headerIndex + 1]?.top ?? layerRect.height, auditContentBottom);
        const records = raw.filter(item => item.top > header.top && item.top < endTop && Math.abs(item.left - header.timeLeft) < item.height && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}/.test(item.text));
        records.forEach((record, recordIndex) => {
          const rowEnd = records[recordIndex + 1]?.top ?? endTop;
          const items = raw.filter(item => item.top >= record.top - item.height * 0.3 && item.top < rowEnd - item.height * 0.3 && item.left >= header.auditLeft - item.height * 0.5 && item.right <= header.userLeft);
          items.forEach(item => {
            item.auditReasonCell = `${headerIndex}-${recordIndex}`;
          });
        });
      });
      const lines = [];
      visualRows.forEach(row => {
        const columns = auditColumns.filter(header => header.top <= row.top).at(-1);
        row.items.sort((a, b) => a.left - b.left);
        let segment = null;
        row.items.forEach(item => {
          const gap = segment ? item.left - segment.right : 0;
          // 使用接近一个字符宽度的阈值；表格相邻单元格即使处于同一基线也要拆开。
          // CM313 表格的字段名与右侧“○选项”有时只相隔约一个字符。
          // 选项符号必须强制开启新片段；同时略收紧横向空隙阈值，避免跨单元格串联。
          // 第 62/67 页第 7、8 条在同一视觉行内被 PDF 拆成两个文字对象，
          // 中间约有 24px 的排版空隙。这里仅对指定长说明页放宽阈值，保证
          // “7./8.”后的正文不会变成短小孤段并在过滤阶段丢失。
          const splitGapRatio = isCm313TwoPartNarrativePage ? 3.2 : smartMergeDocumentProfile === 'cm313-blank-crf' || isTqc3721Ecrf ? 0.65 : 0.85;
          const splitGap = Math.max(4, row.height * splitGapRatio);
          // 该版式页眉的文档编号与页面名称位于两个相邻单元格，边界处只有约
          // 半个字符的空隙，不能只按通用 gap 阈值判断。先把两个单元格拆开，
          // 再分别把 “TQC3721-D8- / II-01” 与 “……标 / 准”做纵向合并。
          const segmentCompact = segment ? segment.items.map(segmentItem => segmentItem.text || '').join('').replace(/\s+/g, '') : '';
          const tqcHeaderCellSplit = isTqc3721Ecrf && segment && /^TQC3721-D8-$/i.test(segmentCompact) && !/^II-01$/i.test((item.text || '').replace(/\s+/g, ''));
          // 左列的长质疑文字有时几乎贴到用户列，仍须按表头确定的列界拆开。
          const auditCellSplit = columns && segment && [columns.userLeft, columns.timeLeft].some(left => segment.left < left - item.height * 0.5 && item.left >= left - item.height * 0.5);
          const sameAuditReason = segment && item.auditReasonCell !== undefined && segment.auditReasonCell === item.auditReasonCell;
          const sameListingCell = ['hpp737-statistical-listing', 'shr-subject-listing', 'shr-comparative-statistical-report', 'shr-drug-batch-table', 'shr-data-review'].includes(smartMergeDocumentProfile) && item.tableCell !== undefined && segment?.tableCell === item.tableCell;
          const shouldSplit = segment && !row.studyTextBlock && (segment.structuredCell !== item.structuredCell || item.structuredIndependent || segment.structuredIndependent || segment.tableCell !== item.tableCell || gap > splitGap && !sameAuditReason && !sameListingCell || !isCm313NarrativePage && beginsNumberedField(item.text) && !(['hpp737-statistical-listing', 'shr-comparative-statistical-report'].includes(smartMergeDocumentProfile) && sameListingCell) || isCheckboxOptionStart(item.text) || tqcHeaderCellSplit || auditCellSplit);
          if (!segment || shouldSplit) {
            segment = {
              top: item.top,
              bottom: item.bottom,
              left: item.left,
              right: item.right,
              height: item.height,
              items: [item],
              previous: null,
              next: null,
              fieldLabelChain: false,
              checkboxChain: false,
              tqcQueryChain: false,
              studyTextBlock: row.studyTextBlock,
              structuredCell: item.structuredCell,
              structuredIndependent: item.structuredIndependent,
              tableCell: item.tableCell,
              tableBounds: item.tableBounds,
              auditReasonCell: item.auditReasonCell
            };
            lines.push(segment);
          } else {
            segment.items.push(item);
            segment.top = Math.min(segment.top, item.top);
            segment.bottom = Math.max(segment.bottom, item.bottom);
            segment.right = Math.max(segment.right, item.right);
            segment.height = Math.max(segment.height, item.height);
          }
        });
      });
      lines.forEach(line => {
        line.text = formLayout?.hppStatisticalListing ? joinMergedTextParts(line.items.map(item => item.text)) : line.items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
      });
      lines.sort((a, b) => a.top - b.top || a.left - b.left);

      if (statisticalReport && !formLayout.shrStatisticalReport && !formLayout.hppStatisticalListing) {
        const scale = layerRect.width / formLayout.width;
        const rules = formLayout.rules.map(top => top * scale);
        const metadata = lines.filter(line => /(?:程序路径|文件路径|运行时间)\s*[：:]/.test(line.text));
        const metadataTop = Math.min(...metadata.map(line => line.top));
        const headerMarkers = lines.filter(line => /^(?:\(\s*N\s*=|n\s*\([^)]*\))/i.test(line.text));
        const bands = headerMarkers.map(marker => ({
          top: rules.filter(top => top < marker.top).at(-1) ?? marker.top - marker.height * 2.5,
          bottom: rules.find(top => top > marker.bottom) ?? marker.bottom + marker.height * 0.2
        }));
        if (rules.length > 1 && rules[1] - rules[0] < 60 * scale) bands.push({top: rules[0], bottom: rules[1]});
        for (const line of lines) {
          line.reportParagraphStart = /^(?:注|注释|说明|备注)\s*[：:]/.test(line.text);
          const statisticalValue = /\d/.test(line.text) && /^[\s\d.,%()[\]<>≤≥=+−–\-±/]+$/.test(line.text);
          const headerField = line.top < layerRect.height * 0.3 && /^(?:(?:图表|表格)\d+(?:\.\d+)+|申办方[：:]|方案号[：:]|.*分析数据截至日期[：:]|.*分析集$|第\d+页.*页$)/.test(line.text.replace(/\s+/g, ''));
          line.independentReportField = headerField || statisticalValue || /^(?:NE|NA|NC|N\/A)$/i.test(line.text) || line.top >= metadataTop - line.height * 0.3 ||
            line.bottom <= (rules[0] ?? 0) + line.height * 0.3 ||
            bands.some(band => line.top >= band.top - line.height * 0.3 && line.bottom <= band.bottom + line.height * 0.3);
          // 有统计值的视觉行是下一条数据记录，不能承接上一条名称的换行。
          const row = visualRows.find(row => Math.abs(row.top - line.top) <= line.height * 0.45);
          line.reportRowStart = line.left < layerRect.width * 0.45 && !!row?.items.some(item => item.left > layerRect.width * 0.45 && /^(?:[-–]?\d|NE$|NA$)/i.test(item.text));
        }
      }


      // 表单页眉的研究中心、文件夹、表名、签名和生成时间是独立字段。
      // 根据字段组合识别页眉范围，不能把相邻字段当作正文换行。
      lines.filter(line => line.studyTextBlock || line.tableCell !== undefined || ['shr-statistical-report', 'shr-study-statistical-report', 'shr-safety-narrative', 'shr-subject-listing', 'shr-drug-batch-table', 'shr-crf-summary', 'shr-comparative-statistical-report', 'shr-data-review'].includes(smartMergeDocumentProfile)).forEach(line => {
        line.text = line.items.reduce((text, item, index) => {
          const previous = line.items[index - 1];
          return previous && (item.left - previous.right > line.height * 0.15 || /\s$/.test(previous.span.textContent) || /^\s/.test(item.span.textContent)) ? joinMergedTextParts([text, item.text]) : text + item.text;
        }, '');
      });
      if (formLayout?.shrStatisticalReport) markShrStatisticalLines(lines, formLayout, layerRect);
      if (smartMergeDocumentProfile === 'shr-drug-batch-table') {
        for (const [cell, rows] of groupItemsBy(lines.filter(line => line.tableCell !== undefined), line => line.tableCell)) {
          const text = rows.map(line => line.text).join('');
          if (cell.endsWith('-column-4') && /[+＋]/.test(text) || isShrBatchCodeList(text)) {
            for (const line of rows) line.structuredIndependent = true;
          } else if (cell.endsWith('-column-5') || isShrBatchSpecification(text)) {
            let specification = 0;
            for (const line of rows) {
              if (startsShrBatchSpecification(line.text)) specification++;
              line.structuredCell = `${cell}-specification-${specification}`;
            }
          }
        }
      }
      if (smartMergeDocumentProfile === 'shr-subject-listing') {
        for (const [cell, rows] of groupItemsBy(lines.filter(line => line.tableCell !== undefined), line => line.tableCell)) {
          const numbered = rows.flatMap(line => {
            const match = /^(?:\b(\d{1,2})[.．、)]|[（(](\d{1,2})[）)])\s*[A-Za-z\u3400-\u9fff]/.exec(line.text);
            return match ? [{line, number: Number(match[1] ?? match[2])}] : [];
          });
          // 成分名中的“(15)…(2)”不是编号列表，只有连续递增的编号才分段。
          if (numbered.length < 2 || numbered.some((item, index) => index && item.number !== numbered[index - 1].number + 1)) continue;
          const starts = new Set(numbered.map(item => item.line));
          let part = 0;
          for (const line of rows) {
            if (starts.has(line)) part++;
            line.structuredCell = `${cell}-part-${part}`;
          }
        }
      }
      if (smartMergeDocumentProfile === 'shr-data-review') {
        let part = 0;
        const previousLines = new Map();
        const layoutScale = layerRect.width / (formLayout?.width || layerRect.width);
        for (const line of lines) {
          if (line.structuredIndependent) continue;
          const fontSize = line.height / layoutScale;
          const title = pageNum === 1 && fontSize > 13 && fontSize < 15 && line.top < layerRect.height * .22;
          const heading = raw.some(item => /^\d{1,2}(?:\.\d{1,2})*[.．]$/.test(item.text) && Math.abs(item.top - line.top) < item.height * .5);
          if (heading || /^(?:数据审核决议$|\d+(?:\.\d+)*[.．]\s|Envelope|Signer|Document:)/.test(line.text) || !title && fontSize > 13) {
            line.structuredIndependent = true;
            previousLines.delete('review-prose');
            continue;
          }
          const cell = line.structuredCell ?? 'review-prose', state = previousLines.get(cell), previous = state?.line;
          const bullet = raw.some(item => item.text === '•' && Math.abs(item.top - line.top) < line.height * .4 && item.left < line.left);
          const starts = !previous || bullet || line.top - previous.bottom > line.height * 1.3 || !title && line.left - previous.left >= line.height * 1.8 && line.tableCell === undefined || /[。！？]$/.test(previous.text) && previous.right < (line.tableBounds?.right ?? layerRect.width * .85) - line.height * 2;
          const paragraph = starts ? ++part : state.part;
          previousLines.set(cell, {line, part: paragraph});
          line.structuredCell = `${cell}-part-${paragraph}`;
        }
      }
      if (smartMergeDocumentProfile === 'shr-crf-summary') {
        let paragraph = 0, previous;
        for (const line of lines) {
          if (line.tableCell !== undefined || line.structuredIndependent) {
            previous = null;
            continue;
          }
          if (/^\d+(?:\.\d+)+/.test(line.text) || line.height < 11 * layerRect.width / formLayout.width) {
            line.structuredIndependent = true;
            previous = null;
            continue;
          }
          if (!previous || line.left - previous.left > line.height || /[。！？][”’）)]*$/.test(previous.text)) paragraph++;
          line.structuredCell = `shr-crf-paragraph-${paragraph}`;
          previous = line;
        }
      }
      if (smartMergeDocumentProfile === 'shr-safety-narrative') {
        let paragraph = 0, previous;
        for (const line of lines) {
          const text = line.text.replace(/\s/g, '');
          const dateStart = /^(?:\d{4}年|\d{1,2}月\d{1,2}日)/.test(text);
          const heading = /^[A-Za-z\u3400-\u9fff][A-Za-z\u3400-\u9fff/（）()、]{0,24}[:：]$/.test(text);
          const dateOnly = dateStart && /^[\d年月日UKN至到—–\-、,，\s]+(?:持续|未知|不详)?[,，;；:：]?$/.test(text);
          if (/^(?:项目编号|病例编号|H\d{10,}|CN\d{6,}|临床试验药物|第\d+\/\d+页)/.test(text) || heading || dateOnly) {
            line.structuredIndependent = true;
            previous = null;
            paragraph++;
            continue;
          }
          const field = /^(?:合并用药|诊断|既往(?:病史|史|用药)|研究者(?:因果关系(?:判断)?|评估)|其他导致该事件的可能因素|企业评估|实验室检查|检查结果)[:：]/.test(text);
          const numbered = /^(?:\d{1,2}[.．、]|[（(]\d{1,2}[)）])(?=[^\d])/.test(text);
          // 日期中的年/月可能恰好落在上一行末尾，此时下一行仍属于同一记录。
          const dated = dateStart && !/(?:\d{4}年|\d{1,2}月)$/.test(previous?.text.trim() || '');
          // 靠近正文右边界的分号可能只是折行；短行结束的独立记录才断开。
          const recordEnd = previous && /[;；]$/.test(previous.text.trim()) && previous.right < (previous.tableBounds?.right ?? layerRect.width * .92) - previous.height * 2;
          if (!previous || dated || field || numbered || recordEnd || line.top - previous.bottom > line.height * .65 || /[。！？?][”’）)]*$/.test(previous.text) || Math.abs(line.left - previous.left) > line.height * 2) paragraph++;
          line.structuredCell = `shr-narrative-${paragraph}`;
          previous = line;
        }
      }
      if (smartMergeDocumentProfile === 'hpp737-ecrf' && raw.some(item => /C-SSRS/.test(item.text))) {
        // 稽查文本中的定义、示例、提问可以紧贴排版；完整说明后的直接提问也必须另起一段。
        const cells = groupItemsBy(lines.filter(line => line.structuredCell?.startsWith('audit-') && line.structuredCell.endsWith('-text') && !line.structuredIndependent), line => line.structuredCell);
        for (const [cell, rows] of cells) {
          let paragraph = 0;
          for (const [index, line] of rows.entries()) {
            const previous = rows[index - 1];
            if (previous && /[。！？?][”’）)]*\s*$/.test(previous.text) && Math.abs(line.left - previous.left) < line.height * 1.8 && (/^\s+/.test(line.items[0].span.textContent) || line.left - previous.left > line.height * .25 || /^[^：:]{2,16}[：:]/.test(line.text) || /^(?:您|你|是否|有没有|当您|当你)/.test(line.text))) paragraph++;
            line.structuredCell = `${cell}-paragraph-${paragraph}`;
          }
        }
      }
      const formHeaderLines = lines.filter(line => line.top < layerRect.height * 0.3 && /^(?:文件夹|表|数据已签名|生成时间)\s*[：:]/.test(line.text));
      const hasFormHeader = formHeaderLines.some(line => /^表\s*[：:]/.test(line.text)) && formHeaderLines.some(line => /^生成时间\s*[：:]/.test(line.text));
      const formHeaderBottom = hasFormHeader ? Math.max(...formHeaderLines.map(line => line.bottom)) : 0;
      lines.forEach(line => {
        line.isFormHeader = hasFormHeader && line.top < formHeaderBottom;
      });

      // 备注内容由左侧标签定位；只连接右侧同一单元格内的紧密续行。
      // 短中文、时间及句号均可以是备注的一部分，不再依赖长段落阈值。
      lines.filter(line => !line.isFormHeader && /^备注\s*[：:]?$/.test(line.text)).forEach((label, cellIndex) => {
        const first = lines.find(line => line.left > label.right + label.height * 3 && Math.abs(line.top - label.top) < label.height * 0.5);
        if (!first) return;
        const nextField = lines.find(line => line.top > label.bottom && line.left <= label.right + label.height);
        const endTop = nextField?.top ?? layerRect.height;
        let previous = first;
        first.noteCell = cellIndex;
        for (const line of lines) {
          if (line.top <= first.top || line.top >= endTop || Math.abs(line.left - first.left) > first.height || line.isFormHeader) continue;
          const height = Math.max(previous.height, line.height);
          const gap = line.top - previous.bottom;
          if (gap < -height * 0.3 || gap > height * 0.8) break;
          line.noteCell = cellIndex;
          previous = line;
        }
      });

      // 此类表单的右栏值可以很短；用横向表格线确定字段范围，再用勾选框
      // 分开选项。单位、参考范围仍是独立字段，不能与数值串联。
      if (hasFormHeader && formLayout) {
        const scale = layerRect.width / formLayout.width;
        const rules = formLayout.rules.map(top => top * scale);
        const boxes = formLayout.boxes.map(box => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value * scale])));
        for (let row = 0; row < rules.length - 1; row++) {
          const start = Math.max(rules[row], formHeaderBottom), end = rules[row + 1];
          const rowLines = lines.filter(line => !line.isFormHeader && line.top >= start - line.height * 0.3 && line.bottom <= end + line.height * 0.3);
          if (!rowLines.some(line => line.left < layerRect.width * 0.5)) continue;
          const choices = boxes.filter(box => box.top >= start && box.bottom <= end + 1);
          let field = 0;
          rowLines.filter(line => line.left > layerRect.width * 0.55).forEach(line => {
            if (/^化验(?:单位|范围)\s*[：:]/.test(line.text)) field++;
            if (choices.length) {
              const choice = choices.filter(box => box.top <= line.top + line.height * 0.5).length - 1;
              if (choice < 0 || line.right > choices[choice].left + line.height * 0.3) return;
              line.formCell = `choice-${row}-${choice}`;
              const nextChoice = choices[choice + 1];
              line.formCellBottom = nextChoice ? Math.min(...rowLines.filter(next => next.left > layerRect.width * 0.55 && next.top >= nextChoice.top - next.height * 0.5).map(next => next.top), end) : end;
            } else line.formCell = `value-${row}-${field}`;
          });
        }
      }

      // 稽查表的用户列按时间记录划分单元格。姓名/账号的换行可以合并，
      // 但不能跨到下一条记录；不依赖具体姓名、文件名或页码。
      const auditHeaders = lines.filter(user => /^用户$/.test(user.text) && lines.some(audit => /^稽查(?:痕迹)?$/.test(audit.text) && audit.left < user.left && Math.abs(audit.top - user.top) < user.height * 0.5));
      auditHeaders.forEach((header, headerIndex) => {
        const timeHeader = lines.find(line => /^(?:时间|日期)(?:\s*\([^)]*\))?$/.test(line.text) && line.left > header.left && Math.abs(line.top - header.top) < header.height * 0.5);
        if (!timeHeader) return;
        const endTop = Math.min(auditHeaders[headerIndex + 1]?.top ?? layerRect.height, auditContentBottom);
        const records = lines.filter(line => line.top > header.top && line.top < endTop && Math.abs(line.left - timeHeader.left) < line.height && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}/.test(line.text));
        lines.forEach(line => {
          if (line.top <= header.top || line.top >= endTop || line.left < header.left - line.height * 0.5 || line.right > timeHeader.left) return;
          let recordIndex = -1;
          for (let i = 0; i < records.length; i++) {
            if (records[i].top > line.top + line.height * 0.3) break;
            recordIndex = i;
          }
          if (recordIndex !== -1) {
            line.auditUserCell = `${headerIndex}-${recordIndex}`;
            const next = records[recordIndex + 1];
            const nextUser = next && lines.find(item => item.left >= header.left - item.height * .5 && item.right < timeHeader.left && Math.abs(item.top - next.top) < item.height * .3);
            line.auditUserRow = {
              start: records[recordIndex].items[0],
              next: next?.items[0],
              nextUser: nextUser?.items[0],
              first: recordIndex === 0
            };
          }
        });
      });

      // 为每个片段寻找正上方最匹配的前一行。这样左右两列会分别形成段落，
      // 不会因为 DOM 顺序交错而跨列串联。
      const completedCrf = smartMergeDocumentProfile === 'completed-crf';
      const isCompletedChoiceStart = text => /^(?:(?:\d+\s*级|(?:Grade|Level)\s*\d+)\s*[:：]|\d+[.)．、]\s*[A-Za-z\u3400-\u9fff])/i.test(text);
      if (completedCrf) {
        const cells = groupItemsBy(lines.filter(line => line.tableCell !== undefined), line => line.tableCell);
        for (const rows of cells.values()) {
          for (const line of rows) {
            // 同行的数字、#编号可能被字体度量拆成片段，沿用该行中文的类型。
            line.completedTextScript = rows.some(row => /[\u3400-\u9fff]/.test(row.text) && Math.abs(row.top - line.top) < line.height * 0.3) ? 'han' : /[A-Za-z]/.test(line.text) ? 'latin' : '';
          }
        }
      }
      lines.forEach((line, lineIndex) => {
        if (line.structuredIndependent || line.independentReportField || line.reportRowStart || line.reportParagraphStart || line.isFormHeader && !line.studyTextBlock) return;
        // Completed CRF 的等级和编号选项各自独立，换行的续句仍可接在本项后面。
        if (completedCrf && isCompletedChoiceStart(line.text)) return;
        // 新编号、字段名、日期以及新的复选项一律作为独立起点。
        if ((line.formCell === undefined && line.tableCell === undefined || isCheckboxOptionStart(line.text)) && (isCm313NarrativePartStart(line.text) || !isCm313NarrativePage && beginsNumberedField(line.text) || isFormFieldLabel(line.text) || isStandaloneDateOrPage(line.text) || isCheckboxOptionStart(line.text) || isTqcAuditFieldStart(line.text) || isTqcStructuredDescriptionStart(line.text))) return;
        let best = null;
        let bestScore = Infinity;
        for (let i = lineIndex - 1; i >= 0; i--) {
          const previous = lines[i];
          if (previous.structuredIndependent || previous.independentReportField || previous.isFormHeader && !previous.studyTextBlock) continue;
          const topDistance = line.top - previous.top;
          const maxHeight = Math.max(previous.height, line.height);
          if (topDistance > maxHeight * 2.5) break;
          if (topDistance < maxHeight * 0.55 || previous.next) continue;
          const auditCell = line.auditReasonCell !== undefined ? `reason-${line.auditReasonCell}` : line.auditUserCell !== undefined ? `user-${line.auditUserCell}` : undefined;
          const previousAuditCell = previous.auditReasonCell !== undefined ? `reason-${previous.auditReasonCell}` : previous.auditUserCell !== undefined ? `user-${previous.auditUserCell}` : undefined;
          const inAuditCell = auditCell !== undefined || previousAuditCell !== undefined;
          if (inAuditCell && auditCell !== previousAuditCell) continue;
          const inStructuredCell = line.structuredCell !== undefined || previous.structuredCell !== undefined;
          if (inStructuredCell && (line.structuredCell !== previous.structuredCell || Math.abs(line.height - previous.height) > maxHeight * .15)) continue;
          const inTableCell = line.tableCell !== undefined || previous.tableCell !== undefined;
          if (inTableCell && (line.tableCell !== previous.tableCell || Math.abs(line.height - previous.height) > maxHeight * 0.15)) continue;
          // 同一个标签框中的英文原文与中文译文各自独立，不能仅因间距小而合并。
          if (completedCrf && inTableCell && previous.completedTextScript && line.completedTextScript && previous.completedTextScript !== line.completedTextScript) break;
          const inStudyText = line.studyTextBlock !== undefined || previous.studyTextBlock !== undefined;
          if (inStudyText && line.studyTextBlock !== previous.studyTextBlock) continue;
          const inFormCell = line.formCell !== undefined || previous.formCell !== undefined;
          if (inFormCell && line.formCell !== previous.formCell) continue;
          const inNoteCell = line.noteCell !== undefined || previous.noteCell !== undefined;
          if (inNoteCell && line.noteCell !== previous.noteCell) continue;

          // CM313 的蓝色章节标题明显大于正文。把字号突降处直接作为段落边界，
          // 既防止标题与字段误合并，也让标题后的长正文可以从自身首行开始成段。
          if (smartMergeDocumentProfile === 'cm313-blank-crf' && previous.height > line.height * 1.25) continue;
          // 横线分隔的表体和注释不能跨区串接。
          if (statisticalReport && reportRules.some(top => top >= previous.bottom - maxHeight * 0.15 && top <= line.top + maxHeight * 0.15)) continue;
          const verticalGap = line.top - previous.bottom;
          // 自动换行的基线通常很紧；更大的空白视为新字段或新段落。
          const maxWrapGapRatio = smartMergeDocumentProfile === 'shr-data-review' ? 1.3 : smartMergeDocumentProfile === 'shr-crf-summary' ? 1.1 : smartMergeDocumentProfile === 'cm313-blank-crf' || isTqc3721Ecrf ? 0.82 : 0.65;
          if (verticalGap < -maxHeight * 0.3 || verticalGap > maxHeight * (inStudyText ? 0.82 : maxWrapGapRatio)) continue;
          // 行尾的“2.”、“n.”等是枚举项开头被换到下一行，并非段落结束。
          const endsWithEnumerator = /(?:^|[；：，,\s])(?:\d+|[A-Za-z])\.\s*["']?$/.test(previous.text || '');
          const inTqcQueryText = isTqc3721Ecrf && (previous.tqcQueryChain || beginsTqcQueryAction(previous.text));
          // 指定长说明页只采用上面的业务断点；否则恰好落在视觉行末的句号会
          // 把同一大段误切成三到四块。
          // TQC 稽查页的一条质疑可能包含多个完整句子，句号不是记录边界；
          // 后续真正的新“操作/值/备注/理由”仍由独立字段规则负责截断。
          if (!inStructuredCell && !inTableCell && !inStudyText && !inFormCell && !inNoteCell && !isCm313TwoPartNarrativePage && !inTqcQueryText && !endsWithEnumerator && /[.!?。！？”’）】》]\s*$/.test(previous.text)) continue;
          const previousStartsLabel = beginsDotFieldLabel(previous.text);
          // 统计列表中的编号异常描述是单元格正文；本项的续行不能按英文大写字段名过滤。
          // 新编号仍独立起段，避免将同格的两条完整描述串在一起。
          const numberedTableText = ['hpp737-statistical-listing', 'shr-comparative-statistical-report'].includes(smartMergeDocumentProfile) && inTableCell;
          const hppDeviationDescription = formLayout?.hppStatisticalListing && /方案偏离描述/.test(formLayout.hppColumns?.[Number(/^hpp-body-(\d+)/.exec(line.tableCell)?.[1])]?.title || '');
          if (numberedTableText && !hppDeviationDescription && /^\d{1,2}[.)]\s*[A-Za-z\u3400-\u9fff]/.test(line.text)) continue;
          const inFieldLabel = !numberedTableText && !['shr-safety-narrative', 'shr-subject-listing', 'shr-data-review'].includes(smartMergeDocumentProfile) && (previous.fieldLabelChain || previousStartsLabel);
          if (inFieldLabel && !isUppercaseLabelContinuation(line.text)) continue;
          const overlap = Math.max(0, Math.min(previous.right, line.right) - Math.max(previous.left, line.left));
          const minWidth = Math.max(1, Math.min(previous.right - previous.left, line.right - line.left));
          const overlapRatio = overlap / minWidth;
          const leftDifference = Math.abs(line.left - previous.left);
          const aligned = leftDifference <= Math.max(12, maxHeight * 1.8);
          const nestedWrap = overlapRatio >= 0.55;
          if (!aligned && !nestedWrap) continue;

          // 仅保留证据充分的续行：长文本换行、以小写/括号开头的悬挂行，
          // 或同一复选项内部的多行标签。短字段之间不再仅凭位置接近而合并。
          const previousWidth = previous.right - previous.left;
          // 统计列表中短而完整的两条中文值不是续行；真正换行需接近列宽或带续接符。
          if (formLayout?.hppStatisticalListing && inTableCell && !line.structuredCell?.startsWith('hpp-header-') && !/组别|日期|时间/.test(formLayout.hppColumns?.[Number(/^hpp-body-(\d+)/.exec(line.tableCell)?.[1])]?.title || '') && previousWidth < (previous.tableBounds.right - previous.tableBounds.left) * .6 && !/^[a-z([{（/、]|^[)）]/.test(line.text) && !/^[\d./:\s-]+$/.test(previous.text + line.text)) continue;
          const startsLikeContinuation = /^[a-zà-öø-ÿ([{]/.test(line.text || '');
          const previousIsLong = (previous.text || '').length >= 42 || previousWidth >= layerRect.width * 0.28;
          let inCheckboxOption = previous.checkboxChain || isCheckboxOptionStart(previous.text);
          // TQC 的选项列表通常右对齐：真正的续行只会基本对齐或向右缩进。
          // 若下一行大幅向左扩展，它已经是下一个字段的内容（例如“○其他”
          // 下面的“详细说明”），不能沿用复选项链。
          if (isTqc3721Ecrf && inCheckboxOption && line.left < previous.left - Math.max(12, maxHeight * 1.8)) {
            inCheckboxOption = false;
          }
          const continuesFieldLabel = inFieldLabel && isUppercaseLabelContinuation(line.text);
          // CM313 表单中左栏字段名、右栏字段值以及单个选项说明都可能自动换行。
          // 只放宽紧密左对齐、含中文且当前行不是新选项的短续行。
          const previousCompact = (previous.text || '').replace(/\s+/g, '');
          const currentCompact = (line.text || '').replace(/\s+/g, '');
          const previousStartsChoice = isCheckboxOptionStart(previous.text);
          const currentStartsChoice = isCheckboxOptionStart(line.text);
          const choiceMarks = (previousCompact + currentCompact).match(/[○◯□☐●■✓✔]/g) || [];

          // 检验结果单元格中“正常/异常”“单位”“参考范围”是三类独立值，
          // 不能因为单位或 x<... 以小写字母开头就当成上一行的续行。
          const tqcSeparateLabValue = isTqc3721Ecrf && (isTqcLabAssessment(previous.text) && isTqcLabUnit(line.text) || isTqcLabUnit(previous.text) && isTqcLabReferenceRange(line.text));
          if (tqcSeparateLabValue) continue;
          const cm313CellWrap = smartMergeDocumentProfile === 'cm313-blank-crf' && leftDifference <= Math.max(14, maxHeight * 1.8) && /[\u3400-\u9fff]/.test(previousCompact + currentCompact) && !currentStartsChoice && (choiceMarks.length === 0 || previousStartsChoice && choiceMarks.length === 1) && previousCompact.length >= 3 && previousCompact.length <= 80 && currentCompact.length >= 1 && currentCompact.length <= 24 && previousCompact.length + currentCompact.length <= 100;

          // TQC3721 eCRF 的页眉代码和部分栏目名被窄单元格拆成两行；它们通常是
          // “较长首行 + 单个末字”或“文档编号 + 版本后缀”，必须作为同一字段。
          const tqcHeaderWrap = isTqc3721Ecrf && (/^TQC3721-D8-$/i.test(previousCompact) && /^II-01$/i.test(currentCompact) || /^(?:不符合入选\/符合排除标|既往\/伴随用药与治疗记)$/.test(previousCompact) && /^(?:准|录)$/.test(currentCompact));

          // 稽查痕迹页中 “System-” 与下一行 “>Site(...)” 是同一条质疑记录。
          // “>” 不属于通用的小写/括号续行条件，需要为该版式单独放行。
          const tqcQueryWrap = isTqc3721Ecrf && /System-$/.test(previousCompact) && /^>Site\(/i.test(currentCompact);
          if (!inStructuredCell && !inTableCell && !inStudyText && !inFormCell && !inNoteCell && !inAuditCell && !startsLikeContinuation && !previousIsLong && !inCheckboxOption && !continuesFieldLabel && !cm313CellWrap && !tqcHeaderWrap && !tqcQueryWrap) continue;
          const score = Math.abs(verticalGap) + leftDifference * 0.08 - overlapRatio * 4;
          if (score < bestScore) {
            best = previous;
            bestScore = score;
          }
        }
        if (best) {
          best.next = line;
          line.previous = best;
          line.fieldLabelChain = best.fieldLabelChain || beginsDotFieldLabel(best.text);
          line.checkboxChain = best.checkboxChain || isCheckboxOptionStart(best.text);
          line.tqcQueryChain = best.tqcQueryChain || beginsTqcQueryAction(best.text);
        }
      });
      // 同一条稽查记录的左栏说明必须形成一条连续链。通用段落规则会把句末
      // 引号当作自然断点，这里依据时间列已经确定的记录边界重新连接续行。
      const auditReasonGroups = groupItemsBy(lines.filter(line => line.auditReasonCell !== undefined), line => line.auditReasonCell);
      auditReasonGroups.forEach(group => {
        group.sort((a, b) => a.top - b.top || a.left - b.left);
        for (let i = 1; i < group.length; i++) {
          const previous = group[i - 1], current = group[i];
          const height = Math.max(previous.height, current.height);
          if (current.top - previous.bottom > height * 0.85 || current.top - previous.top < height * 0.55) continue;
          if (previous.next && previous.next !== current) previous.next.previous = null;
          if (current.previous && current.previous !== previous) current.previous.next = null;
          previous.next = current;
          current.previous = previous;
        }
      });
      const paragraphs = [];
      lines.forEach(line => {
        // 同一视觉行中的多个 PDF 文本对象仍是单行，不参与智能合并。
        if (line.previous || !line.next) return;
        const chain = [];
        let cursor = line;
        while (cursor) {
          chain.push(cursor);
          cursor = cursor.next;
        }
        if (chain.length >= 2) paragraphs.push({
          lines: chain
        });
      });
      return paragraphs;
    };
    /**
     * 按文档版式过滤智能合并候选。
     * CM313 空白 eCRF 采用严格白名单：每页顶部的两行研究标题页眉、封面研究标题，
     * 第 21～124 页同一单元格内的字段名、字段值和单个选项续行，实验室检查提示，
     * 以及第 59～62、64～67 页的长篇入选/排除标准说明可合并；
     * 目录、表格、字段、选项和页码等其余内容全部跳过。
     */
    const isCm313WrappedNarrowLabel = (paragraph, pageNum, text) => {
      if (pageNum < 21 || pageNum > 124 || !paragraph || !paragraph.lines || paragraph.lines.length < 2 || paragraph.lines.length > 4) return false;
      const compactText = (text || '').replace(/\s+/g, '');
      if (compactText.length < 4 || compactText.length > 100 || !/[\u3400-\u9fff]/.test(compactText) || /^\d+$/.test(compactText)) return false;
      const firstItem = paragraph.lines[0].items && paragraph.lines[0].items[0];
      const textLayer = firstItem && firstItem.span && firstItem.span.closest('.textLayer');
      const layerWidth = textLayer ? textLayer.getBoundingClientRect().width : 0;
      if (!layerWidth) return false;
      let minLeft = Infinity;
      let maxRight = -Infinity;
      const firstLeft = paragraph.lines[0].left;
      const firstHeight = paragraph.lines[0].height || 0;
      let hasShortContinuation = false;
      const firstStartsChoice = /^[○◯□☐●■✓✔]/.test((paragraph.lines[0].text || '').trim());
      for (let i = 0; i < paragraph.lines.length; i++) {
        const line = paragraph.lines[i];
        const lineCompact = (line.text || '').replace(/\s+/g, '');
        minLeft = Math.min(minLeft, line.left);
        maxRight = Math.max(maxRight, line.right);
        if (i > 0 && lineCompact.length <= 24) hasShortContinuation = true;
        if (i > 0 && /^\d+$/.test(lineCompact)) return false;
        // 蓝色章节标题字号明显大于下面的普通字段；二者即使靠得很近也不是换行。
        if (i > 0 && firstHeight > 0 && (line.height || firstHeight) > 0 && firstHeight > (line.height || firstHeight) * 1.25) return false;
        // 后续行若出现新的选项符号，说明已经进入另一个选项，不能合并。
        if (i > 0 && /^[○◯□☐●■✓✔]/.test((line.text || '').trim())) return false;
        if (Math.abs(line.left - firstLeft) > Math.max(14, line.height * 1.8)) return false;
      }

      // 限制在单一表格列内；整页宽度的说明文字由专用规则处理。
      // firstStartsChoice 明确表示“同一个选项内部换行”，不是多个选项合并。
      return hasShortContinuation && maxRight - minLeft < layerWidth * 0.46 && (!/[○◯□☐●■✓✔]/.test(compactText) || firstStartsChoice);
    };
    /** 实验室检查页反复出现的两行橙色提示，应作为一个说明字段合并。 */
    const isCm313LabInstruction = text => {
      const compactText = (text || '').replace(/\s+/g, '');
      return /若结果异常有临(?:床)?意义.*报告不良事件\/病史.*不良事件\/病史编号/.test(compactText);
    };
    const shouldSkipSmartParagraph = (paragraph, pageNum) => {
      if (!paragraph || !paragraph.lines) return true;
      if (paragraph.lines.some(line => line.structuredCell?.startsWith('directory-entry-'))) return true;
      const text = paragraph.lines.map(line => line.text || '').join(' ').replace(/\s+/g, ' ').trim();
      if (!text) return true;
      if (smartMergeDocumentProfile === 'shr-drug-batch-table' && (isShrBatchCodeList(text) || isShrBatchSpecification(text) && (paragraph.lines.some(line => line.tableCell?.endsWith('-column-4')) || paragraph.lines.filter(line => startsShrBatchSpecification(line.text)).length > 1))) return true;

      // 第 2 页是目录，每一行都是独立入口。目录项即使以小写英文开头
      // （例如 mMRC）也不能与上一项合并。
      if (smartMergeDocumentProfile === 'tqc3721-ecrf' && pageNum === 2) return true;
      if (smartMergeDocumentProfile === 'cm313-blank-crf') {
        const compactText = text.replace(/\s+/g, '');
        // 每一页顶部重复出现的两行研究标题页眉需要合并为一个整体。
        const isRepeatedStudyHeader = /eCollect.*CM313.*BlankPages/i.test(compactText);
        if (isRepeatedStudyHeader) return false;

        // 排除“章节标题 + 下一行字段/序号”。它们在部分页面上垂直距离很小，
        // 但字号突降或纯数字续行说明它们属于两个独立控件。
        if (pageNum >= 21) {
          const firstLineHeight = paragraph.lines[0].height || 0;
          const hasNumericOnlyContinuation = paragraph.lines.slice(1).some(line => /^\d+$/.test((line.text || '').replace(/\s+/g, '')));
          const hasHeadingSizeDrop = paragraph.lines.slice(1).some(line => {
            const lineHeight = line.height || firstLineHeight;
            return firstLineHeight > 0 && lineHeight > 0 && firstLineHeight > lineHeight * 1.25;
          });
          if (hasNumericOnlyContinuation || hasHeadingSizeDrop) return true;
        }

        // 第 21～124 页中，同一表格单元格内的字段名、字段值或单个选项续行应合并。
        if (isCm313WrappedNarrowLabel(paragraph, pageNum, text)) return false;

        // 血常规、血生化、凝血、尿常规等页面中的重复两行提示应合并。
        if (isCm313LabInstruction(text)) return false;
        if (pageNum === 1) {
          return /(?:空白模板|eCRF版本)/i.test(compactText) || !/CM313.*期临床研究/i.test(compactText);
        }
        const narrativePages = [59, 60, 61, 62, 64, 65, 66, 67];
        if (narrativePages.indexOf(pageNum) === -1) return true;
        const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
        const hasSentencePunctuation = /[，。；：、“”]/.test(text);
        // 长说明页中，段首有时只有两行（例如“排除标准2.0”的开头），
        // 后续正文才形成大段；放宽最小长度，但仍要求足够中文和句读证据。
        return text.length < 35 || chineseCount < 15 || !hasSentencePunctuation;
      }

      // 下面的第 4～7 页规则只属于 7 页 CIOMS 严重不良事件报告，不能影响
      // 其他文档（例如本次 82 页 TQC3721 eCRF）的同页码内容。
      if (smartMergeDocumentProfile === 'cioms-sepsis' && pageNum >= 4 && pageNum <= 7) {
        if (pageNum === 4 || pageNum === 5) {
          return !/HIGH RISK NON-MUSCLE INVASIVE BLADDER CANCER BCG UNRESPONSIVE\s*\[?10087211/i.test(text);
        }
        return true;
      }
      if (pageNum !== 1) return false;
      return /^\d+\)\s*SEPSIS\b/i.test(text) || /(?:YES\s+NO\s+NA|\bNA\b\s*:\s*Not Applicable)/i.test(text) || /^Name\s*:\s*/i.test(text) || /^(?:Study Information\b|Study Name\s*:|EudraCT Number\s*:|Protocol No\.\s*:|Center No\.\s*:|Subject Id\s*:)/i.test(text);
    };
    /** 通过页数和首页文本识别已适配的文档版式，避免依赖用户本地文件名。 */
    const detectSmartMergeDocumentProfile = async doc => {
      if (!doc) return 'generic';
      try {
        const firstPage = await doc.getPage(1);
        const content = await firstPage.getTextContent();
        const firstPageText = content.items.map(item => item.str || '').join(' ');
        const compactFirstPageText = firstPageText.replace(/\s+/g, '');
        if (/数据审核决议/.test(compactFirstPageText) && /SHR-A1811/.test(compactFirstPageText) && /申办单位/.test(compactFirstPageText)) return 'shr-data-review';
        if (/中心编号.*受试者(?:代码|编号).*(?:研究药物|药物名称).*批号/.test(compactFirstPageText) && /生产日期.*有效期/.test(compactFirstPageText)) return 'shr-drug-batch-table';
        if (/16\.3患者病例报告表[（(]CRF[)）]/.test(compactFirstPageText) && /SHR-A1811/.test(compactFirstPageText)) return 'shr-crf-summary';
        if (/^目录/.test(compactFirstPageText) && /列表16\.2/.test(compactFirstPageText) && /SHR-A1811-I-102/.test(compactFirstPageText)) return 'shr-subject-listing';
        if (/^目录/.test(compactFirstPageText) && /SHR-A1811-ISS/.test(compactFirstPageText)) return 'shr-statistical-report';
        if (/^目录/.test(compactFirstPageText) && /SHR-A1811-I-102/.test(compactFirstPageText)) return 'shr-study-statistical-report';
        if (/统计分析图表/.test(compactFirstPageText) && /项目编号[:：]SHR-A1811/.test(compactFirstPageText)) return 'shr-comparative-statistical-report';
        if (/项目编号[:：]SHR-A1811/.test(compactFirstPageText) && /病例编号[:：]/.test(compactFirstPageText)) return 'shr-safety-narrative';
        if (/^目录/.test(compactFirstPageText) && /表格\d+\.\d+/.test(compactFirstPageText)) {
          const sample = await doc.getPage(Math.min(4, doc.numPages));
          const text = (await sample.getTextContent()).items.map(item => item.str || '').join('');
          if (/程序路径\s*[：:]/.test(text) && /方案号/.test(text)) return /HPP737[-\s]*Psoriasis[-\s]*301/i.test(text) && /列表\s*16\.2/.test(text) ? 'hpp737-statistical-listing' : 'statistical-report';
        }
        if (/CompletedCRF/i.test(compactFirstPageText) && /DateCreated:/i.test(compactFirstPageText)) return 'completed-crf';
        if (/ElectronicCaseReportForm/i.test(compactFirstPageText) && /SIM0718_302/.test(compactFirstPageText)) return 'sim0718-ecrf';
        for (let n = 1; n <= Math.min(3, doc.numPages); n++) {
          const text = n === 1 ? firstPageText : (await (await doc.getPage(n)).getTextContent()).items.map(item => item.str || '').join(' ');
          if (/Electronic Case Report Form/i.test(text) && /HPP737[-\s]*Psoriasis[-\s]*301/i.test(text)) return 'hpp737-ecrf';
          if (/Confidential Information/i.test(text) && /项目编号/.test(text) && /访视名称/.test(text) && /锁库/.test(text)) return 'fmd-crf';
        }
        if (doc.numPages === 124 && /CM313/i.test(compactFirstPageText) && /BlankPages/i.test(compactFirstPageText) && /空白模板/.test(compactFirstPageText)) {
          return 'cm313-blank-crf';
        }
        if (/TQC3721-D8-II-01/i.test(compactFirstPageText) && /(?:电子病例报告表|eCRF)/i.test(compactFirstPageText)) {
          return 'tqc3721-ecrf';
        }
        if (doc.numPages === 7 && /(?:CIOMSFORM|SUSPECTADVERSEREACTIONREPORT|Mfr\.?CONTROLNO)/i.test(compactFirstPageText)) {
          return 'cioms-sepsis';
        }
      } catch (e) {
        console.warn('识别智能合并文档类型失败，将使用通用规则:', e);
      }
      return 'generic';
    };
    /** 合并期间让 PDF.js 的逐帧绘制在窗口隐藏后仍能继续。 */
    let mergeFrameSchedulerUsers = 0, releaseMergeFrameScheduler = null;
    const enableMergeFrameScheduler = () => {
      if (mergeFrameSchedulerUsers) {
        mergeFrameSchedulerUsers++;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            if (!--mergeFrameSchedulerUsers) releaseMergeFrameScheduler();
          }
        };
      }
      if (typeof MessageChannel !== 'function') return () => {
      };
      const originalRequestFrame = window.requestAnimationFrame;
      const originalCancelFrame = window.cancelAnimationFrame;
      const channel = new MessageChannel();
      const pending = new Map();
      let nextId = -1;
      let restored = false;
      const closeWhenIdle = () => {
        if (restored && pending.size === 0) {
          channel.port1.close();
          channel.port2.close();
        }
      };
      channel.port1.onmessage = event => {
        const callback = pending.get(event.data);
        if (!callback) return;
        pending.delete(event.data);
        try {
          callback(performance.now());
        } finally {
          closeWhenIdle();
        }
      };
      window.requestAnimationFrame = callback => {
        const id = nextId--;
        pending.set(id, callback);
        channel.port2.postMessage(id);
        return id;
      };
      window.cancelAnimationFrame = id => {
        if (pending.delete(id)) {
          closeWhenIdle();
        } else {
          originalCancelFrame.call(window, id);
        }
      };
      mergeFrameSchedulerUsers = 1;
      releaseMergeFrameScheduler = () => {
        window.requestAnimationFrame = originalRequestFrame;
        window.cancelAnimationFrame = originalCancelFrame;
        restored = true;
        closeWhenIdle();
      };
      let released = false;
      return () => {
        if (!released) {
          released = true;
          if (!--mergeFrameSchedulerUsers) releaseMergeFrameScheduler();
        }
      };
    };
    /** 后台完成指定页的文本层，不等待浏览器绘制帧或可见页队列。 */
    const ensurePageTextLayer = async pageNum => {
      if (!app.pdfViewer || !app.pdfDoc) return null;
      const pageView = app.pdfViewer.getPageView(pageNum - 1);
      if (!pageView) return null;
      const bus = app.eventBus;
      const renderingQueue = pageView.renderingQueue;
      let timeout = null;
      let textReady = false;
      let resolveTextReady;
      const textReadyPromise = new Promise(resolve => {
        resolveTextReady = resolve;
      });
      const onTextRendered = evt => {
        if (evt.pageNumber !== pageNum || evt.error) return;
        textReady = true;
        resolveTextReady(true);
      };
      bus.on('textlayerrendered', onTextRendered);
      pageView.renderingQueue = null;
      try {
        if (!pageView.pdfPage) pageView.setPdfPage(await app.pdfDoc.getPage(pageNum));

        // 开始合并之前已经启动的绘制可能仍挂着原生动画帧。重新启动未完成页，
        // 保证本页所有后续绘制都使用合并期间的后台调度器。
        if (pageView.renderingState === 1 || pageView.renderingState === 2) pageView.reset();
        if (pageView.renderingState === 0) await pageView.draw();
        if (pageView.textLayer && pageView.textLayer.renderingDone) textReady = true;
        if (!textReady) {
          // 超时只用于报告真正的渲染失败，正常处理靠完成事件推进。
          timeout = setTimeout(() => {
            resolveTextReady(false);
          }, 15000);
          if (!(await textReadyPromise)) {
            console.warn(`第 ${pageNum} 页文本层未完成渲染`);
            return null;
          }
        }
        const refreshTask = pageTextLayerRefreshTasks.get(pageNum);
        if (refreshTask) await refreshTask;
        const layer = pageView.div && pageView.div.querySelector('.textLayer');
        if (!layer) return null;
        const rect = layer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return layer;
      } catch (e) {
        console.warn(`后台渲染第 ${pageNum} 页失败:`, e);
        return null;
      } finally {
        bus.off('textlayerrendered', onTextRendered);
        if (timeout !== null) clearTimeout(timeout);
        pageView.renderingQueue = renderingQueue;
      }
    };
    const runSmartMerge = async (startPage, endPage) => {
      if(app.locked){setStatus('JSON 导入期间及导入后不能智能合并。');return;}
      if (smartMergeRunning) return;
      if (app.mergeMode) toggleMergeMode();
      if (app.unmergeMode) toggleUnmergeMode();
      smartMergeRunning = true;
      smartMergeBtn.disabled = true;
      smartMergeConfirm.disabled = true;
      smartMergeCancel.disabled = true;
      setStatus('🤖 正在按段落识别并合并文字…');
      let mergedCount = 0;
      const handledPageSet = new Set();
      const skippedPageSet = new Set();
      const originalPage = app.pdfViewer ? app.pdfViewer.currentPageNumber : 1;
      const originalScrollTop = viewerContainer.scrollTop;
      let completed = false;
      let restoreFrameScheduler = () => {
      };
      try {
        restoreFrameScheduler = enableMergeFrameScheduler();
        const rangePageCount = endPage - startPage + 1;
        // 每页在文字层稳定后立即处理，只遍历用户指定的页码范围一次。
        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
          if(app.locked)break;
          setStatus(`🤖 正在处理第 ${pageNum} 页（范围 ${startPage} - ${endPage}）…`);
          try {
            // 页面跟随处理进度；后台绘制仍不依赖当前可见页。
            if (app.pdfViewer.currentPageNumber !== pageNum) {
              app.pdfViewer.currentPageNumber = pageNum;
            } else {
              app.pdfViewer.scrollPageIntoView({
                pageNumber: pageNum
              });
            }
            const textLayer = await ensurePageTextLayer(pageNum);
            if (!textLayer || !textLayer.querySelector('span')) {
              skippedPageSet.add(pageNum);
              continue;
            }
            const formLayout = textLayer.querySelectorAll ? await getSmartMergeFormLayout(textLayer, pageNum).catch(error => {
              console.warn(`第 ${pageNum} 页表格边界读取失败，继续使用文字规则`, error);
              return null;
            }) : null;
            if (smartMergeDocumentProfile === 'hpp737-ecrf' || formLayout?.sourceGeometry?.size) {
              assignContentDataIds(pageNum);
              await reconcilePageSourceDataIds(pageNum);
            }
            const paragraphs = getSmartMergeParagraphs(textLayer, pageNum, formLayout);
            let pageWasMerged = false;
            for (const paragraph of paragraphs) {
              if (shouldSkipSmartParagraph(paragraph, pageNum)) {
                if (paragraph.lines.some(line => line.structuredCell?.startsWith('directory-entry-'))) app.reserveMergeDataId?.();
                continue;
              }
              const selectedSpans = [];
              paragraph.lines.forEach(line => {
                line.items.forEach(item => {
                  if (item.span.isConnected) selectedSpans.push({
                    span: item.span,
                    index: item.index
                  });
                });
              });
              if (selectedSpans.length < 2) continue;
              const smartLayerRect = textLayer.getBoundingClientRect();
              const bounds = selectedSpans.reduce((result, item) => {
                const rect = item.span.getBoundingClientRect();
                const left = rect.left - smartLayerRect.left,
                  top = rect.top - smartLayerRect.top;
                result.left = Math.min(result.left, left);
                result.top = Math.min(result.top, top);
                result.right = Math.max(result.right, left + rect.width);
                result.bottom = Math.max(result.bottom, top + rect.height);
                return result;
              }, {
                left: Infinity,
                top: Infinity,
                right: -Infinity,
                bottom: -Infinity
              });
              // 智能合并使用正文安全区，不允许文本框贴到页面边缘。
              // 左右各保留页面宽度 5% 的边距，可覆盖第 2、3 页叙述正文的有效范围。
              const smartLayerWidth = textLayer.clientWidth || smartLayerRect.width;
              const contentInset = Math.max(12, smartLayerWidth * 0.05);
              bounds.left = Math.max(contentInset, bounds.left);
              bounds.right = Math.min(smartLayerWidth - contentInset, bounds.right);
              if (bounds.right - bounds.left < 2) continue;
              const auditUser = paragraph.lines[0].auditUserCell !== undefined && paragraph.lines.every(line => line.auditUserCell === paragraph.lines[0].auditUserCell);
              const auditReason = paragraph.lines[0].auditReasonCell !== undefined && paragraph.lines.every(line => line.auditReasonCell === paragraph.lines[0].auditReasonCell);
              const sourceContent = await getPageTextContent(pageNum);
              const sourceItem = sourceContent && findTextContentItemForSpan(sourceContent, selectedSpans[0].span, selectedSpans[0].index, pageNum);
              const preserveSourceAppearance = shouldPreserveMergeSourceAppearance(selectedSpans);
              const auditFrame = auditUser && preserveSourceAppearance ? getAuditUserFrame(paragraph, selectedSpans, pageNum, sourceContent) : null;
              const preserveSourceLines = smartMergeDocumentProfile === 'shr-data-review' || preserveSourceAppearance || !paragraph.lines.some(line => line.auditUserCell !== undefined || line.auditReasonCell !== undefined || line.noteCell !== undefined || line.formCell !== undefined || line.tableCell !== undefined || line.studyTextBlock !== undefined) && !!sourceItem && !!getLoadedPdfFont(pageNum, sourceItem.fontName)?.missingFile;
              const originalLines = auditUser || auditReason || preserveSourceLines || paragraph.lines.every(line => line.noteCell !== undefined || line.formCell !== undefined || line.tableCell !== undefined || line.studyTextBlock !== undefined) ? paragraph.lines.map(line => smartMergeDocumentProfile === 'shr-data-review' || line.studyTextBlock || line.tableCell !== undefined ? line.text : joinMergedTextParts(line.items.map(item => item.text))) : undefined;
              const studyBlock = paragraph.lines[0].studyTextBlock;
              const tableBounds = paragraph.lines[0].tableBounds;
              const cellBottom = Math.min(...paragraph.lines.map(line => line.formCellBottom ?? (line.tableBounds ? line.tableBounds.bottom - 1 : Infinity)));
              const renderScale = studyBlock || tableBounds || auditUser || auditReason || preserveSourceLines ? getPageScale(pageNum) : 1;
              const fontSize = paragraph.lines[0].height / renderScale;
              const originalSpacing = paragraph.lines.length > 1 ? (paragraph.lines.at(-1).top - paragraph.lines[0].top) / (paragraph.lines.length - 1) : paragraph.lines[0].height;
              // 紧凑标题不缩小字号；表格行盒不得越过本单元格的下边线。
              const renderLineHeightPt = preserveSourceAppearance ? originalSpacing / renderScale : studyBlock ? fontSize * (studyBlock === 'study-title' ? 1.25 : 1.6) : tableBounds ? Math.min(originalSpacing, (cellBottom - bounds.top) / paragraph.lines.length) / renderScale : auditUser || auditReason || preserveSourceLines ? Math.min(originalSpacing / renderScale, fontSize * 1.1) : undefined;
              const centered = tableBounds && paragraph.lines.every(line => Math.abs((line.left + line.right - tableBounds.left - tableBounds.right) / 2) <= line.height * 0.6);
              const didMerge = await performMerge(selectedSpans, pageNum, textLayer, smartLayerRect, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top, [], {
                deferUiUpdates: true,
                preserveSourceAppearance,
                frameRowBounds: auditFrame?.row,
                sourceBoundsOverride: auditFrame?.bounds || (preserveSourceAppearance && smartMergeDocumentProfile === 'shr-drug-batch-table' ? {
                  left: Math.min(...paragraph.lines.map(line => line.left)),
                  top: Math.min(...paragraph.lines.map(line => line.top)),
                  right: Math.max(...paragraph.lines.map(line => line.right)),
                  bottom: Math.max(...paragraph.lines.map(line => line.bottom))
                } : undefined),
                framePaddingPt: smartMergeDocumentProfile === 'shr-drug-batch-table' ? .2 : undefined,
                frameVerticalPaddingPt: smartMergeDocumentProfile === 'shr-drug-batch-table' ? 1.5 : undefined,
                frameColumnBounds: formLayout?.shrComparativeStatisticalReport && tableBounds && paragraph.lines.every(line => line.structuredCell?.endsWith('-caption')) ? {
                  left: tableBounds.left,
                  right: tableBounds.right
                } : undefined,
                sourceBounds: smartMergeDocumentProfile === 'shr-drug-batch-table' ? {
                  left: Math.min(...paragraph.lines.map(line => line.left)),
                  top: Math.min(...paragraph.lines.map(line => line.top)),
                  right: Math.max(...paragraph.lines.map(line => line.right)),
                  bottom: Math.max(...paragraph.lines.map(line => line.bottom))
                } : undefined,
                originalLines,
                mergedText: getSmartMergedText(paragraph, originalLines),
                cellBottom,
                renderLineHeightPt,
                compactBounds: !!studyBlock || !!tableBounds || auditUser || auditReason || preserveSourceLines,
                topOffsetPt: preserveSourceAppearance ? 0 : studyBlock === 'study-header' ? 3 : auditUser ? 3 : undefined,
                textAlign: studyBlock === 'study-title' || centered ? 'center' : undefined,
                preserveCellBounds: preserveSourceLines || paragraph.lines.every(line => line.auditUserCell !== undefined || line.auditReasonCell !== undefined || line.noteCell !== undefined || line.formCell !== undefined || line.tableCell !== undefined || line.studyTextBlock !== undefined)
              });
              if (didMerge) {
                mergedCount++;
                pageWasMerged = true;
              }
            }
            if (pageWasMerged) assignContentDataIds(pageNum);
            handledPageSet.add(pageNum);
          } catch (pageError) {
            skippedPageSet.add(pageNum);
            console.warn(`智能合并第 ${pageNum} 页处理失败:`, pageError);
          }
        }
        completed = true;
        let finishMessage = mergedCount ? `🤖 智能合并完成：已合并 ${mergedCount} 个连续段落` : '🤖 指定范围内未找到可自动合并的连续段落';
        finishMessage += `（范围 ${startPage} - ${endPage}，已处理 ${handledPageSet.size} / ${rangePageCount} 页）`;
        if (skippedPageSet.size > 0) {
          finishMessage += `；⚠️ 未完整处理页：${Array.from(skippedPageSet).join('、')}`;
          console.warn('智能合并未完整处理的页码:', Array.from(skippedPageSet));
        }
        setStatus(finishMessage);
      } catch (err) {
        console.error('智能合并失败:', err);
        setStatus(`智能合并失败：${err.message || '请重试'}`);
      } finally {
        restoreFrameScheduler();
        // 完成后定位到本次合并范围的第一页；失败时恢复操作前的位置。
        if (app.pdfViewer) {
          const targetPage = completed ? startPage : originalPage;
          if (app.pdfViewer.currentPageNumber !== targetPage) {
            app.pdfViewer.currentPageNumber = targetPage;
          } else {
            app.pdfViewer.scrollPageIntoView({
              pageNumber: targetPage
            });
          }
          if (!completed) viewerContainer.scrollTop = originalScrollTop;
        }
        updateImportJsonBtn();
        updateUnmergeBtn();
        smartMergeRunning = false;
        for(const resolve of idleWaiters)resolve();
        idleWaiters.clear();
        smartMergeBtn.disabled = !!app.locked;
        smartMergeConfirm.disabled = false;
        smartMergeCancel.disabled = false;
      }
    };
    const readSmartMergeRange = () => {
      const totalPages = app.pdfDoc ? app.pdfDoc.numPages : 0;
      const startValue = smartMergeStartPage.value.trim();
      const endValue = smartMergeEndPage.value.trim();
      if (!startValue || !endValue) {
        smartMergeError.textContent = '请输入起始页码和结束页码。';
        return null;
      }
      const startPage = Number(startValue);
      const endPage = Number(endValue);
      if (!Number.isInteger(startPage) || !Number.isInteger(endPage)) {
        smartMergeError.textContent = '页码必须为整数。';
        return null;
      }
      if (startPage < 1 || endPage < 1 || startPage > totalPages || endPage > totalPages) {
        smartMergeError.textContent = `页码范围必须在 1 - ${totalPages} 之间。`;
        return null;
      }
      if (startPage > endPage) {
        smartMergeError.textContent = '起始页码不能大于结束页码。';
        return null;
      }
      smartMergeError.textContent = '';
      return {
        startPage,
        endPage
      };
    };

    // 确定按钮：仅在用户输入的页码范围内执行智能合并。
    smartMergeConfirm.addEventListener('click', async () => {
      if(app.locked){closeDialog();setStatus('JSON 导入期间及导入后不能智能合并。');return;}
      const range = readSmartMergeRange();
      if (!range) return;
      smartMergeModal.classList.remove('show');
      await runSmartMerge(range.startPage, range.endPage);
    });
    [smartMergeStartPage, smartMergeEndPage].forEach(input => {
      input.addEventListener('input', () => {
        smartMergeError.textContent = '';
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          smartMergeConfirm.click();
        }
      });
    });

    // 取消按钮：关闭弹窗
    smartMergeCancel.addEventListener('click', () => {
      smartMergeModal.classList.remove('show');
      smartMergeError.textContent = '';
    });
    smartMergeModal.addEventListener('mousedown', e => {
      if (e.target === smartMergeModal && !smartMergeRunning) {
        smartMergeModal.classList.remove('show');
        smartMergeError.textContent = '';
      }
    });


    const closeDialog = () => {
      if (!smartMergeModal.classList.contains('show')) return false;
      smartMergeModal.classList.remove('show');
      smartMergeError.textContent = '';
      return true;
    };
    const reset = () => {
      closeDialog();
      smartMergeStartPage.value = '';
      smartMergeEndPage.value = '';
      smartMergeError.textContent = '';
      smartMergeBtn.disabled = !!app.locked;
      smartMergeConfirm.disabled = false;
      smartMergeCancel.disabled = false;
      smartMergeDocumentProfile = 'generic';
    };
    return {
      get running() {
        return smartMergeRunning;
      },
      get profile() {
        return smartMergeDocumentProfile;
      },
      set profile(value) {
        smartMergeDocumentProfile = value;
      },
      closeDialog, reset, whenIdle,
      getSmartMergedText,
      isShrBatchHeader,
      isShrBatchSpecification,
      startsShrBatchSpecification,
      isShrBatchCodeList,
      getSmartMergeFormLayout,
      groupItemsBy,
      closestEdge,
      markStructuredCrfItems,
      isShrSampleSize,
      markShrStatisticalLines,
      getSmartMergeParagraphs,
      isCm313WrappedNarrowLabel,
      isCm313LabInstruction,
      shouldSkipSmartParagraph,
      detectSmartMergeDocumentProfile,
      enableMergeFrameScheduler,
      ensurePageTextLayer,
      runSmartMerge,
      readSmartMergeRange,
      getAuditUserFrame
    };
  };
  export const PDFSmartMerge = Object.freeze({create});


/** 手动合并、取消合并与统一合并状态。 */

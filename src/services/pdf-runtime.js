// 保留已验证的 PDF.js 3.11.174，避免升级渲染器导致 data-id 和文字层坐标改变。
import * as pdfjsModule from 'pdfjs-dist/build/pdf.js'
import * as viewerModule from 'pdfjs-dist/web/pdf_viewer.js'

// PDF.js 3 的 UMD 带 __esModule 标志但没有 default；同时兼容 Vite 开发预构建和 Rollup。
const pdfjsLib = pdfjsModule.default ?? pdfjsModule
const pdfjsViewer = viewerModule.default ?? viewerModule

const pdfResourceBase = `${import.meta.env.BASE_URL}pdfjs/`
pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfResourceBase}pdf.worker.min.js`

export { pdfjsLib, pdfjsViewer, pdfResourceBase }

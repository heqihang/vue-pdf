import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as PDFLib from 'pdf-lib'

test('拉伸预览复用同一20pt字库，仅替换内容流；结束后释放Worker', async () => {
  const captured = []
  let workers = 0, destroyed = 0
  const pdfjsLib = {
    PDFWorker: class { constructor() { workers++ } destroy() { destroyed++ } },
    getDocument({ data }) {
      return {
        promise: (async () => {
          const doc = await PDFLib.PDFDocument.load(data), page = doc.getPage(0)
          const stream = doc.context.lookup(page.node.Contents().get(0))
          const fonts = doc.context.lookup(page.node.Resources().get(PDFLib.PDFName.of('Font')))
          captured.push({ text: Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString(),
            fonts: fonts.entries().map(([, ref]) => String(doc.context.lookup(ref).get(PDFLib.PDFName.of('BaseFont')))),
            objects: doc.context.enumerateIndirectObjects().length })
          return { getPage: async () => ({
            getViewport: ({ scale }) => ({ width: page.getWidth() * scale, height: page.getHeight() * scale }),
            render: () => ({ promise: Promise.resolve(), cancel() {} }),
          }) }
        })(), destroy: async () => {},
      }
    },
  }
  const window = { devicePixelRatio: 1 }, document = { createElement: () => ({ style: {}, getContext: () => ({}) }) }
  // pdf-lib 对跨 VM 的 Array 使用 instanceof；在边界转为同一 realm 的尺寸数组。
  const library = { ...PDFLib, PDFDocument: { create: async () => {
    const doc = await PDFLib.PDFDocument.create()
    return new Proxy(doc, { get(target, key) {
      if (key === 'addPage') return size => target.addPage(Array.from(size))
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } } }
  const context = { window, document, pdfjsLib, PDFLib: library }
  const scope = { window, document }
  for (const [file, name] of [['pdf-export.js', 'PDFExport'], ['pdf-region-preview.js', 'PDFRegionPreview']]) {
    let code = await readFile(new URL('../src/modules/pdf/' + file, import.meta.url), 'utf8')
    code = code.replace(/^import .*\n/gm, '').replace('export const ' + name + ' =', 'window.' + name + ' =')
    vm.runInNewContext(code, context)
  }
  const draw = window.PDFExport.create({ scope, downloadBtn: { addEventListener() {} } }).drawPdfVectorLines
  const renderer = await window.PDFRegionPreview.create({ scope, prepareImportedFonts: async () => {},
    getPdfVectorFont: doc => doc.embedFont(PDFLib.StandardFonts.Courier), drawPdfVectorLines: draw,
    smartMerge: { enableMergeFrameScheduler: () => () => {} }, pdfResourceBase: '',
  }, { text: 'Wix wide letters', frame: { width: 200, height: 100 }, base: {}, family: 'Courier', color: 'rgb(0,0,0)' })
  for (const height of [100, 80, 120]) {
    const canvas = await renderer.render({ lines: ['Wix wide letters'], fontSize: 20, lineHeight: 24,
      baselineOffset: 16, width: 200, height, clip: true }, 1.667)
    assert.equal(canvas.style.width, `${Math.ceil(200 * 1.667)}px`)
  }
  for (const row of captured) {
    assert(row.text.includes('20 Tf'))
    assert.equal((row.text.match(/\nBT|^BT/g) || []).length, 1)
    assert.deepEqual(row.fonts, ['/Courier'])
  }
  assert(captured[2].objects <= captured[0].objects + 1)
  assert.equal(workers, 1)
  renderer.destroy()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(destroyed, 1)
  assert.equal(await renderer.render({}, 1), null)
})

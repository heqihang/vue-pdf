import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// 调用真实排版函数，使用典型1-10的实测字形和基线。
let source = await readFile(new URL('../src/modules/pdf/pdf-layout.js', import.meta.url), 'utf8')
source = source.replace(/^import .*\n/gm, '').replace('export const PDFLayout =', 'window.PDFLayout =')
const context = { window: {} }
vm.runInNewContext(source, context)
const app = { scope: {}, mergeApi: { tokenizeTextForWrap: text => text.match(/\S+\s*|\s+/g) || [] } }
const { layoutFixedPdfText } = context.window.PDFLayout.create(app)
const text = 'Is it a serious adverse event', size = 10.56
const font = {
  widthOfTextAtSize: (text, size) => [...text].length * size * .5,
  heightAtSize: (size, options = {}) => size * (options.descender === false ? .8 : 1),
  inkBoundsAtSize: () => ({ ascent: 7.54875, descent: 0 }),
}
const layout = (width, height = 13, baselineOffset = 7.40685, metric = font, value = text) =>
  layoutFixedPdfText(value, metric, size, 15.6, width, height, { baselineOffset })

test('完整单行顶部仅差0.1419pt时不误报，字号和基线保持不变', () => {
  const result = layout(170)
  assert.deepEqual(Array.from(result.lines), [text])
  assert.equal(result.incomplete, false)
  assert.equal(result.truncated, false)
  assert.equal(result.clipped, false)
  assert.equal(result.fontSize, size)
  assert.equal(result.baselineOffset, 7.40685)
})

test('实际截断、明显裁切、空框和缺失行仍然标记不完整', () => {
  assert.equal(layout(80).truncated, true)
  assert.equal(layout(80).incomplete, true)
  assert.equal(layout(170, 13, 7).clipped, true)
  const metric = { ...font, inkBoundsAtSize: () => ({ ascent: 7, descent: 3 }) }
  assert.equal(layout(170, 10, 7.15, metric).clipped, false)
  assert.equal(layout(170, 9.5, 7.15, metric).clipped, true)
  assert.equal(layout(0).incomplete, true)
  assert.equal(layout(170, 13, 7.40685, font, 'one\ntwo').incomplete, true)
})

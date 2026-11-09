import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))

test('所有功能入口和 PDF.js 渲染容器均位于 Vue 组件中', async () => {
  const components = await readdir(join(root, 'src/components'))
  const template = (await Promise.all(components.map(name => readFile(join(root, 'src/components', name), 'utf8')))).join('\n')
  const ids = ['fileInput', 'jsonFileInput', 'mergeBtn', 'unmergeBtn', 'smartMergeBtn', 'downloadBtn', 'exportJsonBtn', 'importJsonBtn', 'saveMergeBtn', 'restoreMergeBtn', 'spanBoundariesBtn', 'smartMergeModal', 'viewerContainer', 'viewer', 'shortcutHelpDialog']
  for (const id of ids) assert(template.includes(`id="${id}"`), id)
  assert(!template.includes('<iframe'))
})

test('字体清单中的每个二进制资源均完整提供', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'public/fonts/manifest.json'), 'utf8'))
  const sources = new Set()
  function walk(value) {
    if (!value || typeof value !== 'object') return
    if (value.source) sources.add(value.source)
    Object.values(value).forEach(walk)
  }
  walk(manifest)
  assert(sources.size > 0)
  for (const source of sources) assert((await readFile(join(root, 'public', source))).length > 0)
})

test('保留窄红框编辑规则且功能工厂不挂载到 window', async () => {
  for (const name of await readdir(join(root, 'src/modules/pdf'))) {
    const source = await readFile(join(root, 'src/modules/pdf', name), 'utf8')
    assert(!/window\.PDF\w+\s*=/.test(source), name)
    assert(!source.includes('https://cdnjs.cloudflare.com'), name)
  }
  const editor = await readFile(join(root, 'src/modules/pdf/pdf-region-editor.js'), 'utf8')
  assert(editor.includes("element.dataset.textOverflow==='1'||!!element.textContent.trim()"))
})

import { cp, mkdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = dirname(require.resolve('pdfjs-dist/package.json'))
const target = resolve(project, 'public/pdfjs')
await mkdir(target, { recursive: true })
for (const name of ['cmaps', 'standard_fonts']) {
  await cp(resolve(source, name), resolve(target, name), { recursive: true })
}
await copyFile(resolve(source, 'build/pdf.worker.min.js'), resolve(target, 'pdf.worker.min.js'))
await copyFile(resolve(source, 'LICENSE'), resolve(target, 'LICENSE'))
console.log('PDF worker、CMap 和标准字体已就绪。')

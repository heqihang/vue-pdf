import { http } from './http.js'

// 仅缓存已完成的资源。重试时复用成功项，不复用已取消/失败的请求。
const decodedSources = new Map()
const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0))

export async function bytesToBase64(buffer, { signal } = {}) {
  const bytes = new Uint8Array(buffer)
  const parts = []
  for (let at = 0; at < bytes.length; at += 0x8000) {
    signal?.throwIfAborted()
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)))
    // 大字库分段转换，主动让出主线程，避免后台预取影响点击和滚动。
    if (at && at % 0x80000 === 0) await yieldUi()
  }
  signal?.throwIfAborted()
  return btoa(parts.join(''))
}

/** 原字库后台预取；需要替换/导出时可按需等待，并复用已经成功的二进制资源。 */
export async function loadFontPrograms({ signal, onProgress = () => {} } = {}) {
  const { data: manifest } = await http.get('fonts/manifest.json', { signal })
  const urls = new Set()
  const walk = (value, visit) => {
    if (!value || typeof value !== 'object') return
    if (value.source) visit(value)
    for (const child of Object.values(value)) if (typeof child === 'object') walk(child, visit)
  }
  walk(manifest, item => urls.add(item.source))
  const sources = [...urls], data = new Map()
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
    while (cursor < sources.length) {
      signal?.throwIfAborted()
      const url = sources[cursor++]
      let encoded = decodedSources.get(url)
      if (!encoded) {
        const response = await http.get(url, { responseType: 'arraybuffer', signal })
        encoded = await bytesToBase64(response.data, { signal })
        decodedSources.set(url, encoded)
      }
      data.set(url, encoded)
      onProgress(data.size, sources.length)
    }
  }))
  walk(manifest, item => { item.data = data.get(item.source); delete item.source })
  return manifest
}

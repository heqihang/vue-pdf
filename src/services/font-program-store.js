/** 字库容器保持引用稳定；编辑器可在字库尚未就绪时立即挂载。 */
export function createFontProgramStore(load, { schedule, cancel } = {}) {
  const programs = { original: { automatic: [], simSun: { data: '', glyphs: {} } }, replacement: [], choices: [] }
  const controller = new AbortController()
  let ready = false, pending = null, disposed = false, scheduled = null
  const scheduleTask = schedule ?? (callback => setTimeout(callback, 50))
  const cancelTask = cancel ?? clearTimeout
  const ensureReady = () => {
    if (disposed) return Promise.reject(new DOMException('字体加载已取消', 'AbortError'))
    if (ready) return Promise.resolve(programs)
    if (pending) return pending
    pending = Promise.resolve().then(() => load({ signal: controller.signal })).then(data => {
      controller.signal.throwIfAborted()
      if (!Array.isArray(data?.original?.automatic) || !data.original.simSun?.data
        || !Array.isArray(data.replacement) || !Array.isArray(data.choices)) throw new Error('字体资源不完整，请重试当前操作。')
      // 完整加载后一次提交，不让排版模块读到半份字库。
      programs.original.automatic.splice(0, programs.original.automatic.length, ...data.original.automatic)
      Object.assign(programs.original.simSun, data.original.simSun)
      programs.replacement.splice(0, programs.replacement.length, ...data.replacement)
      programs.choices.splice(0, programs.choices.length, ...data.choices)
      ready = true
      return programs
    }).catch(error => { pending = null; throw error })
    return pending
  }
  return {
    programs, ensureReady,
    get ready() { return ready },
    prefetch() {
      if (disposed || ready || scheduled !== null) return
      scheduled = scheduleTask(() => {
        scheduled = null
        // 预取失败不阻塞页面；用户真正使用字体功能时会重试并获得操作错误提示。
        void ensureReady().catch(() => {})
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (scheduled !== null) cancelTask(scheduled)
      scheduled = null
      controller.abort()
    },
  }
}

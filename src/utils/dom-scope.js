/** 将原生 PDF 交互限定在组件生命周期内，避免重复挂载累积监听、观察器和定时器。 */
export function createDomScope(root) {
  const nativeWindow = window
  const nativeDocument = document
  const cleanups = []
  const nodes = new Set(), observers = new Set(), timers = new Set(), intervals = new Set(), frames = new Set()
  const savedBody = new Map(['pageBoundaries', 'regionEditReady'].map(key => [key, nativeDocument.body.dataset[key]]))
  const initialFrame = nativeWindow.requestAnimationFrame
  const initialCancel = nativeWindow.cancelAnimationFrame
  let disposed = false
  const on = (target, type, listener, options) => {
    if (disposed) return
    target.addEventListener(type, listener, options)
    cleanups.push(() => target.removeEventListener(type, listener, options))
  }
  const byId = id => root.querySelector(`[id="${CSS.escape(id)}"]`)
  const own = node => { nodes.add(node); return node }
  const cached = new WeakMap()
  const proxy = target => new Proxy(target, {
    get(object, key) {
      if (key === 'addEventListener') return (type, listener, options) => on(object, type, listener, options)
      if (object === nativeDocument && key === 'getElementById') return byId
      if (object === nativeDocument && key === 'body') return proxy(nativeDocument.body)
      if (object === nativeDocument.body && key === 'append') return (...items) => {
        for (const item of items) if (item instanceof Node) own(item)
        object.append(...items)
      }
      const value = Reflect.get(object, key, object)
      if (typeof value !== 'function') return value
      // 固定 bind 的返回值，便于 requestAnimationFrame 调度器恢复原方法。
      if (!cached.has(value)) cached.set(value, value.bind(object))
      return cached.get(value)
    },
    set(object, key, value) { return Reflect.set(object, key, value, object) },
  })
  const scopedWindow = proxy(nativeWindow)
  const scope = {
    window: scopedWindow, document: proxy(nativeDocument), root, byId, own, on,
    setTimeout(callback, delay, ...args) {
      if (disposed) return 0
      const id = nativeWindow.setTimeout(() => { timers.delete(id); if (!disposed) callback(...args) }, delay)
      timers.add(id); return id
    },
    clearTimeout(id) { nativeWindow.clearTimeout(id); timers.delete(id) },
    setInterval(callback, delay, ...args) {
      if (disposed) return 0
      const id = nativeWindow.setInterval(() => { if (!disposed) callback(...args) }, delay)
      intervals.add(id); return id
    },
    clearInterval(id) { nativeWindow.clearInterval(id); intervals.delete(id) },
    requestAnimationFrame(callback) {
      if (disposed) return 0
      const id = nativeWindow.requestAnimationFrame(time => { frames.delete(id); if (!disposed) callback(time) })
      frames.add(id); return id
    },
    cancelAnimationFrame(id) { nativeWindow.cancelAnimationFrame(id); frames.delete(id) },
    MutationObserver: class extends nativeWindow.MutationObserver {
      constructor(callback) { super((...args) => { if (!disposed) callback(...args) }); observers.add(this) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      cleanups.splice(0).reverse().forEach(cleanup => cleanup())
      for (const observer of observers) observer.disconnect()
      for (const id of timers) nativeWindow.clearTimeout(id)
      for (const id of intervals) nativeWindow.clearInterval(id)
      for (const id of frames) nativeWindow.cancelAnimationFrame(id)
      nativeWindow.requestAnimationFrame = initialFrame
      nativeWindow.cancelAnimationFrame = initialCancel
      for (const node of nodes) { if (node.open && node.close) node.close(); node.remove() }
      for (const [key, value] of savedBody) {
        if (value === undefined) delete nativeDocument.body.dataset[key]
        else nativeDocument.body.dataset[key] = value
      }
      observers.clear(); timers.clear(); intervals.clear(); frames.clear(); nodes.clear()
    },
  }
  return scope
}

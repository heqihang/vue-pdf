import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFontProgramStore } from '../src/services/font-program-store.js'

const data = () => ({ original: { automatic: [{ name: 'automatic', data: 'a' }], simSun: { data: 'sim', glyphs: { 65: { id: 1 } } } }, replacement: [{ role: 'song', data: 'b' }], choices: [] })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('创建容器不等待/下载字库，并发使用只发起一次加载，完整就绪才提交', async () => {
  const gate = deferred()
  let calls = 0
  const store = createFontProgramStore(async () => { calls++; return gate.promise })
  const automatic = store.programs.original.automatic, simSun = store.programs.original.simSun
  assert.equal(calls, 0)
  assert.equal(store.ready, false)
  const first = store.ensureReady(), second = store.ensureReady()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(simSun.data, '')
  assert.equal(automatic.length, 0)
  gate.resolve(data())
  await first
  assert.equal(store.ready, true)
  assert.equal(store.programs.original.automatic, automatic)
  assert.equal(store.programs.original.simSun, simSun)
  assert.equal(simSun.data, 'sim')
  await store.ensureReady()
  assert.equal(calls, 1)
  store.dispose()
})

test('后台预取失败不抛出未处理拒绝；下一次真正使用时能重试', async () => {
  let callback, calls = 0
  const store = createFontProgramStore(async () => {
    if (++calls === 1) throw new Error('offline')
    return data()
  }, { schedule: next => { callback = next; return 1 }, cancel() {} })
  store.prefetch()
  assert.equal(calls, 0)
  callback()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.ready, false)
  await store.ensureReady()
  assert.equal(store.ready, true)
  assert.equal(calls, 2)
  store.dispose()
})

test('卸载取消空闲预取与在途请求，不把不完整字体提交给编辑器', async () => {
  let cancelled = false, signal
  const gate = deferred()
  const store = createFontProgramStore(async options => { signal = options.signal; return gate.promise }, {
    schedule: () => 4, cancel: handle => { cancelled = handle === 4 },
  })
  store.prefetch()
  const result = store.ensureReady()
  await Promise.resolve()
  store.dispose()
  assert.equal(cancelled, true)
  assert.equal(signal.aborted, true)
  gate.resolve(data())
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(store.programs.original.simSun.data, '')
  await assert.rejects(store.ensureReady(), { name: 'AbortError' })
})

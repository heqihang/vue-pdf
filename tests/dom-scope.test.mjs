import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createDomScope } from '../src/utils/dom-scope.js'

test('实例卸载清理全局事件、定时器、观察器和附加弹窗', async () => {
  const browser = new Window()
  Object.assign(globalThis, { window: browser, document: browser.document, Node: browser.Node, CSS: browser.CSS })
  document.body.innerHTML = '<div id="root"><button id="target">PDF</button></div>'
  const root = document.getElementById('root'), scope = createDomScope(root)
  let events = 0, timers = 0, mutations = 0
  scope.document.addEventListener('click', () => events++)
  scope.setTimeout(() => timers++, 30)
  const observer = new scope.MutationObserver(() => mutations++)
  observer.observe(root, { childList: true })
  const dialog = scope.document.createElement('dialog')
  scope.document.body.append(dialog)
  assert.equal(scope.byId('target').textContent, 'PDF')
  document.dispatchEvent(new browser.Event('click'))
  assert.equal(events, 1)
  scope.document.body.dataset.pageBoundaries = '0'
  scope.dispose()
  scope.dispose()
  document.dispatchEvent(new browser.Event('click'))
  root.append(document.createElement('span'))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(events, 1)
  assert.equal(timers, 0)
  assert.equal(mutations, 0)
  assert.equal(dialog.isConnected, false)
  assert.equal(document.body.dataset.pageBoundaries, undefined)
  await browser.happyDOM.close()
})

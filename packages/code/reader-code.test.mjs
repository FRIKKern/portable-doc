import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(`<!doctype html><body>
  <pre data-lang="js">const answer = 42;</pre>
  <div class="bp-tabs" data-hydrated="true">
    <div role="tablist">
      <button class="bp-tabs__tab" role="tab" aria-selected="true">One</button>
      <button class="bp-tabs__tab" role="tab" aria-selected="false">Two</button>
    </div>
    <div class="bp-tabs__panel">First</div>
    <div class="bp-tabs__panel" hidden>Second</div>
  </div>
</body>`, { url: 'http://127.0.0.1/' })

globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver

try {
  const module = await import('./src/reader-code.js')
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(window.BarkparkPaperCode, module.default)
  assert.equal(typeof window.BarkparkPaperCode.highlightHtml, 'function')
  assert.equal(typeof window.BarkparkPaperCode.wireAllTabs, 'function')
  assert.equal(document.querySelector('pre').getAttribute('data-hl'), '1')
  assert.ok(document.querySelector('pre .hljs-keyword'))

  const tabs = [...document.querySelectorAll('[role="tab"]')]
  const panels = [...document.querySelectorAll('.bp-tabs__panel')]
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1])
  assert.deepEqual(panels.map((panel) => panel.getAttribute('role')), ['tabpanel', 'tabpanel'])

  const added = document.createElement('pre')
  added.dataset.lang = 'json'
  added.textContent = '{"ready": true}'
  document.body.append(added)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(added.getAttribute('data-hl'), '1', 'the bootstrap observer paints later reader blocks')
} finally {
  dom.window.close()
}

console.log('reader code bootstrap passed')

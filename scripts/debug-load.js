const Module = require('module')
const origLoad = Module._load
let hits = 0
Module._load = function (request, ...args) {
  if (request === 'electron') {
    hits++
    return { app: { getPath: () => process.env.HOME + '/Documents' }, clipboard: { readText: () => '' } }
  }
  return origLoad.call(this, request, ...args)
}
try {
  const cm = require('../.test-build/main/import/clipboard-monitor.js')
  console.log('module keys:', Object.keys(cm), 'hits:', hits)
  const text = ['小雨', '2026年09月22日 21:50', '晚安', ''].join('\n')
  cm.importClipboardText(text).then((r) => {
    console.log('capture:', JSON.stringify(r), 'hits:', hits)
  }).catch((e) => console.error('ERR2:', e.message))
} catch (e) { console.error('ERR:', e.message, 'hits:', hits) }

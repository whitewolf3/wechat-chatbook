/**
 * 真实端到端：importClipboardText 全链路（解析 → 归属 → inbox 留档 → runImport → 查库断言）
 * ELECTRON_RUN_AS_NODE 下 require('electron') 返回无二进制入口，library.ts 的
 * app.getPath 会崩——先拦截 Module._load 注入 mock（机制已在 debug-load.js 验证）。
 */
const Module = require('module')
const origLoad = Module._load
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return { app: { getPath: () => process.env.HOME + '/Documents' }, clipboard: { readText: () => '' } }
  }
  return origLoad.call(this, request, ...args)
}

const { importClipboardText } = require('../.test-build/main/import/clipboard-monitor.js')

const text = [
  '阿白',
  '2026年09月22日 21:40',
  '[链接] 最近单曲循环的歌 (电影原声) https://y.music.163.com/m/song?id=394992&fx-wxqd=',
  '',
  '阿白',
  '2026年09月22日 21:40',
  '旋律真好听',
  '',
  '小雨',
  '2026年09月22日 21:50',
  '晚安',
  '',
  '阿白',
  '2026年09月22日 21:51',
  '好，有机会听听',
  ''
].join('\n')

importClipboardText(text).then((r) => {
  console.log('capture:', JSON.stringify(r))
  if (!r) { console.log('FAIL: 未识别'); process.exit(1) }
  const Database = require('../node_modules/better-sqlite3')
  const db = new Database(process.env.HOME + '/Documents/ChatBook/chatbook.db', { readonly: true })
  const rows = db.prepare("SELECT sender, timestamp, substr(content,1,25) t FROM chat_message WHERE conversation_id=? AND timestamp >= '2026-09-22 21:40' ORDER BY timestamp").all(r.conversationId)
  console.log('库中 21:40 起:', rows)
  const ok = r.inserted === 4 && rows.length === 4 &&
    rows[0].sender === '阿白' && rows[2].sender === '小雨' &&
    rows.some((x) => String(x.t).includes('单曲循环'))
  console.log(ok ? 'E2E PASS' : 'E2E FAIL')
  process.exit(ok ? 0 : 1)
}).catch((e) => { console.error('FAIL:', e.message); process.exit(1) })

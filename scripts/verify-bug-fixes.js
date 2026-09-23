/**
 * 本轮 12 项修复的隔离回归（临时库目录，不碰 ~/Documents/ChatBook 真实数据）
 * 覆盖：两级去重回填 / recent 取最新 / 主动开启口径 / 会话歧义拒绝 /
 *       附件内容哈希判重 / 删会话清便签+留档 / HTML 导出多附件
 * 运行：先 tsc 编译到 .test-build，再 ELECTRON_RUN_AS_NODE=1 electron scripts/verify-bug-fixes.js
 */
const Module = require('module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// 拦截 electron：库根重定向到临时目录（机制见 verify-clipboard-import.js）
const FAKE_DOCS = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-fixes-'))
const origLoad = Module._load
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return { app: { getPath: () => FAKE_DOCS, isPackaged: false }, clipboard: { readText: () => '' } }
  }
  return origLoad.call(this, request, ...args)
}

const { getDb, getLibraryRoot, mediaDirFor, deleteConversationFiles } = require('../.test-build/main/library.js')
const { messageFingerprint } = require('../.test-build/main/db/database.js')
const { resolveConversation } = require('../.test-build/main/import/clipboard-monitor.js')
const { importMediaFile } = require('../.test-build/main/import/importer.js')
const { exportConversationHtml } = require('../.test-build/main/export/html-exporter.js')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')) }
}

const db = getDb()

// ========== fix8：upsertMessage 两级去重（先导文字后补附件） ==========
const cid1 = db.createConversation({ title: '去重', selfName: '我', peerName: '对方' })
const id1 = db.upsertMessage({
  conversationId: cid1, sender: '我', senderRole: 'self', messageType: 'text',
  content: '看这张图', timestamp: '2026-09-22 21:00:00', filePath: null,
  fingerprint: messageFingerprint(cid1, { sender: '我', timestamp: '2026-09-22 21:00:00', content: '看这张图', attachments: [] }),
  attachments: []
})
check('文字消息首次插入', id1 !== null, id1)
const id2 = db.upsertMessage({
  conversationId: cid1, sender: '我', senderRole: 'self', messageType: 'image',
  content: '看这张图', timestamp: '2026-09-22 21:00:00', filePath: 'a.jpg',
  fingerprint: messageFingerprint(cid1, { sender: '我', timestamp: '2026-09-22 21:00:00', content: '看这张图', attachments: [{ type: 'image', path: 'a.jpg' }] }),
  attachments: [{ type: 'image', path: 'a.jpg' }]
})
check('补附件不产生重复消息', id2 === null, id2)
const msgs1 = db.listMessages(cid1, { limit: 100 })
const m1 = msgs1.find((m) => m.content === '看这张图')
check('旧消息附件回填', m1 && m1.attachments.length === 1 && m1.attachments[0].path === 'a.jpg', m1 && m1.attachments)
check('消息总数仍为 1', msgs1.length === 1, msgs1.length)

// ========== fix4：listMessages recent 取最新（默认最早分页语义不变） ==========
for (let i = 1; i <= 9; i++) {
  const ts = `2026-09-22 21:0${i}:00`
  db.upsertMessage({
    conversationId: cid1, sender: '对方', senderRole: 'peer', messageType: 'text',
    content: '消息' + i, timestamp: ts, filePath: null,
    fingerprint: messageFingerprint(cid1, { sender: '对方', timestamp: ts, content: '消息' + i, attachments: [] }),
    attachments: []
  })
}
// cid1 共 10 条：21:00「看这张图」+ 21:01..21:09「消息1..9」
const recent3 = db.listMessages(cid1, { limit: 3, recent: true })
check('recent 取最近 3 条', recent3.length === 3 && recent3[0].content === '消息7' && recent3[2].content === '消息9', recent3.map((m) => m.content))
check('recent 仍按时间升序返回', recent3[0].timestamp <= recent3[1].timestamp && recent3[1].timestamp <= recent3[2].timestamp)
const oldest3 = db.listMessages(cid1, { limit: 3 })
check('默认模式取最早 3 条（分页语义不变）', oldest3.length === 3 && oldest3[0].content === '看这张图' && oldest3[2].content === '消息2', oldest3.map((m) => m.content))

// ========== fix11：主动开启口径（≥2h 静默后先开口，普通换人不算） ==========
const cidT = db.createConversation({ title: '口径', selfName: '我', peerName: '对方' })
function addTrend(sender, role, ts) {
  db.upsertMessage({
    conversationId: cidT, sender, senderRole: role, messageType: 'text',
    content: ts, timestamp: ts, filePath: null,
    fingerprint: messageFingerprint(cidT, { sender, timestamp: ts, content: ts, attachments: [] }),
    attachments: []
  })
}
addTrend('我', 'self', '2026-09-20 10:00:00')   // 会话首条 → self 主动
addTrend('对方', 'peer', '2026-09-20 10:05:00')  // 5 分钟换人，不算
addTrend('我', 'self', '2026-09-20 10:06:00')    // 不算
addTrend('对方', 'peer', '2026-09-20 15:00:00')  // 静默 294 分钟 ≥ 120 → peer 主动
addTrend('我', 'self', '2026-09-20 15:01:00')    // 不算
const trend = db.getTrendStats(cidT)
const t202609 = trend.find((t) => t.month === '2026-09')
check('普通换人不计主动（各计 1 次真实开启）', t202609 && t202609.selfInitiated === 1 && t202609.peerInitiated === 1, t202609)

// ========== fix2：resolveConversation 歧义拒绝 ==========
const cA = db.createConversation({ title: 'A', selfName: '阿白', peerName: '小美' })
const cB = db.createConversation({ title: 'B', selfName: '阿白', peerName: '张三' })
const onlySelf = [{ sender: '阿白' }]
check('self-only 在两个共用昵称会话间歧义 → null', resolveConversation(onlySelf) === null)
const withPeer = [{ sender: '阿白' }, { sender: '小美' }]
check('含对方昵称时唯一匹配会话 A', resolveConversation(withPeer)?.id === cA)

// ========== fix9：删除会话清理手动便签 + 剪贴板留档 ==========
db.addBookmark({ messageId: null, conversationId: cB, content: '手动便签' })
const inbox = path.join(getLibraryRoot(), 'clipboard-inbox')
fs.mkdirSync(inbox, { recursive: true })
fs.writeFileSync(path.join(inbox, `clipboard-${cB}-1000.txt`), 'x')
fs.writeFileSync(path.join(inbox, `clipboard-${cA}-1001.txt`), 'x')
deleteConversationFiles(cB)
db.deleteConversation(cB)
check('删会话清理其剪贴板留档', !fs.existsSync(path.join(inbox, `clipboard-${cB}-1000.txt`)))
check('其他会话留档保留', fs.existsSync(path.join(inbox, `clipboard-${cA}-1001.txt`)))
const Database = require('../node_modules/better-sqlite3')
const rawDb = new Database(path.join(getLibraryRoot(), 'chatbook.db'), { readonly: true })
check('删会话清理手动便签', rawDb.prepare('SELECT COUNT(*) AS n FROM message_bookmark WHERE conversation_id = ?').get(cB).n === 0)
rawDb.close()
check('删掉歧义会话后 self-only 可归属 A', resolveConversation(onlySelf)?.id === cA)

// ========== fix3：importMediaFile 内容哈希判重（同名同大小不同内容不复用） ==========
const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-media-src-'))
// 同名测试源文件须各放独立子目录（basename 相同才能触发同名判定，路径不同内容才不被覆盖）
function mk(sub, name, content) {
  const d = path.join(srcDir, sub)
  fs.mkdirSync(d, { recursive: true })
  const p = path.join(d, name)
  fs.writeFileSync(p, content)
  return p
}
const s1 = mk('s1', 'a.jpg', 'AAA') // 3 字节
const s2 = mk('s2', 'a.jpg', 'BBB') // 3 字节同大小、内容不同（旧逻辑按大小误复用的场景）
const s3 = mk('s3', 'a.jpg', 'CCC') // 3 字节同大小、内容又不同（后缀名也被占的二级退避）
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-media-dst-'))
check('首次导入原名', importMediaFile(s1, mediaDir) === 'a.jpg')
check('同名同内容复用不重复拷贝', importMediaFile(s1, mediaDir) === 'a.jpg')
const alt1 = importMediaFile(s2, mediaDir)
check('同名同大小不同内容加后缀另存', alt1 === 'a_3.jpg' && fs.readFileSync(path.join(mediaDir, alt1), 'utf8') === 'BBB', alt1)
const alt2 = importMediaFile(s3, mediaDir)
check('后缀名也被占再退一级', alt2 === 'a_3_2.jpg' && fs.readFileSync(path.join(mediaDir, alt2), 'utf8') === 'CCC', alt2)
const s4 = mk('s4', 'b.jpg', 'XY')
const s5 = mk('s5', 'b.jpg', 'XYZ')
importMediaFile(s4, mediaDir)
check('同名不同大小另存', importMediaFile(s5, mediaDir) !== 'b.jpg')

// ========== fix10：HTML 导出多附件（图片全内联 + 音视频下载链接） ==========
const cidE = db.createConversation({ title: '导出', selfName: '我', peerName: '对方' })
const mDir = mediaDirFor(cidE)
fs.writeFileSync(path.join(mDir, 'p1.jpg'), 'fake-jpeg-1')
fs.writeFileSync(path.join(mDir, 'p2.jpg'), 'fake-jpeg-2')
fs.writeFileSync(path.join(mDir, 'v1.mp4'), 'fake-mp4')
const atts = [
  { type: 'image', path: 'p1.jpg' },
  { type: 'image', path: 'p2.jpg' },
  { type: 'video', path: 'v1.mp4' }
]
db.upsertMessage({
  conversationId: cidE, sender: '对方', senderRole: 'peer', messageType: 'text',
  content: '多附件', timestamp: '2026-09-22 22:00:00', filePath: null,
  fingerprint: messageFingerprint(cidE, { sender: '对方', timestamp: '2026-09-22 22:00:00', content: '多附件', attachments: atts }),
  attachments: atts
})
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-export-'))
exportConversationHtml(cidE, outDir).then((htmlPath) => {
  const html = fs.readFileSync(htmlPath, 'utf8')
  const imgCount = (html.match(/<img class="media"/g) || []).length
  check('两张图片都内联导出（不再只留第一个）', imgCount === 2, imgCount)
  check('视频输出下载链接', /<a class="chip" href="assets\/[^"]*\.mp4" download/.test(html))
  const assetFiles = fs.readdirSync(path.join(outDir, 'assets'))
  check('assets 目录含全部 3 个附件', assetFiles.length === 3, assetFiles)

  fs.rmSync(FAKE_DOCS, { recursive: true, force: true })
  fs.rmSync(srcDir, { recursive: true, force: true })
  fs.rmSync(mediaDir, { recursive: true, force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}).catch((e) => { console.error('FAIL:', e); process.exit(1) })

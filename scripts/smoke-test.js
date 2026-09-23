/**
 * 冒烟测试（无需启动 GUI）：解析器 → 指纹去重入库 → 列表/搜索/上下文 → 媒体自动关联 → HTML 回读
 *
 * 用法：
 *   npm run smoke
 * （先将解析器/数据库编译到 .smoke-build/，再以 node 运行本脚本）
 */
const fs = require('node:fs')
const path = require('node:path')
const { findParser } = require('../.smoke-build/main/parsers/registry.js')
const { ChatDatabase, messageFingerprint } = require('../.smoke-build/main/db/database.js')

const ROOT = path.resolve(__dirname, '..')
const dbPath = path.join(ROOT, '.smoke-build', 'chatbook-test.db')
for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
  if (fs.existsSync(p)) fs.rmSync(p)
}

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')) }
}

// ---------- 1. 解析三个示例文件 ----------
const db = new ChatDatabase(dbPath)
const cid = db.createConversation({ title: '我和张三', selfName: '我', peerName: '张三' })

const files = ['结构化格式示例.txt', '微信复制格式示例.txt', '标准JSON格式示例.json']
let inserted = 0
for (const f of files) {
  const fp = path.join(ROOT, 'examples', f)
  const content = fs.readFileSync(fp, 'utf8')
  const parser = findParser({ filePath: fp, content })
  check(f + ' 识别解析器', !!parser, '未识别')
  if (!parser) continue
  const result = parser.parse({ filePath: fp, content })
  check(f + ' 解析出消息 (' + result.messages.length + ' 条)', result.messages.length > 0, result.warnings.join('; '))

  for (const m of result.messages) {
    const fingerprint = messageFingerprint(cid, {
      sender: m.sender, timestamp: m.timestamp,
      content: m.content, attachments: m.attachments
    })
    const id = db.upsertMessage({
      conversationId: cid,
      sender: m.sender,
      senderRole: m.sender === '我' ? 'self' : m.sender === '张三' ? 'peer' : 'unknown',
      messageType: m.messageType,
      content: m.content,
      timestamp: m.timestamp,
      filePath: null,
      fingerprint,
      attachments: []
    })
    if (id !== null) inserted++
  }
  console.log('    解析器=' + parser.id + ', 消息=' + result.messages.length + ', 警告=' + result.warnings.length)
}

console.log('\n入库消息数：' + inserted)

// ---------- 2. 查询 ----------
const all = db.listMessages(cid, {})
check('消息列表按时间升序', all.length > 0 && all.every((m, i) => i === 0 || all[i - 1].timestamp <= m.timestamp))
check('跨文件重复消息被指纹去重（输入 25 条 → 唯一 ' + all.length + ' 条）', all.length < 25 && all.length >= 10, '实际 ' + all.length)

const imgMsgs = all.filter((m) => m.messageType === 'image')
const stickerMsgs = all.filter((m) => m.messageType === 'sticker')
const voiceMsgs = all.filter((m) => m.messageType === 'voice')
check('识别 [图片] 占位', imgMsgs.length >= 2, '实际 ' + imgMsgs.length)
check('识别 [动画表情] 占位', stickerMsgs.length >= 2, '实际 ' + stickerMsgs.length)
check('识别 [语音] 占位', voiceMsgs.length >= 1, '实际 ' + voiceMsgs.length)

// ---------- 3. FTS 搜索 ----------
const hits = db.search({ keyword: '爬山' })
check('FTS 搜索「爬山」命中', hits.length >= 2, JSON.stringify(hits))
check('搜索结果含摘要', hits.length > 0 && hits[0].snippet.includes('爬山'), hits[0] && hits[0].snippet)

const none = db.search({ keyword: '不存在的词xyz' })
check('搜索无结果时返回空', none.length === 0)

const filterByRole = db.listMessages(cid, { senderRole: 'self' })
check('按发送人筛选（我）', filterByRole.length > 0 && filterByRole.every((m) => m.senderRole === 'self'))
const filterByType = db.listMessages(cid, { messageType: 'image' })
check('按类型筛选（图片）', filterByType.length === imgMsgs.length)

// ---------- 4. 上下文 ----------
const someMsg = all[4]
const ctx = db.messageContext(someMsg.id, 2, 2)
check('上下文查询返回前后消息', ctx.length === 5, '实际 ' + ctx.length)
check('上下文包含锚点', ctx.some((m) => m.id === someMsg.id))

// ---------- 5. 指纹去重（增量导入） ----------
const dupId = db.upsertMessage({
  conversationId: cid,
  sender: all[0].sender,
  senderRole: all[0].senderRole,
  messageType: all[0].messageType,
  content: all[0].content,
  timestamp: all[0].timestamp,
  filePath: null,
  fingerprint: messageFingerprint(cid, {
    sender: all[0].sender,
    timestamp: all[0].timestamp, content: all[0].content, attachments: []
  }),
  attachments: []
})
check('重复导入被跳过', dupId === null)

// 重复导入整个文件：消息总数不应增长
const countBefore = db.listMessages(cid, {}).length
const structuredPath = path.join(ROOT, 'examples', '结构化格式示例.txt')
const structuredContent = fs.readFileSync(structuredPath, 'utf8')
for (const m of require('../.smoke-build/main/parsers/registry.js').findParser({ filePath: structuredPath, content: structuredContent }).parse({ filePath: structuredPath, content: structuredContent }).messages) {
  db.upsertMessage({
    conversationId: cid, sender: m.sender, senderRole: m.sender === '我' ? 'self' : 'peer',
    messageType: m.messageType, content: m.content, timestamp: m.timestamp, filePath: null,
    fingerprint: messageFingerprint(cid, { sender: m.sender, timestamp: m.timestamp, content: m.content, attachments: m.attachments }),
    attachments: []
  })
}
check('整文件重复导入不增长（增量导入幂等）', db.listMessages(cid, {}).length === countBefore)

// ---------- 6. 媒体池自动关联 ----------
db.addMediaItem({ conversationId: cid, fileName: '2026-09-20_213200.jpg', path: '2026-09-20_213200.jpg', type: 'image', takenAt: '2026-09-20 21:32:00' })
db.addMediaItem({ conversationId: cid, fileName: 'mmexport1779228760000.jpg', path: 'mmexport1779228760000.jpg', type: 'image', takenAt: '2026-09-20 21:32:40' })
const linked = db.autoLinkMedia(cid, 120)
check('媒体自动关联（时间窗口内）', linked >= 1, '实际关联 ' + linked)
const afterLink = db.listMessages(cid, { messageType: 'image' })
const linkedMsg = afterLink.find((m) => m.attachments.length > 0)
check('关联后消息带附件路径', !!linkedMsg, '无附件')

// ---------- 7. HTML 回读（导出→再导入闭环） ----------
const htmlSnippet =
  '<div class="msg self" data-ts="2026-09-20 21:30:15" data-sender="我" data-role="self" data-type="text" data-text="今天工作怎么样？"></div>'
const htmlParser = findParser({ filePath: 'x.html', content: htmlSnippet })
check('HTML 格式识别', !!htmlParser && htmlParser.id === 'html')
if (htmlParser) {
  const r = htmlParser.parse({ filePath: 'x.html', content: htmlSnippet })
  check('HTML 回读解析', r.messages.length === 1 && r.messages[0].content === '今天工作怎么样？')
}

db.close()
console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)

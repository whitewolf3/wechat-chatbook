/**
 * 剪贴板监听解析逻辑 headless 验证
 * - parseClipboardText：微信导出分行格式（Mac 微信 4.x 多选复制实测格式）/
 *   微信复制单行头格式（向后兼容）/ 单条宽松兜底 / 普通文本反例
 * 运行：先 tsc 编译（含 clipboard-monitor.ts）到 .test-build，再 ELECTRON_RUN_AS_NODE 执行
 */
const { parseClipboardText } = require('../.test-build/main/import/clipboard-monitor.js')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')) }
}

// ========== 正例 1：Mac 微信 4.x 多选复制实测格式（发送者/中文日期/内容分行） ==========
const mac4x = [
  '阿白',
  '2026年09月22日 21:40',
  '[链接] 最近单曲循环的歌 (电影原声) https://y.music.163.com/m/song?id=394992&fx-wxqd=&playerUIModeId=76001',
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

const r0 = parseClipboardText(mac4x)
check('Mac4.x 实测格式解析出 4 条', r0 && r0.length === 4, r0 && r0.length)
check('sender 序列正确', r0 && r0.map((m) => m.sender).join(',') === '阿白,阿白,小雨,阿白', r0 && r0.map((m) => m.sender))
check('链接内容完整保留', r0 && r0[0].content.includes('y.music.163.com/m/song?id=394992'), r0 && r0[0].content.slice(0, 60))
check('中文日期时间格式化', r0 && r0[2].timestamp === '2026-09-22 21:50:00', r0 && r0[2].timestamp)

// ========== 正例 2：单条消息复制（宽松兜底路径，canParse 嗅探过不了 <2 组合） ==========
const singleExport = ['小雨', '2026年09月22日 21:50', '晚安', ''].join('\n')
const rSingle = parseClipboardText(singleExport)
check('单条导出格式被宽松兜底接住', rSingle && rSingle.length === 1, rSingle && rSingle.length)
check('单条 sender/content 正确', rSingle && rSingle[0].sender === '小雨' && rSingle[0].content === '晚安', rSingle && rSingle[0])

// ========== 正例 3：旧微信复制单行头格式（向后兼容） ==========
const good = [
  '阿白 2026-09-22 21:38:00',
  '你那边最近天气怎么样',
  '',
  '小雨 2026-09-22 21:39:15',
  '[动画表情]',
  '',
  '阿白 2026-09-22 21:40:30',
  '我觉得你需要一个舒服点的枕头，',
  '别到时候颈椎又不舒服',
  ''
].join('\n')

const r1 = parseClipboardText(good)
check('单行头格式解析出 3 条', r1 && r1.length === 3, r1 && r1.length)
check('sender 正确', r1 && r1[0].sender === '阿白' && r1[1].sender === '小雨', r1 && r1.map((m) => m.sender))
check('多行内容拼接', r1 && r1[2].content.includes('别到时候颈椎又不舒服'), r1 && r1[2].content)
check('占位符识别为 sticker', r1 && r1[1].messageType === 'sticker', r1 && r1[1].messageType)
check('时间戳格式化', r1 && r1[0].timestamp === '2026-09-22 21:38:00', r1 && r1[0].timestamp)

// 时间格式变体
const variants = [
  '阿白 2026/9/3 8:00',
  '早',
  '',
  '小雨 2026-09-22 21:39',
  '在呢'
].join('\n')
const r2 = parseClipboardText(variants)
check('单行头变体格式解析 2 条', r2 && r2.length === 2, r2 && r2.length)
check('无秒时间补零', r2 && r2[0].timestamp === '2026-09-03 08:00:00', r2 && r2[0].timestamp)

// ========== 反例 ==========
// 普通代码文本
const code = 'const a = 1\nconsole.log(a)\nexport function main() {}'
check('代码文本返回 null', parseClipboardText(code) === null)

// URL/单行
check('URL 返回 null', parseClipboardText('https://example.com/article?id=1') === null)

// 单行头格式单条（无宽松兜底，仍为 null）
const singleCopy = '阿白 2026-09-22 21:38:00\n只有一条'
check('单行头单条消息返回 null（无兜底）', parseClipboardText(singleCopy) === null)

// 空文本/超长
check('空文本 null', parseClipboardText('') === null)
check('超长 null', parseClipboardText('x'.repeat(200001)) === null)

// 日期形态但无昵称配对（日志格式）
const log = '[2026-09-22 21:38:00] INFO started\n[2026-09-22 21:39:00] INFO done'
check('日志格式 null（方括号不匹配行头）', parseClipboardText(log) === null)

// 中文日期行但无发送者配对（日期独占开头）
const bareDate = '2026年09月22日 21:40\n随便什么内容'
check('裸日期行 null（无发送者配对）', parseClipboardText(bareDate) === null)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)

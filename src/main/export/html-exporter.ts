/**
 * HTML 导出器：生成类微信阅读器的纯静态单页
 * - 日期分组 / 时间升序 / 发送人筛选 / 类型筛选 / 关键词搜索高亮
 * - 图片缩略 + 点击灯箱查看原图
 * - 零外部依赖（无 CDN / 无外链），file:// 双击即可打开
 * - 输出的 HTML 可被 html-parser 再导入（data-* 结构化属性）
 */
import fs from 'node:fs'
import path from 'node:path'
import type { MessageDTO } from '../../shared/types'
import { getDb, resolveMediaPath } from '../library'
import { formatDateLabel } from '../parsers/datetime'

export interface HtmlExportOptions {
  /** 媒体 base64 内嵌为单文件（适合归档）；默认拷贝到 assets/ 目录 */
  embed?: boolean
  fileName?: string
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

const TYPE_LABEL: Record<string, string> = {
  image: '图片',
  sticker: '表情',
  voice: '语音',
  video: '视频',
  file: '文件',
  location: '位置',
  quote: '聊天记录',
  link: '链接',
  system: '系统消息',
  unknown: '其他'
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\s\\/:*?"<>|]+/g, '-').slice(0, 80) || '聊天记录'
}

/** 为消息解析全部可展示媒体（附件全量；无附件时回退 file_path） */
function resolveAllMedia(m: MessageDTO): Array<{ src: string; type: string }> {
  const rels: Array<{ rel: string; type: string }> = m.attachments.length
    ? m.attachments.map((a) => ({ rel: a.path, type: a.type }))
    : m.filePath
      ? [{ rel: m.filePath, type: m.messageType }]
      : []
  const out: Array<{ src: string; type: string }> = []
  for (const { rel, type } of rels) {
    const abs = resolveMediaPath(m.conversationId, rel)
    if (fs.existsSync(abs)) out.push({ src: abs, type })
  }
  return out
}

export async function exportConversationHtml(
  conversationId: number,
  outDir: string,
  opts: HtmlExportOptions = {}
): Promise<string> {
  const db = getDb()
  const conv = db.getConversation(conversationId)
  if (!conv) throw new Error(`会话不存在：${conversationId}`)
  const messages = db.listMessages(conversationId, { limit: 100_000_000 })

  fs.mkdirSync(outDir, { recursive: true })
  const assetsDir = path.join(outDir, 'assets')
  if (!opts.embed && messages.some((m) => resolveAllMedia(m).length > 0)) fs.mkdirSync(assetsDir, { recursive: true })

  // ---------- 渲染消息 ----------
  const parts: string[] = []
  let currentDay = ''
  const days: string[] = []

  for (const m of messages) {
    const day = m.timestamp.slice(0, 10)
    if (day !== currentDay) {
      if (currentDay) parts.push('</section>')
      currentDay = day
      days.push(day)
      parts.push(`<section class="day" id="day-${esc(day)}">`)
      parts.push(`<div class="date-header"><span>${esc(formatDateLabel(day))}</span></div>`)
    }

    const time = m.timestamp.slice(11, 16)
    const mediaList = resolveAllMedia(m)
    const sticker = m.messageType === 'sticker'
    const type = sticker ? 'sticker' : m.messageType

    // 每个附件产出一条媒体地址：图片/表情内联展示，音视频/文件输出下载链接
    const mediaSrcs: string[] = []
    const linkSrcs: Array<{ src: string; type: string }> = []
    mediaList.forEach((md, idx) => {
      let src: string
      if (opts.embed) {
        const buf = fs.readFileSync(md.src)
        const mime = MIME_BY_EXT[path.extname(md.src).toLowerCase()] ?? 'application/octet-stream'
        src = `data:${mime};base64,${buf.toString('base64')}`
      } else {
        const name = `${type}-${m.id}-${idx}${path.extname(md.src).toLowerCase()}`
        fs.copyFileSync(md.src, path.join(assetsDir, name))
        src = `assets/${name}`
      }
      if (md.type === 'image' || md.type === 'gif' || path.extname(md.src).toLowerCase() === '.gif' || md.type === 'sticker') {
        mediaSrcs.push(src)
      } else {
        linkSrcs.push({ src, type: md.type })
      }
    })

    // 音视频/文件附件统一渲染为下载链接（与图片混合时追加在图后，不再丢失）
    const fileLinks = linkSrcs
      .map(
        (l, i) =>
          `<a class="chip" href="${esc(l.src)}" download>${esc(TYPE_LABEL[l.type] ?? '附件')}${linkSrcs.length > 1 ? ` ${i + 1}` : ''}</a>`
      )
      .join('')

    const firstSrc = mediaSrcs[0] ?? linkSrcs[0]?.src
    const attrs =
      `data-ts="${esc(m.timestamp)}" data-sender="${esc(m.sender)}" data-role="${m.senderRole}"` +
      ` data-type="${type}" data-text="${esc(m.content ?? '')}"` +
      (firstSrc ? ` data-src="${esc(firstSrc)}"` : '')

    const who = m.sender || (m.senderRole === 'self' ? '我' : '对方')
    const avatar = esc((who[0] ?? '?').toUpperCase())

    let bubble: string
    if (mediaSrcs.length > 0) {
      // 全部图片/表情附件内联展示（多图纵向排列），同消息的文件附件追加下载链接
      const cls = sticker ? 'bubble sticker' : 'bubble'
      const imgs = mediaSrcs
        .map((s) => `<img class="media" src="${esc(s)}" loading="lazy" alt="${TYPE_LABEL[type]}" title="点击查看原图">`)
        .join('')
      const text = m.content && m.content.trim() ? `<div class="bubble-text">${esc(m.content)}</div>` : ''
      bubble = `<div class="${cls}">${imgs}${fileLinks}${text}</div>`
    } else if (linkSrcs.length > 0) {
      const text = m.content ? `<div class="bubble-text">${esc(m.content)}</div>` : ''
      bubble = `<div class="bubble">${fileLinks}${text}</div>`
    } else if (type === 'text' || type === 'emoji') {
      bubble = `<div class="bubble"><div class="bubble-text">${esc(m.content ?? '')}</div></div>`
    } else {
      const label = TYPE_LABEL[type] ?? '消息'
      const text = m.content ? `<div class="bubble-text">${esc(m.content)}</div>` : ''
      bubble = `<div class="bubble"><div class="chip">[${label}]</div>${text}</div>`
    }

    parts.push(
      `<div class="msg ${m.senderRole}" ${attrs}>` +
        `<div class="avatar">${avatar}</div>` +
        `<div class="body">` +
        `<div class="meta"><span class="who">${esc(who)}</span><span class="time">${time}</span></div>` +
        bubble +
        `</div></div>`
    )
  }
  if (currentDay) parts.push('</section>')

  // ---------- 组装页面 ----------
  const title = conv.title
  const stats =
    conv.messageCount > 0
      ? `共 ${conv.messageCount} 条消息 · ${conv.firstTime ?? ''} ~ ${conv.lastTime ?? ''}`
      : '暂无消息'

  const typeOptions = ['image', 'sticker', 'voice', 'video', 'file']
    .map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`)
    .join('')
  const dateOptions = days
    .map((d) => `<option value="${esc(d)}">${esc(d.slice(5))} ${esc(formatDateLabel(d).split(' ')[1] ?? '')}</option>`)
    .join('')

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ChatBook（本地离线导出）">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<header class="toolbar">
  <div class="title">${esc(title)}</div>
  <input id="search" type="search" placeholder="搜索聊天内容…" />
  <select id="senderFilter">
    <option value="">全部发送人</option>
    <option value="self">我</option>
    <option value="peer">对方</option>
  </select>
  <select id="typeFilter">
    <option value="">全部类型</option>
    <option value="text">文本</option>
    ${typeOptions}
  </select>
  <select id="dateNav">
    <option value="">跳转日期</option>
    ${dateOptions}
  </select>
  <span id="count" class="count"></span>
</header>
<main>
${parts.join('\n')}
</main>
<div id="lightbox"><img alt="原图"></div>
<footer>由 ChatBook 在本机离线生成 · ${esc(stats)}</footer>
<script>
${JS}
</script>
</body>
</html>
`
  const fileName = opts.fileName ?? `聊天记录-${sanitizeFileName(title)}.html`
  const outPath = path.join(outDir, fileName)
  fs.writeFileSync(outPath, html, 'utf8')
  return outPath
}

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #f2f2f2; color: #1a1a1a;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; }
.toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; align-items: center;
  flex-wrap: wrap; padding: 10px 16px; background: rgba(255,255,255,.94); backdrop-filter: blur(8px);
  border-bottom: 1px solid #e5e5e5; }
.toolbar .title { font-weight: 600; margin-right: auto; font-size: 16px; }
.toolbar input, .toolbar select { border: 1px solid #ddd; border-radius: 6px; padding: 5px 8px;
  font-size: 13px; background: #fff; max-width: 180px; }
.count { font-size: 12px; color: #999; }
main { max-width: 820px; margin: 0 auto; padding: 16px 12px 48px; }
.day.hidden, .msg.hidden { display: none; }
.date-header { text-align: center; margin: 26px 0 14px; }
.date-header span { background: rgba(0,0,0,.06); color: #555; font-size: 12px; padding: 3px 10px; border-radius: 4px; }
.msg { display: flex; gap: 8px; margin: 12px 0; align-items: flex-start; }
.avatar { width: 36px; height: 36px; border-radius: 4px; background: #c7e0f4; color: #333;
  display: flex; align-items: center; justify-content: center; font-size: 15px; flex: none; }
.msg .body { max-width: 72%; }
.meta { font-size: 12px; color: #999; margin-bottom: 3px; display: flex; gap: 6px; align-items: baseline; }
.msg.self { flex-direction: row-reverse; }
.msg.self .meta { justify-content: flex-end; }
.bubble { background: #fff; border-radius: 6px; padding: 8px 12px;
  box-shadow: 0 1px 1px rgba(0,0,0,.06); word-break: break-word; white-space: pre-wrap; }
.msg.self .bubble { background: #95ec69; }
.bubble img.media { display: block; max-width: 280px; max-height: 340px; border-radius: 4px; cursor: zoom-in; }
.bubble img.media + img.media { margin-top: 6px; }
.bubble a.chip { display: inline-block; color: #576b95; text-decoration: none; border: 1px solid #dcdfe6;
  border-radius: 4px; padding: 2px 8px; margin: 2px 4px 2px 0; font-size: 13px; }
.bubble a.chip:hover { background: #f2f3f5; }
.bubble.sticker { background: transparent; box-shadow: none; padding: 0; }
.bubble.sticker img.media { width: 110px; max-height: none; }
.chip { color: #888; font-size: 13px; }
mark { background: #ffe58f; color: inherit; padding: 0 1px; border-radius: 2px; }
#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: none;
  align-items: center; justify-content: center; z-index: 99; cursor: zoom-out; }
#lightbox.show { display: flex; }
#lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 4px; }
footer { text-align: center; color: #aaa; font-size: 12px; padding: 18px 0 30px; }
@media print {
  .toolbar, #lightbox, footer { display: none; }
  body { background: #fff; }
  main { max-width: none; padding: 0; }
  .msg { page-break-inside: avoid; }
}
`

// 注意：导出页内脚本避免模板字符串，防止与导出器自身的 TS 模板字面量冲突
const JS = `
(function () {
  var msgs = [].slice.call(document.querySelectorAll('.msg'));
  var search = document.getElementById('search');
  var senderF = document.getElementById('senderFilter');
  var typeF = document.getElementById('typeFilter');
  var dateNav = document.getElementById('dateNav');
  var countEl = document.getElementById('count');

  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(kw) {
    msgs.forEach(function (m) {
      var el = m.querySelector('.bubble-text');
      if (!el) return;
      var raw = m.getAttribute('data-text') || '';
      if (!kw) { el.textContent = raw; return; }
      var low = raw.toLowerCase(), k = kw.toLowerCase();
      var out = '', last = 0, i = low.indexOf(k);
      while (i >= 0) {
        out += esc(raw.slice(last, i)) + '<mark>' + esc(raw.slice(i, i + k.length)) + '</mark>';
        last = i + k.length;
        i = low.indexOf(k, last);
      }
      out += esc(raw.slice(last));
      el.innerHTML = out;
    });
  }

  function apply() {
    var kw = search.value.trim();
    var sender = senderF.value, type = typeF.value, shown = 0;
    msgs.forEach(function (m) {
      var ok = true;
      if (sender && m.getAttribute('data-role') !== sender) ok = false;
      if (ok && type && m.getAttribute('data-type') !== type) ok = false;
      if (ok && kw && (m.getAttribute('data-text') || '').toLowerCase().indexOf(kw.toLowerCase()) < 0) ok = false;
      m.classList.toggle('hidden', !ok);
      if (ok) shown++;
    });
    [].forEach.call(document.querySelectorAll('.day'), function (d) {
      var vis = [].some.call(d.querySelectorAll('.msg'), function (m) { return !m.classList.contains('hidden'); });
      d.classList.toggle('hidden', !vis);
    });
    countEl.textContent = '显示 ' + shown + ' / ' + msgs.length + ' 条';
    highlight(kw);
  }

  search.addEventListener('input', apply);
  senderF.addEventListener('change', apply);
  typeF.addEventListener('change', apply);
  dateNav.addEventListener('change', function () {
    var d = document.getElementById('day-' + dateNav.value);
    if (d) d.scrollIntoView({ behavior: 'smooth' });
  });

  var lb = document.getElementById('lightbox');
  var lbImg = lb.querySelector('img');
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('media')) {
      lbImg.src = t.src;
      lb.classList.add('show');
    }
  });
  lb.addEventListener('click', function () { lb.classList.remove('show'); });

  apply();
})();
`

/**
 * PDF 导出器：复用 HTML 阅读器排版，经隐藏窗口 printToPDF 输出
 * （A4 分页、背景色、图片嵌入、时间保留；@media print 样式自动生效）
 */
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../library'
import { exportConversationHtml } from './html-exporter'

function sanitizeFileName(name: string): string {
  return name.replace(/[\s\\/:*?"<>|]+/g, '-').slice(0, 80) || '聊天记录'
}

export async function exportConversationPdf(
  conversationId: number,
  outDir: string
): Promise<string> {
  const conv = getDb().getConversation(conversationId)
  if (!conv) throw new Error(`会话不存在：${conversationId}`)

  fs.mkdirSync(outDir, { recursive: true })
  // 临时目录生成 HTML（含 assets），打印完成后删除
  const tmpDir = path.join(outDir, `.chatbook-pdf-tmp-${Date.now()}`)
  const htmlPath = await exportConversationHtml(conversationId, tmpDir, {
    fileName: 'index.html'
  })

  const win = new BrowserWindow({ show: false })
  try {
    await win.loadFile(htmlPath)
    // 等待所有图片加载完成，避免 PDF 中缺图。
    // 注意：导出页 img 是 loading="lazy"，隐藏窗口视口为零，懒加载永远不会开始，
    // 必须先把 loading 改为 eager 并重置 src 强制加载；之后用 complete 轮询（出错图片
    // complete 也是 true），60s 兜底超时后按已加载状态继续打印，不再永久挂起。
    await win.webContents.executeJavaScript(
      `(function () {
        Array.from(document.images).forEach(function (img) {
          img.loading = 'eager';
          img.src = img.src;
        });
        return new Promise(function (res) {
          var n = 0;
          var t = setInterval(function () {
            var all = Array.from(document.images).every(function (i) { return i.complete; });
            if (all || ++n >= 120) { clearInterval(t); res(all ? 'imgs-done' : 'imgs-timeout'); }
          }, 500);
        });
      })()`
    )
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    const pdfPath = path.join(outDir, `聊天记录-${sanitizeFileName(conv.title)}.pdf`)
    fs.writeFileSync(pdfPath, pdfBuffer)
    return pdfPath
  } finally {
    win.destroy()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

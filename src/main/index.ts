/**
 * 应用入口：窗口创建与生命周期
 */
import { config } from 'dotenv'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, net, protocol } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { getLibraryRoot } from './library'

// 加载 .env 配置
config({ path: resolve(process.env.HOME || '~', 'Documents/ChatBook/.env') })
config({ path: resolve(__dirname, '../../.env') })

// 自定义媒体协议：渲染进程页面源为 http(s) 时无法加载 file:// 资源，
// 统一通过 chatbook-media:// 安全读取媒体目录（需在 app ready 前注册特权）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'chatbook-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/** 注册媒体协议处理器：chatbook-media://media/<conversationId>/<fileName> → <library>/media/... */
function registerMediaProtocol(): void {
  protocol.handle('chatbook-media', (req) => {
    try {
      const url = new URL(req.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const root = resolve(getLibraryRoot(), 'media')
      const target = resolve(root, rel)
      // 防目录穿越：目标必须位于媒体根目录之内
      if (!target.startsWith(root + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      // 文件不存在时返回 404，而不是让 fetch 异常冒泡
      return net
        .fetch(pathToFileURL(target).toString())
        .catch(() => new Response('Not Found', { status: 404 }))
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ChatBook · 聊天记录整理',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 惯例：关闭窗口后保留应用，其余平台直接退出
  if (process.platform !== 'darwin') app.quit()
})

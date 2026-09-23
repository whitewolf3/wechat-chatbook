import { useEffect, useMemo, useState } from 'react'
import type { ConversationDTO, ImportProgress, ImportResult } from '../../shared/types'

interface Props {
  conversations: ConversationDTO[]
  onClose: () => void
  onImported: () => void
}

const DATA_EXTS = ['.txt', '.text', '.json', '.csv', '.html', '.htm', '.log']

const STAGE_LABEL: Record<string, string> = {
  prepare: '准备',
  media: '导入媒体',
  parse: '解析消息',
  link: '自动关联',
  done: '完成'
}

export default function ImportDialog({ conversations, onClose, onImported }: Props): JSX.Element {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [title, setTitle] = useState('')
  const [selfName, setSelfName] = useState('我')
  const [peerName, setPeerName] = useState('')
  const [existingId, setExistingId] = useState<number | ''>('')
  const [files, setFiles] = useState<string[]>([])
  const [mediaDirs, setMediaDirs] = useState<string[]>([])
  const [mediaFiles, setMediaFiles] = useState<string[]>([])
  const [dragOver, setDragOver] = useState<'data' | 'media' | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (running) {
      const off = window.chatbook.onImportProgress(setProgress)
      return off
    }
  }, [running])

  const existing = useMemo(
    () => conversations.find((c) => c.id === existingId) ?? null,
    [conversations, existingId]
  )

  const canSubmit =
    !running &&
    (mode === 'existing' ? existingId !== '' : title.trim().length > 0) &&
    (files.length > 0 || mediaDirs.length > 0 || mediaFiles.length > 0)

  const splitDropped = (fileList: FileList): { data: string[]; media: string[] } => {
    const data: string[] = []
    const media: string[] = []
    for (const f of Array.from(fileList)) {
      const p = window.chatbook.pathForFile(f)
      const dot = p.lastIndexOf('.')
      const ext = dot >= 0 ? p.slice(dot).toLowerCase() : ''
      if (DATA_EXTS.includes(ext)) data.push(p)
      else media.push(p)
    }
    return { data, media }
  }

  const handleSubmit = async (): Promise<void> => {
    setError(null)
    setRunning(true)
    setResult(null)
    try {
      const r = await window.chatbook.runImport({
        conversationId: mode === 'existing' ? (existingId as number) : undefined,
        title: mode === 'new' ? title.trim() : undefined,
        selfName: mode === 'new' ? selfName.trim() : undefined,
        peerName: mode === 'new' ? peerName.trim() : undefined,
        files,
        mediaDirs,
        mediaFiles
      })
      setResult(r)
      onImported()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-mask">
      <div className="modal">
        <div className="modal-head">
          <h2>导入聊天记录</h2>
          <button className="icon-btn" onClick={onClose} disabled={running}>
            ✕
          </button>
        </div>

        {result ? (
          <div className="import-result">
            <div className="result-ok">导入完成 ✔</div>
            <div>
              新增 <b>{result.inserted}</b> 条消息，跳过重复 <b>{result.skipped}</b> 条
            </div>
            {result.warnings.length > 0 && (
              <details className="warnings">
                <summary>{result.warnings.length} 条提示（不影响主流程）</summary>
                <ul>
                  {result.warnings.slice(0, 30).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>
                完成
              </button>
            </div>
          </div>
        ) : (
          <div className="import-form">
            <div className="field">
              <label>导入到</label>
              <div className="segment">
                <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')} disabled={running}>
                  新建会话
                </button>
                <button
                  className={mode === 'existing' ? 'on' : ''}
                  onClick={() => setMode('existing')}
                  disabled={running || conversations.length === 0}
                >
                  已有会话（增量）
                </button>
              </div>
            </div>

            {mode === 'new' ? (
              <>
                <div className="field-row">
                  <div className="field">
                    <label>会话标题 *</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="如：我和张三"
                      disabled={running}
                    />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>我的昵称（导出中显示为「我」）</label>
                    <input value={selfName} onChange={(e) => setSelfName(e.target.value)} disabled={running} />
                  </div>
                  <div className="field">
                    <label>对方昵称</label>
                    <input
                      value={peerName}
                      onChange={(e) => setPeerName(e.target.value)}
                      placeholder="好友昵称"
                      disabled={running}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="field">
                <label>选择会话（重复消息会自动去重）</label>
                <select value={existingId} onChange={(e) => setExistingId(Number(e.target.value))} disabled={running}>
                  <option value="">请选择…</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}（{c.messageCount} 条）
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              className={`dropzone ${dragOver === 'data' ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver('data')
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                const { data } = splitDropped(e.dataTransfer.files)
                setFiles((prev) => Array.from(new Set([...prev, ...data])))
              }}
            >
              <div className="dz-title">聊天数据文件</div>
              <div className="dz-sub">拖拽到此处，或</div>
              <button
                className="btn"
                disabled={running}
                onClick={async () => {
                  const picked = await window.chatbook.selectDataFiles()
                  if (picked) setFiles((prev) => Array.from(new Set([...prev, ...picked])))
                }}
              >
                选择文件（txt / json / csv / html）
              </button>
              {files.length > 0 && (
                <ul className="file-list">
                  {files.map((f) => (
                    <li key={f}>
                      <span>{f}</span>
                      <button className="icon-btn" onClick={() => setFiles(files.filter((x) => x !== f))}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div
              className={`dropzone ${dragOver === 'media' ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver('media')
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                const { media } = splitDropped(e.dataTransfer.files)
                setMediaFiles((prev) => Array.from(new Set([...prev, ...media])))
              }}
            >
              <div className="dz-title">媒体文件夹（图片 / 表情 / 视频）</div>
              <div className="dz-sub">可选。按文件名时间戳自动关联到消息</div>
              <button
                className="btn"
                disabled={running}
                onClick={async () => {
                  const picked = await window.chatbook.selectMediaDirs()
                  if (picked) setMediaDirs((prev) => Array.from(new Set([...prev, ...picked])))
                }}
              >
                选择文件夹（可多选）
              </button>
              {(mediaDirs.length > 0 || mediaFiles.length > 0) && (
                <ul className="file-list">
                  {mediaDirs.map((d) => (
                    <li key={d}>
                      <span>📁 {d}</span>
                      <button className="icon-btn" onClick={() => setMediaDirs(mediaDirs.filter((x) => x !== d))}>
                        ✕
                      </button>
                    </li>
                  ))}
                  {mediaFiles.map((f) => (
                    <li key={f}>
                      <span>🖼 {f}</span>
                      <button
                        className="icon-btn"
                        onClick={() => setMediaFiles(mediaFiles.filter((x) => x !== f))}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {running && progress && (
              <div className="progress">
                <div className="progress-label">
                  {STAGE_LABEL[progress.stage] ?? progress.stage}
                  {progress.total ? `（${progress.current ?? 0}/${progress.total}）` : ''}
                  {progress.detail ? ` · ${progress.detail}` : ''}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width:
                        progress.total && progress.total > 0
                          ? `${Math.round(((progress.current ?? 0) / progress.total) * 100)}%`
                          : '40%'
                    }}
                  />
                </div>
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={onClose} disabled={running}>
                取消
              </button>
              <button className="btn primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                {running ? '导入中…' : '开始导入'}
              </button>
            </div>

            <div className="privacy-note">
              所有数据仅在本机处理与保存，不会上传任何内容。{' '}
              {existing ? `本次导入将合并到「${existing.title}」。` : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 便签墙组件：展示/管理消息便签与手动便签
 * 手动便签（messageId 为 null）：用户在便签墙直接创建，不关联具体消息
 */
import React, { useState } from 'react'
import type { BookmarkDTO } from '../../shared/types'

interface BookmarkWallProps {
  conversationId: number
  bookmarks: BookmarkDTO[]
  onRefresh: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  promise: '#f59e0b',    // 承诺 - 橙色
  plan: '#3b82f6',       // 计划 - 蓝色
  preference: '#8b5cf6', // 偏好 - 紫色
  key_info: '#10b981',   // 关键信息 - 绿色
  general: '#6b7280'     // 通用 - 灰色
}

const CATEGORY_LABELS: Record<string, string> = {
  promise: '承诺',
  plan: '计划',
  preference: '偏好',
  key_info: '关键信息',
  general: '通用'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '13px',
  boxSizing: 'border-box'
}

export const BookmarkWall: React.FC<BookmarkWallProps> = ({ conversationId, bookmarks, onRefresh }) => {
  const [filter, setFilter] = useState<string>('all')
  const [creating, setCreating] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editCategory, setEditCategory] = useState('general')

  const filteredBookmarks = filter === 'all'
    ? bookmarks
    : bookmarks.filter((b) => b.category === filter)

  const resetCreate = (): void => {
    setCreating(false)
    setNewContent('')
    setNewNote('')
    setNewCategory('general')
  }

  const handleCreate = async (): Promise<void> => {
    const content = newContent.trim()
    if (!content) return
    await window.chatbook.addBookmark({
      messageId: null,
      conversationId,
      category: newCategory,
      content,
      note: newNote.trim() || undefined
    })
    resetCreate()
    onRefresh()
  }

  const handleDelete = async (id: number) => {
    if (confirm('确定删除这个便签吗？')) {
      await window.chatbook.removeBookmark(id)
      onRefresh()
    }
  }

  const handleEdit = (bookmark: BookmarkDTO) => {
    setEditingId(bookmark.id)
    setEditContent(bookmark.content ?? '')
    setEditNote(bookmark.note ?? '')
    setEditCategory(bookmark.category)
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return
    const content = editContent.trim()
    if (!content) return
    await window.chatbook.updateBookmark(editingId, {
      category: editCategory,
      content,
      note: editNote.trim() || null
    })
    setEditingId(null)
    onRefresh()
  }

  const editForm = (
    <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: '8px', padding: '10px' }}>
      <textarea
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', marginBottom: '8px' }}
        placeholder="便签内容…"
      />
      <input
        value={editNote}
        onChange={(e) => setEditNote(e.target.value)}
        style={{ ...inputStyle, marginBottom: '8px' }}
        placeholder="备注（可选）"
      />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select
          value={editCategory}
          onChange={(e) => setEditCategory(e.target.value)}
          style={{ ...inputStyle, width: 'auto', flex: 1 }}
        >
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button
          onClick={() => void handleSaveEdit()}
          style={{
            padding: '6px 14px', border: 'none', borderRadius: '6px',
            background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '12px'
          }}
        >
          保存
        </button>
        <button
          onClick={() => setEditingId(null)}
          style={{
            padding: '6px 14px', border: 'none', borderRadius: '6px',
            background: '#e5e7eb', color: '#374151', cursor: 'pointer', fontSize: '12px'
          }}
        >
          取消
        </button>
      </div>
    </div>
  )

  if (bookmarks.length === 0 && !creating) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
        <div>还没有便签</div>
        <div style={{ fontSize: '12px', marginTop: '8px', marginBottom: '16px' }}>
          在消息列表点击消息上的 🔖 标记消息，或手动创建一条便签
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: '8px 20px', border: 'none', borderRadius: '8px',
            background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: '13px'
          }}
        >
          ＋ 新建便签
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* 顶栏：新建按钮 + 分类筛选 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => (creating ? resetCreate() : setCreating(true))}
          style={{
            padding: '6px 14px', border: 'none', borderRadius: '8px',
            background: creating ? '#e5e7eb' : '#3b82f6',
            color: creating ? '#374151' : '#fff',
            cursor: 'pointer', fontSize: '13px'
          }}
        >
          {creating ? '取消' : '＋ 新建便签'}
        </button>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 12px', border: 'none', borderRadius: '16px',
            background: filter === 'all' ? '#3b82f6' : '#e5e7eb',
            color: filter === 'all' ? '#fff' : '#374151',
            cursor: 'pointer', fontSize: '13px'
          }}
        >
          全部 ({bookmarks.length})
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
          const count = bookmarks.filter((b) => b.category === key).length
          if (count === 0) return null
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: '16px',
                background: filter === key ? CATEGORY_COLORS[key] : '#e5e7eb',
                color: filter === key ? '#fff' : '#374151',
                cursor: 'pointer', fontSize: '13px'
              }}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      {/* 新建便签表单 */}
      {creating && (
        <div
          style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px',
            padding: '16px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}
        >
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            style={{ ...inputStyle, minHeight: '72px', resize: 'vertical', marginBottom: '8px' }}
            placeholder="想记什么？例如：她生日是 3 月 15 日…"
            autoFocus
          />
          <input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            style={{ ...inputStyle, marginBottom: '8px' }}
            placeholder="备注（可选）"
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{ ...inputStyle, width: 'auto', flex: 1 }}
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button
              onClick={() => void handleCreate()}
              disabled={!newContent.trim()}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: '6px',
                background: newContent.trim() ? '#3b82f6' : '#d1d5db',
                color: '#fff', cursor: newContent.trim() ? 'pointer' : 'not-allowed', fontSize: '12px'
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* 便签网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {filteredBookmarks.map((bookmark) => (
          <div
            key={bookmark.id}
            style={{
              background: CATEGORY_COLORS[bookmark.category] || CATEGORY_COLORS.general,
              borderRadius: '12px',
              padding: '16px',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              position: 'relative'
            }}
          >
            {/* 分类标签 */}
            <div style={{ fontSize: '11px', opacity: 0.9, marginBottom: '8px' }}>
              {CATEGORY_LABELS[bookmark.category] || bookmark.category}
              {bookmark.messageId == null && <span style={{ marginLeft: '6px' }}>✍️ 手动</span>}
            </div>

            {/* 正文 / 编辑表单 */}
            {editingId === bookmark.id ? (
              editForm
            ) : (
              <>
                <div style={{ fontSize: '14px', marginBottom: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                  {bookmark.content}
                </div>
                {bookmark.note && (
                  <div style={{ fontSize: '12px', opacity: 0.9, fontStyle: 'italic', marginBottom: '12px' }}>
                    📌 {bookmark.note}
                  </div>
                )}
              </>
            )}

            {/* 元信息：消息便签显示发送者+消息时间，手动便签显示创建时间 */}
            {editingId !== bookmark.id && (
              <div style={{ fontSize: '11px', opacity: 0.8, display: 'flex', justifyContent: 'space-between' }}>
                <span>{bookmark.sender ?? '手动创建'}</span>
                <span>{(bookmark.timestamp ?? bookmark.createdAt).slice(0, 16)}</span>
              </div>
            )}

            {/* 操作按钮 */}
            {editingId !== bookmark.id && (
              <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => handleEdit(bookmark)}
                  style={{
                    width: '24px', height: '24px', border: 'none', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer',
                    fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  title="编辑"
                >
                  ✏️
                </button>
                <button
                  onClick={() => void handleDelete(bookmark.id)}
                  style={{
                    width: '24px', height: '24px', border: 'none', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer',
                    fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  title="删除便签"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

# ChatBook Phase 3 - AI 增强功能设计

## 一、Phase 3 功能清单

### 3.1 手动媒体关联 UI
- 未关联媒体网格视图
- 拖拽关联到消息
- 批量关联（按日期范围）

### 3.2 AI 人物画像分析
**目标**：基于聊天记录分析对方的性格特征、兴趣爱好、沟通风格

**分析维度**：
- **兴趣标签**：提取高频话题（工作、生活、旅行、美食等）
- **沟通风格**：回复速度、消息长度、表情使用频率
- **活跃时段**：主要聊天时间段分布
- **情感倾向**：积极/中性/消极情绪比例
- **关注重点**：对方主动提起的话题统计

**实现方式**：
- 本地启发式分析（关键词频率、正则匹配）
- 可选：集成 LLM API 进行深度分析（需用户配置 API Key）

**UI 展示**：
- 会话详情页新增「人物画像」Tab
- 雷达图展示各维度得分
- 标签云展示兴趣爱好
- 时间热力图展示活跃时段

### 3.3 重要消息便签
**目标**：标记和快速查看对方发送的重要消息

**功能**：
- 消息右键菜单「标记为重要」
- 便签墙视图（类似便利贴墙）
- 按类型分类：承诺、计划、偏好、关键信息
- 支持手动添加备注
- 导出时包含便签汇总

**实现**：
- 数据库新增 `message_bookmark` 表
- 消息列表显示便签图标
- 独立便签管理页面

### 3.4 下一步推进建议
**目标**：基于聊天上下文，生成下一步行动建议

**场景示例**：
- 对方提到想去某地旅行 → 建议「可以开始查看机票/酒店」
- 对方提到生日快到了 → 建议「准备生日礼物」
- 对方提到工作压力大 → 建议「关心一下最近的工作情况」

**实现方式**：
- 规则引擎：匹配关键词触发建议模板
- 可选：LLM 生成个性化建议
- 建议列表展示在侧边栏

### 3.5 批量导出增强
- 多会话同时导出
- 导出格式选择（HTML/Markdown/PDF）
- 导出选项：包含媒体/仅文本/包含便签

---

## 二、数据库扩展

### 2.1 消息便签表
```sql
CREATE TABLE message_bookmark (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES chat_message(id) ON DELETE CASCADE,
  category        TEXT NOT NULL DEFAULT 'general', -- promise/plan/preference/key_info/general
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(message_id)
);
```

### 2.2 人物画像缓存表
```sql
CREATE TABLE contact_persona (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  analysis_data   TEXT NOT NULL, -- JSON
  analyzed_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(conversation_id)
);
```

### 2.3 建议记录表
```sql
CREATE TABLE conversation_suggestion (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  trigger_message_id INTEGER REFERENCES chat_message(id) ON DELETE SET NULL,
  category        TEXT NOT NULL,
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending/acknowledged/dismissed
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

---

## 三、开发任务分解

### Task 1: 数据库扩展（0.5 天）
- [ ] 新增 message_bookmark 表
- [ ] 新增 contact_persona 表
- [ ] 新增 conversation_suggestion 表
- [ ] 实现 bookmark CRUD 方法
- [ ] 实现 persona 缓存方法
- [ ] 实现 suggestion CRUD 方法

### Task 2: 手动媒体关联 UI（1 天）
- [ ] 未关联媒体网格组件
- [ ] 拖拽关联交互
- [ ] 批量关联逻辑

### Task 3: AI 人物画像分析（2 天）
- [ ] 本地启发式分析引擎
  - [ ] 兴趣标签提取
  - [ ] 沟通风格统计
  - [ ] 活跃时段分析
  - [ ] 情感倾向判断
- [ ] 画像 UI 组件
  - [ ] 雷达图
  - [ ] 标签云
  - [ ] 时间热力图
- [ ] 可选：LLM API 集成

### Task 4: 重要消息便签（1.5 天）
- [ ] 消息右键菜单
- [ ] 便签墙视图
- [ ] 便签分类管理
- [ ] 导出时包含便签

### Task 5: 下一步推进建议（1.5 天）
- [ ] 规则引擎实现
- [ ] 建议生成逻辑
- [ ] 侧边栏建议列表
- [ ] 建议状态管理

### Task 6: 批量导出增强（0.5 天）
- [ ] 多会话选择
- [ ] 导出选项 UI
- [ ] 批量导出逻辑

**总计**：约 7 天

---

## 四、技术选型

### 4.1 图表库
- **Chart.js** 或 **Recharts**：雷达图、柱状图
- **D3.js**（可选）：更复杂的可视化

### 4.2 AI 分析策略
- **本地优先**：所有分析默认在本地完成，保护隐私
- **可选增强**：用户可配置 LLM API（OpenAI/DeepSeek）获得更深度的分析

### 4.3 关键词库
- 预定义兴趣领域关键词词典
- 情感词库（积极/消极）
- 触发建议的关键词模式

---

## 五、优先级调整

建议开发顺序：
1. **数据库扩展**（基础）
2. **重要消息便签**（高频使用）
3. **AI 人物画像**（核心亮点）
4. **下一步推进建议**（增值功能）
5. **手动媒体关联**（完善体验）
6. **批量导出**（锦上添花）

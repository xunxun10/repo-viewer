---
name: "project-rules"
description: "Defines persistent project-level rules for RepoViewer. Invoke always when in Plan mode or Spec mode, when creating/editing any plan or spec documents."
---

# 项目规则

## 计划/规范文档时间戳规则

在 **Plan 模式** 或 **Spec 模式** 下，创建或编辑任何计划/规范文档时，必须遵守以下规则：

### 1. 文档文件名规则

计划文件名必须以当前时间开头，格式为：

```
YYYYMMDD-HHmm-$(unique_plan_title).md
```

例如：`20260711-1430-password-encryption-plan.md`

### 2. 文档内容规则

在文档的开头（标题之后、正文之前），必须插入一个时间元数据块：

```markdown
> **创建时间**: 2026-07-11 14:30
> **更新历史**:
> - 2026-07-11 14:30: 初始创建
```

### 3. 更新时规则

当更新已有文档时，必须在更新历史中追加新的记录行，格式为：

```
> - YYYY-MM-DD HH:mm: 更新内容简述
```

### 时间格式规范

- 日期格式：`YYYY-MM-DD`（如 `2026-07-11`）
- 时间格式：`HH:mm`（24 小时制，如 `14:30`）
- 时间来源：使用系统当前时间，无需向用户确认

---

## 通用代码规范（仅供参考）

- 保持简洁，不做过度设计
- 优先修改现有文件，不创建不必要的文件
- 代码注释使用用户当前对话语言

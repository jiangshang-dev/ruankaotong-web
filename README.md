# 软考通

本地软考备考笔记桌面端：Vue 3 + TypeScript + Electron。无需登录，笔记按学科保存为 Markdown。

## 功能

- **分学科**：架构、高项、软设、网工等常见科目切换
- **本地目录**：自行选择笔记仓库文件夹
- **知识点笔记**：Markdown 保存
- **论文练习**：题目一个框（首行名称 + 下方描述）；摘要 300 字以内；与正文上下排列
- **知识点笔记**：富文本工具栏（标题/正文/字号/对齐/下划线等），保存为 Markdown
  - 中文每个字计 1
  - 英文/数字整词计 1（空格分隔则计多个词）
  - 标点计 1

## 目录结构

选择本地根目录后，应用会按科目自动创建：

```text
你的目录/
  architect/
    notes/   # 知识点笔记 .md
    essays/  # 论文练习 .md
  pm/
    notes/
    essays/
  ...
```

## 开发

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist:mac
# 或
npm run dist:win
```

/**
 * 软考论文字数统计：
 * - 中文每个汉字算 1 字
 * - 英文/数字连续串（整个单词）算 1 字；空格分隔后算两个单词
 * - 标点符号每个算 1 字
 * - 空白不计入
 */
export function countExamWords(text: string): number {
  if (!text) return 0
  const matches = text.match(
    /[\u4e00-\u9fff]|[A-Za-z0-9]+|[^\s\u4e00-\u9fffA-Za-z0-9]/g,
  )
  return matches ? matches.length : 0
}

export function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export interface EssayParts {
  title: string
  /** 题目背景与写作要求等大段描述 */
  prompt: string
  abstract: string
  body: string
}

/** 题目名称 + 描述合并为一个文本框：首行作标题，其余作描述 */
export function splitTopic(topic: string): { title: string; prompt: string } {
  const text = topic.replace(/\r\n/g, '\n').trim()
  if (!text) return { title: '', prompt: '' }
  const idx = text.indexOf('\n')
  if (idx < 0) return { title: text, prompt: '' }
  return {
    title: text.slice(0, idx).trim(),
    prompt: text.slice(idx + 1).trim(),
  }
}

export function joinTopic(title: string, prompt: string): string {
  const t = title.trim()
  const p = prompt.trim()
  if (!t) return p
  if (!p) return t
  if (p === t || p.startsWith(`${t}\n`)) return p
  return `${t}\n\n${p}`
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function buildEssayMarkdown(parts: EssayParts): string {
  const fromTopic = splitTopic(parts.prompt)
  const title = parts.title.trim() || fromTopic.title || '未命名论文'
  const topicBlock = parts.prompt.trim() || title
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: essay
updatedAt: "${new Date().toISOString()}"
---

# ${title}

## 题目描述

${topicBlock}

## 摘要

${parts.abstract.trim()}

## 正文

${parts.body.trim()}
`
}

export function parseEssayMarkdown(content: string): EssayParts {
  let rest = content
  let title = ''

  const fm = content.match(FRONT_MATTER_RE)
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine) {
      title = titleLine[1].trim().replace(/^["']|["']$/g, '')
    }
    rest = content.slice(fm[0].length)
  }

  const h1 = rest.match(/^#\s+(.+)$/m)
  if (h1 && !title) title = h1[1].trim()

  const promptMatch = rest.match(
    /##\s*题目描述\s*\r?\n([\s\S]*?)(?=\r?\n##\s*摘要\b|$)/,
  )
  const abstractMatch = rest.match(
    /##\s*摘要\s*\r?\n([\s\S]*?)(?=\r?\n##\s*正文\b|$)/,
  )
  const bodyMatch = rest.match(/##\s*正文\s*\r?\n([\s\S]*)$/)

  const promptRaw = promptMatch ? promptMatch[1].trim() : ''
  const split = splitTopic(promptRaw)
  if (!title && split.title) title = split.title

  return {
    title: title || split.title || '未命名论文',
    prompt: promptRaw,
    abstract: abstractMatch ? abstractMatch[1].trim() : '',
    body: bodyMatch ? bodyMatch[1].trim() : '',
  }
}

export function buildNoteMarkdown(title: string, body: string): string {
  const t = title.trim() || '未命名笔记'
  return `---
title: "${t.replace(/"/g, '\\"')}"
type: note
updatedAt: "${new Date().toISOString()}"
---

# ${t}

${body.trim()}
`
}

export function parseNoteMarkdown(content: string): { title: string; body: string } {
  let rest = content
  let title = ''
  const fm = content.match(FRONT_MATTER_RE)
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine) title = titleLine[1].trim().replace(/^["']|["']$/g, '')
    rest = content.slice(fm[0].length)
  }
  const h1 = rest.match(/^#\s+(.+)\r?\n?/)
  if (h1) {
    if (!title) title = h1[1].trim()
    rest = rest.slice(h1[0].length)
  }
  return { title: title || '未命名笔记', body: rest.replace(/^\s+/, '') }
}

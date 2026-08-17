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

/** 从题目区 Markdown 取标题：跳过图片行，取首行可见文字 */
export function extractEssayTitle(topicMd: string): string {
  const lines = topicMd.replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^!\[[^\]]*]\([^)]*\)/.test(t) || /^<img\b/i.test(t)) continue
    return t.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim()
  }
  return ''
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 匹配论文结构标题行：## 题目描述 / ## 摘要 / ## 正文 */
const ESSAY_SECTION_LINE_RE = /^##\s*(题目描述|摘要|正文)\s*$/gm

function findSectionRanges(text: string): {
  topic?: { start: number; end: number }
  abstract?: { start: number; end: number }
  body?: { start: number; end: number }
} {
  const normalized = text.replace(/\r\n/g, '\n')
  const headers: {
    name: 'topic' | 'abstract' | 'body'
    lineStart: number
    contentStart: number
  }[] = []
  ESSAY_SECTION_LINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ESSAY_SECTION_LINE_RE.exec(normalized))) {
    const label = m[1]
    const name =
      label === '题目描述' ? 'topic' : label === '摘要' ? 'abstract' : 'body'
    headers.push({
      name,
      lineStart: m.index,
      contentStart: m.index + m[0].length,
    })
  }
  const ranges: {
    topic?: { start: number; end: number }
    abstract?: { start: number; end: number }
    body?: { start: number; end: number }
  } = {}
  for (let i = 0; i < headers.length; i++) {
    const cur = headers[i]
    const end =
      i + 1 < headers.length ? headers[i + 1].lineStart : normalized.length
    ranges[cur.name] = { start: cur.contentStart, end }
  }
  return ranges
}

function sliceSection(
  text: string,
  range?: { start: number; end: number },
): string {
  if (!range) return ''
  return text.slice(range.start, range.end).replace(/^\n+/, '').trim()
}

/**
 * 清理某一框里误带入的后续章节标题及之后内容。
 * 例如摘要框里出现「## 正文」或「### 正文」时，截断到该行之前。
 */
export function stripTrailingEssaySections(
  text: string,
  kind: 'topic' | 'abstract' | 'body',
): string {
  let t = text.replace(/\r\n/g, '\n').trim()
  if (!t) return ''

  // 去掉开头误带的本章节标题
  if (kind === 'topic') {
    t = t.replace(/^##\s*题目描述\s*\n+/u, '')
  } else if (kind === 'abstract') {
    t = t.replace(/^##\s*摘要\s*\n+/u, '')
  } else {
    t = t.replace(/^##\s*正文\s*\n+/u, '')
  }

  // 截断到后续结构标题（兼容 ## / ###）
  let cutAt = -1
  const lines = t.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const isTopic = /^#{1,6}\s*题目描述\s*$/u.test(line)
    const isAbs = /^#{1,6}\s*摘要\s*$/u.test(line)
    const isBody = /^#{1,6}\s*正文\s*$/u.test(line)
    if (kind === 'topic' && (isAbs || isBody)) {
      cutAt = i
      break
    }
    if (kind === 'abstract' && (isBody || isTopic)) {
      cutAt = i
      break
    }
    // 正文里若又出现摘要/题目描述结构标题，也截断，避免回写污染
    if (kind === 'body' && (isAbs || isTopic)) {
      cutAt = i
      break
    }
  }
  if (cutAt >= 0) {
    t = lines.slice(0, cutAt).join('\n').trim()
  }
  return t
}

export function sanitizeEssayParts(parts: EssayParts): EssayParts {
  const title = parts.title.trim() || '未命名论文'
  let prompt = stripTrailingEssaySections(parts.prompt, 'topic')
  // 题目描述里不要再叠一层同名一级标题
  prompt = prompt.replace(new RegExp(`^#\\s*${escapeRegExp(title)}\\s*\\n+`, 'u'), '')
  // 若 prompt 整段就是「标题 + 描述」，保留；若误存了完整 markdown，上面已截断
  const abstract = stripTrailingEssaySections(parts.abstract, 'abstract')
  const body = stripTrailingEssaySections(parts.body, 'body')
  return { title, prompt: prompt.trim(), abstract, body }
}

export function buildEssayMarkdown(parts: EssayParts): string {
  const cleaned = sanitizeEssayParts({
    ...parts,
    // prompt 字段可能是整段题目框（含首行标题）
    prompt: parts.prompt,
    title: parts.title,
  })
  const fromTopic = splitTopic(cleaned.prompt)
  const title = cleaned.title || fromTopic.title || '未命名论文'
  // 题目描述区：保存完整题目框内容（首行标题+描述），但已去掉摘要/正文污染
  const topicBlock = cleaned.prompt.trim() || title
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: essay
updatedAt: "${new Date().toISOString()}"
---

# ${title}

## 题目描述

${topicBlock}

## 摘要

${cleaned.abstract}

## 正文

${cleaned.body}
`
}

export function parseEssayMarkdown(content: string): EssayParts {
  let rest = content.replace(/\r\n/g, '\n')
  let title = ''

  const fm = rest.match(FRONT_MATTER_RE)
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine) {
      title = titleLine[1].trim().replace(/^["']|["']$/g, '')
    }
    rest = rest.slice(fm[0].length)
  }

  const h1 = rest.match(/^#\s+(.+)\s*$/m)
  if (h1 && !title) title = h1[1].trim()

  const ranges = findSectionRanges(rest)
  let promptRaw = sliceSection(rest, ranges.topic)
  let abstractRaw = sliceSection(rest, ranges.abstract)
  let bodyRaw = sliceSection(rest, ranges.body)

  // 兼容旧文件：没有「题目描述」分区时，尝试用摘要前内容
  if (!promptRaw && !ranges.topic) {
    const absIdx = rest.search(/^##\s*摘要\s*$/m)
    if (absIdx > 0) {
      promptRaw = rest
        .slice(0, absIdx)
        .replace(/^#\s+.+?\n+/, '')
        .trim()
    }
  }

  const cleaned = sanitizeEssayParts({
    title: title || '未命名论文',
    prompt: promptRaw,
    abstract: abstractRaw,
    body: bodyRaw,
  })
  const split = splitTopic(cleaned.prompt)
  if (!title && split.title) cleaned.title = split.title
  else if (title) cleaned.title = title

  return cleaned
}

export function buildNoteMarkdown(title: string, body: string): string {
  const t = title.trim() || '未命名笔记'
  // 标题只写 frontmatter，正文不再重复插入 # 标题，避免每次保存叠一层
  const cleanedBody = stripLeadingTitleHeading(body, t)
  return `---
title: "${t.replace(/"/g, '\\"')}"
type: note
updatedAt: "${new Date().toISOString()}"
---

${cleanedBody}
`
}

/** 去掉正文开头与笔记标题相同的一级标题（可连续多行，兼容历史脏数据） */
export function stripLeadingTitleHeading(body: string, title: string): string {
  let text = body.replace(/^\uFEFF/, '').replace(/^\s+/, '')
  const t = title.trim()
  if (!t) return text.trim()
  // 匹配：# 标题 / #标题 ，允许重复多行
  const re = new RegExp(
    `^(?:#\\s*${escapeRegExp(t)}\\s*(?:\\r?\\n)+)+`,
    'i',
  )
  text = text.replace(re, '')
  // 兼容 turndown 可能留下的单独一行同名标题
  const single = new RegExp(`^#\\s*${escapeRegExp(t)}\\s*$`, 'im')
  if (single.test(text.split(/\r?\n/, 1)[0] || '')) {
    text = text.replace(single, '').replace(/^\s+/, '')
  }
  return text.trim()
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
  const h1 = rest.match(/^#\s+(.+?)\s*(?:\r?\n|$)/)
  if (h1) {
    if (!title) title = h1[1].trim()
    rest = rest.slice(h1[0].length)
  }
  const resolvedTitle = title || '未命名笔记'
  // 去掉正文顶部重复的主标题（历史多次保存产生的脏数据）
  const body = stripLeadingTitleHeading(rest, resolvedTitle)
  return { title: resolvedTitle, body }
}

export interface CaseParts {
  title: string
  /** 题目区 Markdown，可含截图 */
  topic: string
  /** 考生作答，按题号书写即可 */
  answer: string
}

const CASE_SECTION_LINE_RE = /^##\s*(题目|答案)\s*$/gm

function findCaseSectionRanges(text: string): {
  topic?: { start: number; end: number }
  answer?: { start: number; end: number }
} {
  const normalized = text.replace(/\r\n/g, '\n')
  const headers: {
    name: 'topic' | 'answer'
    lineStart: number
    contentStart: number
  }[] = []
  CASE_SECTION_LINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CASE_SECTION_LINE_RE.exec(normalized))) {
    headers.push({
      name: m[1] === '题目' ? 'topic' : 'answer',
      lineStart: m.index,
      contentStart: m.index + m[0].length,
    })
  }
  const ranges: {
    topic?: { start: number; end: number }
    answer?: { start: number; end: number }
  } = {}
  for (let i = 0; i < headers.length; i++) {
    const cur = headers[i]
    const end =
      i + 1 < headers.length ? headers[i + 1].lineStart : normalized.length
    ranges[cur.name] = { start: cur.contentStart, end }
  }
  return ranges
}

export function stripCaseTopicText(md: string): string {
  return md
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildCaseMarkdown(parts: CaseParts): string {
  const title = parts.title.trim() || '未命名案例分析'
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: case
updatedAt: "${new Date().toISOString()}"
---

# ${title}

## 题目

${parts.topic.trim()}

## 答案

${parts.answer.trim()}
`
}

export function parseCaseMarkdown(content: string): CaseParts {
  let rest = content.replace(/\r\n/g, '\n')
  let title = ''
  const fm = rest.match(FRONT_MATTER_RE)
  if (fm) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine) title = titleLine[1].trim().replace(/^["']|["']$/g, '')
    rest = rest.slice(fm[0].length)
  }
  const h1 = rest.match(/^#\s+(.+)\s*$/m)
  if (h1 && !title) title = h1[1].trim()

  const ranges = findCaseSectionRanges(rest)
  let topic = sliceSection(rest, ranges.topic)
  let answer = sliceSection(rest, ranges.answer)

  if (!topic && !ranges.topic) {
    const ansIdx = rest.search(/^##\s*答案\s*$/m)
    if (ansIdx >= 0) {
      topic = rest
        .slice(0, ansIdx)
        .replace(/^#\s+.+?\n+/, '')
        .trim()
      answer = rest.slice(ansIdx).replace(/^##\s*答案\s*/, '').trim()
    } else {
      topic = rest.replace(/^#\s+.+?\n+/, '').trim()
    }
  }

  if (title) {
    topic = stripLeadingTitleHeading(topic, title)
  }

  return {
    title: title || '未命名案例分析',
    topic,
    answer,
  }
}

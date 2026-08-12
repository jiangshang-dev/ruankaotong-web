import { marked } from 'marked'
import TurndownService from 'turndown'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
})

turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
})

turndown.addRule('alignment', {
  filter: (node) => {
    if (!(node instanceof HTMLElement)) return false
    const align =
      node.style.textAlign ||
      node.getAttribute('align') ||
      ''
    return ['left', 'center', 'right', 'justify'].includes(align)
  },
  replacement: (content, node) => {
    const el = node as HTMLElement
    const align =
      el.style.textAlign || el.getAttribute('align') || 'left'
    const tag = el.tagName.toLowerCase()
    if (tag === 'p' || tag === 'div') {
      return `\n\n<p style="text-align:${align}">${content}</p>\n\n`
    }
    return content
  },
})

turndown.addRule('fontSize', {
  filter: (node) => {
    if (!(node instanceof HTMLElement)) return false
    return Boolean(node.style.fontSize)
  },
  replacement: (content, node) => {
    const el = node as HTMLElement
    const size = el.style.fontSize
    return `<span style="font-size:${size}">${content}</span>`
  },
})

export function markdownToHtml(md: string): string {
  if (!md.trim()) return '<p><br></p>'
  return marked.parse(md, { async: false }) as string
}

export function htmlToMarkdown(html: string): string {
  const cleaned = html
    .replace(/<div><br><\/div>/gi, '<p><br></p>')
    .replace(/&nbsp;/g, ' ')
  const md = turndown.turndown(cleaned).trim()
  return md
}

export function plainTextFromHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

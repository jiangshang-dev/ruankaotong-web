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

function readImageWidth(el: HTMLImageElement): number | null {
  const dataW = el.getAttribute('data-width')
  if (dataW && Number(dataW) > 0) return Math.round(Number(dataW))
  const attrW = el.getAttribute('width')
  if (attrW && Number(attrW) > 0) return Math.round(Number(attrW))
  const styleW = el.style.width
  if (styleW?.endsWith('px')) {
    const n = parseFloat(styleW)
    if (n > 0) return Math.round(n)
  }
  return null
}

turndown.addRule('localImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const el = node as HTMLImageElement
    const src =
      el.getAttribute('data-md-src') ||
      el.getAttribute('src') ||
      ''
    const alt = el.getAttribute('alt') || 'image'
    if (src.startsWith('data:')) return ''
    const width = readImageWidth(el)
    if (width) {
      return `\n\n<img src="${src}" alt="${alt}" width="${width}" />\n\n`
    }
    return `\n\n![${alt}](${src})\n\n`
  },
})

export function collectAssetPaths(md: string): string[] {
  const paths: string[] = []
  const mdRe = /!\[[^\]]*]\((\.\/)?(assets\/[^)\s]+)\)/g
  const htmlRe =
    /<img[^>]+(?:src|data-md-src)=["'](?:\.\/)?(assets\/[^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(md))) paths.push(m[2])
  while ((m = htmlRe.exec(md))) paths.push(m[1])
  return [...new Set(paths)]
}

export function markdownToHtml(md: string): string {
  // 空正文用单个 <br>，不要用 <p><br></p>（Chrome 会把光标落到第二行）
  if (!md.trim()) return '<br>'
  return marked.parse(md, { async: false }) as string
}

/** 将 markdown 中的 assets 图片替换为带 data-md-src 的 img（使用 dataUrl 映射） */
export function markdownToHtmlWithImages(
  md: string,
  dataUrlMap: Record<string, string>,
): string {
  let html = markdownToHtml(md)
  html = html.replace(
    /<img([^>]*?)src=["'](\.\/)?(assets\/[^"']+)["']([^>]*)>/gi,
    (_all, pre: string, _dot: string, rel: string, post: string) => {
      const dataUrl = dataUrlMap[rel] || ''
      const src = dataUrl || rel
      const widthMatch = `${pre}${post}`.match(/\bwidth=["']?(\d+)/i)
      const widthAttr = widthMatch
        ? ` width="${widthMatch[1]}" data-width="${widthMatch[1]}" style="width:${widthMatch[1]}px;height:auto"`
        : ''
      // 去掉原有 width，避免重复
      const cleanPre = pre.replace(/\swidth=["']?\d+["']?/gi, '')
      const cleanPost = post.replace(/\swidth=["']?\d+["']?/gi, '')
      return `<img${cleanPre}src="${src}" data-md-src="${rel}"${widthAttr}${cleanPost}>`
    },
  )
  return html
}

export function htmlToMarkdown(html: string): string {
  const cleaned = html
    .replace(/<div><br><\/div>/gi, '<p><br></p>')
    .replace(/&nbsp;/g, ' ')
  return turndown.turndown(cleaned).trim()
}

export function plainTextFromHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

export function buildImageHtml(relativePath: string, dataUrl: string, alt = '截图'): string {
  return `<p><img src="${dataUrl}" data-md-src="${relativePath}" alt="${alt}" style="max-width:100%;height:auto" /></p>`
}

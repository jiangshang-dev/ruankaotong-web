export type DiffOp = {
  type: 'eq' | 'add' | 'del'
  text: string
}

const TOKEN_RE = /[\u4e00-\u9fff]|[A-Za-z0-9]+|\s+|[^\s\u4e00-\u9fffA-Za-z0-9]/g

export function tokenize(text: string): string[] {
  return String(text || '').match(TOKEN_RE) || []
}

export function diffText(oldText: string, newText: string): DiffOp[] {
  const a = tokenize(oldText)
  const b = tokenize(newText)
  if (!a.length && !b.length) return []
  if (a.length * b.length > 450_000) {
    return diffByChunks(oldText, newText)
  }
  return mergeOps(lcsDiff(a, b))
}

export function hasDiff(oldText: string, newText: string): boolean {
  return String(oldText || '') !== String(newText || '')
}

export function diffToHtml(ops: DiffOp[]): string {
  return ops
    .map((op) => {
      const text = escapeHtml(op.text)
      if (op.type === 'del') return `<del class="diff-del">${text}</del>`
      if (op.type === 'add') return `<ins class="diff-ins">${text}</ins>`
      return `<span class="diff-eq">${text}</span>`
    })
    .join('')
}

function diffByChunks(oldText: string, newText: string): DiffOp[] {
  const a = String(oldText || '').split(/(?<=\n)/)
  const b = String(newText || '').split(/(?<=\n)/)
  return mergeOps(lcsDiff(a, b))
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (next[j + 1] + 1) : Math.max(next[j], row[j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      ops.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j] })
    j += 1
  }
  return ops
}

function mergeOps(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = []
  for (const op of ops) {
    const last = out[out.length - 1]
    if (last && last.type === op.type) {
      last.text += op.text
    } else {
      out.push({ type: op.type, text: op.text })
    }
  }
  return out
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

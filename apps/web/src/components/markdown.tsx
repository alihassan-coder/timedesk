import { isValidElement, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * Renders the assistant's markdown: headings, lists, bold, code, tables, links.
 * Raw HTML in the text is never rendered (it shows as text), and unsafe link types such as
 * javascript: are dropped by the library.
 */

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const code = textOf(children).replace(/\n$/, '')
  const language = isValidElement<{ className?: string }>(children) ? /language-(\w+)/.exec(children.props.className ?? '')?.[1] : undefined
  return (
    <div className="bg-muted/60 my-3 overflow-hidden rounded-lg border">
      <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-1 text-xs">
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          className="hover:text-foreground flex items-center gap-1"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-lg font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="marker:text-muted-foreground my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start ?? undefined} className="marker:text-muted-foreground my-2 list-decimal space-y-1 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed [&>p]:my-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  hr: () => <hr className="my-4" />,
  blockquote: ({ children }) => <blockquote className="text-muted-foreground my-3 border-l-2 pl-3">{children}</blockquote>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => <code className={cn('bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]', className)}>{children}</code>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="border-b px-3 py-1.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-3 py-1.5 last:border-b-0">
      {children}
    </td>
  ),
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('min-w-0 break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

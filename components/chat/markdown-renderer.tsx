"use client"

/**
 * MarkdownRenderer — renders gbrain `think` output (markdown with citations).
 *
 * Citations from gbrain look like `[Source: companies/beanstalk-roasters]`.
 * These are plain-text brackets, NOT markdown links, so ReactMarkdown passes
 * them through unchanged as inline text. No custom remark plugin needed in
 * Phase 2 (CHAT-07 linkification is deferred to Phase 3 stretch).
 *
 * XSS note: `skipHtml={true}` prevents raw <script> or other HTML tags in
 * gbrain output from being injected into the DOM. This is the XSS guard.
 */

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

export interface MarkdownRendererProps {
  markdown: string
}

const components: Components = {
  // Inline code: subtle gray pill
  code({ children, className, ...props }) {
    const isBlock = Boolean(className)
    if (isBlock) {
      // Handled by <pre> wrapper below
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="bg-neutral-100 px-1 py-0.5 rounded text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  // Code blocks: dark terminal style
  pre({ children, ...props }) {
    return (
      <pre
        className="bg-neutral-900 text-white p-3 rounded overflow-x-auto text-sm my-2"
        {...props}
      >
        {children}
      </pre>
    )
  },
  // Links: blue underline
  a({ children, href, ...props }) {
    return (
      <a
        href={href}
        className="text-blue-600 underline hover:text-blue-800"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    )
  },
  // Paragraphs: standard spacing
  p({ children, ...props }) {
    return (
      <p className="mb-2 last:mb-0 leading-relaxed" {...props}>
        {children}
      </p>
    )
  },
  // Unordered lists
  ul({ children, ...props }) {
    return (
      <ul className="list-disc list-inside mb-2 space-y-1" {...props}>
        {children}
      </ul>
    )
  },
  // Ordered lists
  ol({ children, ...props }) {
    return (
      <ol className="list-decimal list-inside mb-2 space-y-1" {...props}>
        {children}
      </ol>
    )
  },
  // Headings
  h1({ children, ...props }) {
    return (
      <h1 className="text-xl font-bold mb-2 mt-3 first:mt-0" {...props}>
        {children}
      </h1>
    )
  },
  h2({ children, ...props }) {
    return (
      <h2 className="text-lg font-semibold mb-2 mt-3 first:mt-0" {...props}>
        {children}
      </h2>
    )
  },
  h3({ children, ...props }) {
    return (
      <h3 className="text-base font-semibold mb-1 mt-2 first:mt-0" {...props}>
        {children}
      </h3>
    )
  },
  // Strong / bold
  strong({ children, ...props }) {
    return (
      <strong className="font-semibold" {...props}>
        {children}
      </strong>
    )
  },
  // Blockquote
  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="border-l-4 border-neutral-300 pl-3 italic text-neutral-600 my-2"
        {...props}
      >
        {children}
      </blockquote>
    )
  },
}

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  return (
    <div className="text-sm text-neutral-800 max-w-none">
      {/* skipHtml={true}: XSS guard — prevents raw <script>/HTML tags in gbrain output from executing */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={true}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

/**
 * v0.4 A11 — footer Export menu.
 *
 * Three formats that work today without pandoc-wasm: HTML (live editor HTML
 * wrapped in a minimal document), Markdown (walks the PortableDoc AST and
 * emits CommonMark), and Print / PDF (delegates to `window.print()`).
 *
 * DOCX and EPUB land in the next Goal's build phase via the pandoc-wasm
 * worker — explicitly out of scope here. Bound decision: portable-doc plan
 * "export-menu-v1" (HTML/Markdown/Print today; pandoc later).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Block, InlineNode, PortableDoc } from '@portable-doc/core';
import type { Editor as TipTapEditor } from '@tiptap/react';

interface Props {
  doc: PortableDoc;
  editor: TipTapEditor | null;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  // Blob + temporary <a download> is the portable browser path for
  // client-side file downloads — no server, no FileSystem API gating.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderInline(nodes: InlineNode[] | undefined): string {
  if (!nodes) return '';
  const parts: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        parts.push(n.value);
        break;
      case 'strong':
        parts.push(`**${renderInline(n.children)}**`);
        break;
      case 'em':
        parts.push(`*${renderInline(n.children)}*`);
        break;
      case 'code':
        parts.push('`' + n.value + '`');
        break;
      case 'link':
        parts.push(`[${renderInline(n.children)}](${n.href})`);
        break;
    }
  }
  return parts.join('');
}

function renderBlock(b: Block, indent = 0): string {
  switch (b.type) {
    case 'heading': {
      const hashes = '#'.repeat(Math.min(6, Math.max(1, b.level)));
      return `${hashes} ${b.text ?? ''}`;
    }
    case 'paragraph':
      return renderInline(b.content);
    case 'list': {
      const pad = '  '.repeat(indent);
      return b.items
        .map((item, i) => {
          const marker = b.ordered ? `${i + 1}. ` : '- ';
          return `${pad}${marker}${renderInline(item)}`;
        })
        .join('\n');
    }
    case 'callout': {
      const title = b.title ? `**${b.title}**\n` : '';
      const body = renderInline(b.content);
      const text = (title + body).trim();
      return text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    }
    case 'code':
      return '```' + (b.lang ?? '') + '\n' + (b.value ?? '') + '\n```';
    case 'image':
      return `![${b.alt ?? ''}](${b.src})`;
    case 'divider':
      return '---';
    case 'action':
      return `[${b.label}](${b.href})`;
    case 'table': {
      if (!b.rows || b.rows.length === 0) return '';
      const widths = b.rows[0]?.length ?? 0;
      if (widths === 0) return '';
      const rows = b.rows.map(
        (row) => '| ' + row.map((cell) => renderInline(cell)).join(' | ') + ' |',
      );
      const sep = '| ' + Array.from({ length: widths }, () => '---').join(' | ') + ' |';
      return [rows[0], sep, ...rows.slice(1)].join('\n');
    }
    case 'section': {
      const title = b.title ? `## ${b.title}\n\n` : '';
      const inner = b.blocks.map((c) => renderBlock(c, indent)).join('\n\n');
      return title + inner;
    }
    default:
      return '';
  }
}

export function serializeMarkdown(doc: PortableDoc): string {
  const head = doc.title ? `# ${doc.title}\n\n` : '';
  const body = doc.blocks
    .map((b) => renderBlock(b))
    .filter((s) => s.length > 0)
    .join('\n\n');
  return head + body + '\n';
}

function buildHtmlDocument(title: string, bodyHtml: string): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export function ExportMenu({ doc, editor }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const title = useMemo(() => doc.title ?? 'untitled', [doc.title]);
  const filenameBase = useMemo(() => slug(title), [title]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // Outside-click dismissal: track mousedown on the document and close
    // when the target is neither the trigger nor inside the popover.
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current && rootRef.current.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onExportHtml = useCallback(() => {
    const inner = editor ? editor.getHTML() : '';
    const html = buildHtmlDocument(title, inner);
    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob(blob, `${filenameBase}.html`);
    close();
  }, [editor, title, filenameBase, close]);

  const onExportMarkdown = useCallback(() => {
    const md = serializeMarkdown(doc);
    const blob = new Blob([md], { type: 'text/markdown' });
    downloadBlob(blob, `${filenameBase}.md`);
    close();
  }, [doc, filenameBase, close]);

  const onPrint = useCallback(() => {
    window.print();
    close();
  }, [close]);

  return (
    <div
      ref={rootRef}
      className="paper-export-menu"
      data-testid="footer-export"
    >
      <button
        ref={triggerRef}
        type="button"
        className="paper-footer-status__chip paper-footer-status__chip--button paper-export-menu__trigger"
        data-testid="footer-export-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⤓</span>
        <span>Export</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="paper-export-menu__popover"
          role="menu"
          data-testid="footer-export-popover"
          aria-label="Export format"
        >
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-html"
            onClick={onExportHtml}
          >
            HTML
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-markdown"
            onClick={onExportMarkdown}
          >
            Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-print"
            onClick={onPrint}
          >
            Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

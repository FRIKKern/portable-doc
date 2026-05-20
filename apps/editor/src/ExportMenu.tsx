/**
 * v0.4 A11 — footer Export menu.
 *
 * Four formats: Word (.docx) via pure-JS `docx` (dolanmiu) — opens natively
 * in Word, Pages, Google Docs; HTML (live editor HTML wrapped in a minimal
 * document); Markdown (walks the PortableDoc AST and emits CommonMark);
 * Print / PDF (delegates to `window.print()`).
 *
 * Bound decision (2026-05-18-multi-format-export-contract): pandoc-wasm was
 * named as the v1 DOCX mechanism. Pure-JS docx is the pragmatic stand-in —
 * same output (a .docx file), no wasm bootstrap. The spec stays valid as a
 * future-state swap; the menu UI does not change.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type { Block, InlineNode, PortableDoc } from '@portable-doc/core';
import { buildEnvelope, generateDocUuid } from '@portable-doc/core';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { toDocxBlob } from './export/toDocx.js';
import { toEpubBlob } from './export/toEpub.js';
import { toHtmlBlob } from './export/toHtml.js';
import { toPdfBlob } from './export/toPdf.js';
import { extractFromDocx } from './import/fromDocx.js';

interface Props {
  doc: PortableDoc;
  editor: TipTapEditor | null;
  /** Round-trip import path. When a .docx carrying a Papir envelope is
   *  selected, we forward the restored AST upward so the host can replace
   *  the editor content. The prop is optional so existing call sites
   *  (and tests) keep working without the import wiring. */
  onImport?: (ast: unknown) => void;
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

/**
 * Gzip + base64-encode an envelope payload into the single-line HTML comment
 * the .md round-trip path expects. Browser-native CompressionStream keeps the
 * comment short enough for typical markdown renderers to scroll right past.
 * Mirrors the embed-locations spec (P2 of embedded-roundtrip-ast).
 */
export async function encodeEnvelopeComment(doc: PortableDoc): Promise<string> {
  const envelope = buildEnvelope(doc, generateDocUuid());
  const gzipped = await new Response(
    new Blob([JSON.stringify(envelope)])
      .stream()
      .pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const bytes = new Uint8Array(gzipped);
  // Chunk through fromCharCode to dodge the per-call argument-count cap on
  // very large payloads. 0x8000 is the common-wisdom safe chunk size.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return `<!-- portable-doc-ast (gzip+base64): ${b64} -->`;
}

/**
 * Insert the envelope comment between the first `# Title` line and the body —
 * or at the very top when there is no title heading. Idempotent for our own
 * output: we only ever inject one comment, and downstream the extractor finds
 * the first match.
 */
export function injectEnvelopeIntoMarkdown(md: string, comment: string): string {
  if (md.startsWith('# ')) {
    const nl = md.indexOf('\n');
    if (nl === -1) {
      // Title-only doc — drop the comment after the title with the standard
      // blank-line cushion the body would normally have.
      return `${md}\n\n${comment}\n`;
    }
    // Standard shape from serializeMarkdown is `# Title\n\n<body>` — we slot
    // the comment + blank line into that gap.
    const head = md.slice(0, nl + 1);
    const rest = md.slice(nl + 1);
    return `${head}\n${comment}\n\n${rest.replace(/^\n+/, '')}`;
  }
  return `${comment}\n\n${md}`;
}

export function ExportMenu({ doc, editor, onImport }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Hidden file input — the menuitem clicks it; the browser opens the OS
  // file picker; the change handler reads the bytes. Same pattern as a
  // typical "upload" button without a visible <input> in the DOM tree.
  const importInputRef = useRef<HTMLInputElement | null>(null);

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

  const onExportDocx = useCallback(async () => {
    const blob = await toDocxBlob(doc);
    downloadBlob(blob, `${filenameBase}.docx`);
    close();
  }, [doc, filenameBase, close]);

  const onExportEpub = useCallback(async () => {
    const blob = await toEpubBlob(doc);
    downloadBlob(blob, `${filenameBase}.epub`);
    close();
  }, [doc, filenameBase, close]);

  const onExportPdf = useCallback(async () => {
    const blob = await toPdfBlob(doc);
    downloadBlob(blob, `${filenameBase}.pdf`);
    close();
  }, [doc, filenameBase, close]);

  const onExportHtml = useCallback(async () => {
    // toHtmlBlob walks the AST and embeds the round-trip envelope in
    // <head> as <script type="application/portable-doc+json">. The old
    // path used editor.getHTML() which dropped the envelope — re-imports
    // had no way to recover the original AST. The filename + MIME stay
    // identical; this is a pure upgrade of the payload.
    const blob = await toHtmlBlob(doc);
    downloadBlob(blob, `${filenameBase}.html`);
    close();
  }, [doc, filenameBase, close]);

  const onExportMarkdown = useCallback(async () => {
    const md = serializeMarkdown(doc);
    // Embed the envelope sidecar so a re-import reconstructs the AST
    // losslessly — same contract as the .docx path, lighter mechanism.
    const comment = await encodeEnvelopeComment(doc);
    const withEnvelope = injectEnvelopeIntoMarkdown(md, comment);
    const blob = new Blob([withEnvelope], { type: 'text/markdown' });
    downloadBlob(blob, `${filenameBase}.md`);
    close();
  }, [doc, filenameBase, close]);

  const onPrint = useCallback(() => {
    window.print();
    close();
  }, [close]);

  const onImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const onImportFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset value so picking the same file twice still fires change.
      e.target.value = '';
      if (!file) return;
      const buf = await file.arrayBuffer();
      const envelope = await extractFromDocx(buf);
      if (!envelope) {
        // Pre-feature .docx or a foreign .docx — "import as new" lands in
        // a later task; for now we just surface a calm one-liner.
        alert(
          'No Papir envelope found in this .docx. Importing as new is not implemented yet.',
        );
        close();
        return;
      }
      onImport?.(envelope.ast);
      close();
    },
    [onImport, close],
  );

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
            data-testid="footer-export-docx"
            onClick={() => {
              void onExportDocx();
            }}
          >
            Word (.docx)
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-epub"
            onClick={() => {
              void onExportEpub();
            }}
          >
            EPUB (.epub)
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-pdf"
            onClick={() => {
              void onExportPdf();
            }}
          >
            PDF (.pdf)
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-html"
            onClick={() => {
              void onExportHtml();
            }}
          >
            HTML
          </button>
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-export-markdown"
            onClick={() => {
              void onExportMarkdown();
            }}
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
          <div
            role="separator"
            className="paper-export-menu__separator"
            aria-hidden="true"
          />
          <button
            type="button"
            role="menuitem"
            className="paper-export-menu__item"
            data-testid="footer-import-docx"
            onClick={onImportClick}
          >
            Import from .docx
          </button>
        </div>
      )}
      {/* Hidden file picker for the "Import from .docx" menuitem. Lives
       *  outside the popover so click → file-dialog still works after the
       *  popover dismisses on outside-click. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        data-testid="footer-import-docx-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onImportFileChange(e);
        }}
      />
    </div>
  );
}

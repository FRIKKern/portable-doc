import { useMemo } from 'react';
import { validateDoc, type PortableDoc } from '@portable-doc/core';

/**
 * Public-playground placeholder.
 *
 * Imports `validateDoc` directly from `@portable-doc/core` to prove the
 * kernel-direct path works in-browser. v0.3 will replace this with the
 * full cross-surface preview UI; the kernel-direct boundary stays.
 */

const TEASER_DOC: PortableDoc = {
  version: 1,
  title: 'PortableDoc Playground',
  preview: 'Coming soon',
  blocks: [
    { id: 'h', type: 'heading', level: 1, text: 'PortableDoc Playground' },
    {
      id: 'p',
      type: 'paragraph',
      content: [{ type: 'text', value: 'Try it' }],
    },
  ],
};

export default function App() {
  const issues = useMemo(() => validateDoc(TEASER_DOC), []);
  const valid = issues.length === 0;
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '4rem auto',
        padding: '0 1.5rem',
      }}
    >
      <p
        style={{
          fontSize: '.78rem',
          textTransform: 'uppercase',
          letterSpacing: '.14em',
          color: '#3b5b8c',
          fontWeight: 600,
        }}
      >
        Public playground · paperflow
      </p>
      <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.022em', margin: '0 0 1rem' }}>
        PortableDoc Playground — coming soon
      </h1>
      <p style={{ fontSize: '1.15rem', color: '#444', lineHeight: 1.6 }}>
        Paste a PortableDoc JSON, see it render across Web, Native, Email, TUI, and plain
        text — live, in-browser. Cross-surface preview, validation diagnostics, copy any
        rendered output.
      </p>
      <p style={{ marginTop: '2rem', color: '#666' }}>
        Validator self-check on the teaser doc:{' '}
        <strong>{valid ? 'valid' : `${issues.length} issue(s)`}</strong>.
      </p>
      <p style={{ marginTop: '3rem', color: '#888' }}>
        See the{' '}
        <a href="https://github.com/FRIKKern/portable-doc">repo</a> for v0.2.1
        (foundation) and the v0.3 work in flight.
      </p>
    </main>
  );
}

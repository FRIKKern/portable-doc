/**
 * CopyButton — fires `navigator.clipboard.writeText(getValue())` on click and
 * flips its label to "Copied!" for 1.5 s. `getValue` is invoked at click time
 * (not on render) so async surface output stays current.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export function CopyButton({
  getValue,
  label = 'Copy',
  testId,
}: {
  getValue: () => string | Promise<string>;
  label?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onClick() {
    const value = await getValue();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId ?? 'copy-button'}
      style={btnStyle}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

const btnStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  padding: '0.3rem 0.7rem',
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#1f2937',
  borderRadius: 6,
  cursor: 'pointer',
};

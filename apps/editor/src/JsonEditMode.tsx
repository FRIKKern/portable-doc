/**
 * Hidden JSON-edit-mode overlay (A7) — power-user escape hatch behind the
 * Cmd+Shift+J / Ctrl+Shift+J shortcut. Renders the doc as pretty-printed
 * JSON in a textarea; validates on every keystroke (debounced 300ms) via
 * `validateDoc`; saves on Cmd/Ctrl+S or the Save button when valid.
 *
 * Per build-phase grill q9: keep this around in v0.3 while A1's TipTap
 * dogfoods, easy to delete in v0.4 once tile-based UI has miles.
 */
import { useState, useEffect, useRef } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';

interface JsonEditModeProps {
  doc: PortableDoc;
  open: boolean;
  onClose: () => void;
  onSave: (next: PortableDoc) => void;
}

type ValidationState =
  | { kind: 'ok' }
  | { kind: 'parse-error'; message: string }
  | { kind: 'issues'; issues: ReturnType<typeof validateDoc> };

export function JsonEditMode({ doc, open, onClose, onSave }: JsonEditModeProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(doc, null, 2));
  const initialDraftRef = useRef(draft);

  // Re-seed draft when the overlay opens so a fresh doc shows the latest tile-edit state.
  useEffect(() => {
    if (open) {
      const fresh = JSON.stringify(doc, null, 2);
      setDraft(fresh);
      initialDraftRef.current = fresh;
    }
  }, [doc, open]);

  // Validate on every keystroke (debounced 300ms).
  const [validation, setValidation] = useState<ValidationState>({ kind: 'ok' });
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const parsed = JSON.parse(draft);
        const issues = validateDoc(parsed);
        setValidation(issues.length === 0 ? { kind: 'ok' } : { kind: 'issues', issues });
      } catch (e) {
        setValidation({ kind: 'parse-error', message: e instanceof Error ? e.message : String(e) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  // Synchronous validation for Cmd+S so the keypress doesn't race the debounced effect.
  function validateNow(): ValidationState {
    try {
      const parsed = JSON.parse(draft);
      const issues = validateDoc(parsed);
      return issues.length === 0 ? { kind: 'ok' } : { kind: 'issues', issues };
    } catch (e) {
      return { kind: 'parse-error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  function trySave() {
    const v = validateNow();
    setValidation(v);
    if (v.kind !== 'ok') return;
    try {
      onSave(JSON.parse(draft));
    } catch {
      // parse already validated above; swallow defensively
    }
  }

  // Cmd/Ctrl+S to save, Esc to close (with unsaved-edits confirmation).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        trySave();
        return;
      }
      if (e.key === 'Escape') {
        const dirty = draft !== initialDraftRef.current;
        if (!dirty || confirm('Discard unsaved JSON edits?')) onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, onSave, onClose]);

  if (!open) return null;

  const canSave = validation.kind === 'ok';
  return (
    <div
      role="dialog"
      aria-label="JSON edit mode"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
      }}
    >
      <div style={{ background: '#fff', flex: 1, padding: 16, fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 8 }}>
          <strong>JSON edit mode</strong>
          <span style={{ marginLeft: 12, fontSize: '.85rem', color: '#666' }}>
            Cmd+S to save · Esc to close
          </span>
          <button type="button" onClick={onClose} style={{ float: 'right', marginLeft: 8 }}>
            Close
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={trySave}
            style={{ float: 'right' }}
          >
            Save
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: '100%', flex: 1, fontFamily: 'monospace', fontSize: '.9rem' }}
          aria-label="JSON document"
          autoFocus
        />
        <div style={{ marginTop: 8, minHeight: '2em' }}>
          {validation.kind === 'parse-error' && (
            <span style={{ color: '#b91c1c' }}>Parse error: {validation.message}</span>
          )}
          {validation.kind === 'issues' && (
            <span style={{ color: '#b91c1c' }}>
              {validation.issues.length} validation issue(s) — fix before saving.{' '}
              {validation.issues.slice(0, 3).map((i) => i.message).join('; ')}
            </span>
          )}
          {validation.kind === 'ok' && <span style={{ color: '#047857' }}>✓ valid</span>}
        </div>
      </div>
    </div>
  );
}

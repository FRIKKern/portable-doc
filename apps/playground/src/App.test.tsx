// @vitest-environment jsdom
/**
 * Playground B1 specs — JSON paste box + live validateDoc + fixture loaders.
 *
 * Coverage:
 *   1. Default content is the welcome fixture, pretty-printed; validates clean.
 *   2. Clicking "Incident" replaces the textarea content with the incident
 *      fixture.
 *   3. Typing invalid JSON surfaces a parse error (after the 300ms debounce).
 *   4. Typing a block with an unknown variant (tone:'rainbow') surfaces a
 *      validation issue tagged with the offending rule name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App.js';

afterEach(() => {
  cleanup();
});

const DEBOUNCE_MS = 300;

function getTextarea(): HTMLTextAreaElement {
  return screen.getByTestId('json-input') as HTMLTextAreaElement;
}

function flushDebounce() {
  // Component debounces validation by 300ms via setTimeout. In jsdom the
  // setTimeout is real, so we advance wall-clock via a small await. Using
  // act() so any state updates triggered by the timer are flushed before we
  // make assertions.
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      resolve();
    }, DEBOUNCE_MS + 50),
  );
}

describe('Playground App', () => {
  it('default loads the welcome fixture and reports 0 validation issues', async () => {
    render(<App />);
    const ta = getTextarea();
    expect(ta.value).toMatch(/Welcome to Atlas/);
    // Initial render seeds validation synchronously from the welcome fixture,
    // so the "valid" badge is already on screen — no debounce wait needed.
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
    // After the debounce nothing should change (welcome is still valid).
    await act(async () => {
      await flushDebounce();
    });
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
  });

  it('clicking "Incident" replaces the textarea content with the incident fixture', async () => {
    render(<App />);
    const ta = getTextarea();
    expect(ta.value).toMatch(/Welcome to Atlas/);
    fireEvent.click(screen.getByTestId('fixture-incident'));
    expect(ta.value).toMatch(/Database failover detected/);
    expect(ta.value).not.toMatch(/Welcome to Atlas/);
    // Incident fixture is also a valid document.
    await act(async () => {
      await flushDebounce();
    });
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
  });

  it('typing invalid JSON shows a parse error after the debounce window', async () => {
    render(<App />);
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '{not json' } });
    await act(async () => {
      await flushDebounce();
    });
    const panel = screen.getByTestId('validation-parse-error');
    expect(panel.textContent ?? '').toMatch(/Parse error/);
  });

  it('typing an invalid block (tone:"rainbow") shows a validation issue tagged with the rule name', async () => {
    render(<App />);
    const ta = getTextarea();
    const bogus = {
      version: 1,
      title: 'Bad',
      blocks: [
        {
          id: 'cb',
          type: 'callout',
          tone: 'rainbow',
          content: [{ type: 'text', value: 'hi' }],
        },
      ],
    };
    fireEvent.change(ta, { target: { value: JSON.stringify(bogus, null, 2) } });
    await act(async () => {
      await flushDebounce();
    });
    const issues = screen.getByTestId('validation-issues');
    const items = screen.getAllByTestId('validation-issue');
    expect(items.length).toBeGreaterThan(0);
    // tone:"rainbow" violates the 16-safe palette → content-constraint rule.
    const toneIssue = items.find((li) =>
      (li.textContent ?? '').includes('content-constraint'),
    );
    expect(toneIssue).toBeTruthy();
    expect(toneIssue!.textContent ?? '').toMatch(/rainbow|tone/);
    expect(issues.textContent ?? '').toMatch(/validation issue/);
  });
});

/**
 * ANSI-to-HTML parser unit tests. These double as documentation of what
 * `renderInk` emits from backend-ink.
 */
import { describe, expect, it } from 'vitest';
import { ansiToHtml } from './ansi-to-html.js';

describe('ansiToHtml — truecolor', () => {
  it('emits rgb() for \\x1b[38;2;R;G;Bm fg', () => {
    expect(ansiToHtml('\x1b[38;2;185;28;28mHi\x1b[0m')).toBe(
      '<span style="color: rgb(185, 28, 28)">Hi</span>',
    );
  });

  it('emits rgb() for \\x1b[48;2;R;G;Bm bg', () => {
    expect(ansiToHtml('\x1b[48;2;10;20;30mX\x1b[0m')).toBe(
      '<span style="background-color: rgb(10, 20, 30)">X</span>',
    );
  });
});

describe('ansiToHtml — 256-color', () => {
  it('maps 256-color index 9 to bright red hex', () => {
    // index 9 falls into the 0–15 base block → ANSI 91 = #ff5555
    expect(ansiToHtml('\x1b[38;5;9mHi\x1b[0m')).toBe(
      '<span style="color: #ff5555">Hi</span>',
    );
  });

  it('maps 256-color cube index 196 to red', () => {
    // 196 = 16 + 36*5 + 6*0 + 0 → (255,0,0)
    expect(ansiToHtml('\x1b[38;5;196mHi\x1b[0m')).toBe(
      '<span style="color: #ff0000">Hi</span>',
    );
  });

  it('maps 256-color grayscale ramp', () => {
    // 240 = 232+8 → v = 8 + 8*10 = 88 → 0x58
    expect(ansiToHtml('\x1b[38;5;240mg\x1b[0m')).toBe(
      '<span style="color: #585858">g</span>',
    );
  });
});

describe('ansiToHtml — 16-color', () => {
  it('maps fg 31 to red', () => {
    expect(ansiToHtml('\x1b[31mHi\x1b[0m')).toBe(
      '<span style="color: #cc0000">Hi</span>',
    );
  });

  it('maps bright fg 91 to bright red', () => {
    expect(ansiToHtml('\x1b[91mHi\x1b[0m')).toBe(
      '<span style="color: #ff5555">Hi</span>',
    );
  });

  it('maps bg 44 to blue', () => {
    expect(ansiToHtml('\x1b[44mHi\x1b[0m')).toBe(
      '<span style="background-color: #0000cc">Hi</span>',
    );
  });
});

describe('ansiToHtml — text styles', () => {
  it('emits font-weight: bold for \\x1b[1m', () => {
    expect(ansiToHtml('\x1b[1mHi\x1b[0m')).toBe(
      '<span style="font-weight: bold">Hi</span>',
    );
  });

  it('emits font-style: italic for \\x1b[3m', () => {
    expect(ansiToHtml('\x1b[3mHi\x1b[0m')).toBe(
      '<span style="font-style: italic">Hi</span>',
    );
  });

  it('emits text-decoration: underline for \\x1b[4m', () => {
    expect(ansiToHtml('\x1b[4mHi\x1b[0m')).toBe(
      '<span style="text-decoration: underline">Hi</span>',
    );
  });

  it('combines fg + bold in one span', () => {
    expect(ansiToHtml('\x1b[1;38;2;255;0;0mHi\x1b[0m')).toBe(
      '<span style="color: rgb(255, 0, 0); font-weight: bold">Hi</span>',
    );
  });
});

describe('ansiToHtml — escaping & safety', () => {
  it('HTML-escapes < and > and &', () => {
    expect(ansiToHtml('a<b>&"c')).toBe('a&lt;b&gt;&amp;&quot;c');
  });

  it('strips unknown CSI sequences (cursor movement) without leaving markup', () => {
    expect(ansiToHtml('A\x1b[2KB\x1b[5;10HC')).toBe('ABC');
  });

  it('strips OSC-8 hyperlink frames', () => {
    expect(ansiToHtml('\x1b]8;;https://x.io\x07Hi\x1b]8;;\x07')).toBe('Hi');
  });

  it('handles empty input and pass-through text', () => {
    expect(ansiToHtml('')).toBe('');
    expect(ansiToHtml('plain')).toBe('plain');
  });

  it('reset (0) closes the span', () => {
    expect(ansiToHtml('\x1b[31mR\x1b[0mP')).toBe(
      '<span style="color: #cc0000">R</span>P',
    );
  });
});

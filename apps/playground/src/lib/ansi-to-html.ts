/**
 * Hand-rolled ANSI-to-HTML translator — paperflow-owned, no deps.
 *
 * Per grill q6: NO `ansi_up`, NO third-party ANSI parser. This is the *only*
 * piece of code in the playground that interprets escape sequences, so it
 * doubles as documentation of what `renderInk` emits: truecolor SGR
 * (`\x1b[38;2;R;G;Bm`), 256-color (`\x1b[38;5;Nm`), 16-color (30–37/90–97 fg,
 * 40–47/100–107 bg), bold/italic/underline (1/3/4 set, 22/23/24 reset),
 * 0 reset, 39/49 default fg/bg. OSC-8 hyperlinks and unknown CSI sequences
 * are stripped safely. Text content is HTML-escaped.
 */

const ANSI_16: Record<number, string> = {
  30: '#000000', 31: '#cc0000', 32: '#00cc00', 33: '#cccc00',
  34: '#0000cc', 35: '#cc00cc', 36: '#00cccc', 37: '#cccccc',
  90: '#555555', 91: '#ff5555', 92: '#55ff55', 93: '#ffff55',
  94: '#5555ff', 95: '#ff55ff', 96: '#55ffff', 97: '#ffffff',
};

interface State {
  fg: string | null; bg: string | null;
  bold: boolean; italic: boolean; underline: boolean;
}

const RESET: State = { fg: null, bg: null, bold: false, italic: false, underline: false };

function esc(c: string): string {
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
    : c === '"' ? '&quot;' : c === "'" ? '&#39;' : c;
}

function styleAttr(s: State): string {
  const p: string[] = [];
  if (s.fg) p.push(`color: ${s.fg}`);
  if (s.bg) p.push(`background-color: ${s.bg}`);
  if (s.bold) p.push('font-weight: bold');
  if (s.italic) p.push('font-style: italic');
  if (s.underline) p.push('text-decoration: underline');
  return p.join('; ');
}

function color256(n: number): string {
  if (n < 16) return ANSI_16[n < 8 ? 30 + n : 90 + (n - 8)] ?? '#000000';
  if (n >= 232) {
    const v = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }
  const i = n - 16;
  const cube = [0, 95, 135, 175, 215, 255];
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(cube[Math.floor(i / 36)] ?? 0)}${h(cube[Math.floor((i % 36) / 6)] ?? 0)}${h(cube[i % 6] ?? 0)}`;
}

function applySgr(state: State, params: number[]): State {
  let s = state;
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) s = { ...RESET };
    else if (p === 1) s = { ...s, bold: true };
    else if (p === 22) s = { ...s, bold: false };
    else if (p === 3) s = { ...s, italic: true };
    else if (p === 23) s = { ...s, italic: false };
    else if (p === 4) s = { ...s, underline: true };
    else if (p === 24) s = { ...s, underline: false };
    else if (p === 39) s = { ...s, fg: null };
    else if (p === 49) s = { ...s, bg: null };
    else if ((p === 38 || p === 48) && params[i + 1] === 2) {
      const col = `rgb(${params[i + 2] ?? 0}, ${params[i + 3] ?? 0}, ${params[i + 4] ?? 0})`;
      s = p === 38 ? { ...s, fg: col } : { ...s, bg: col };
      i += 4;
    } else if ((p === 38 || p === 48) && params[i + 1] === 5) {
      const col = color256(params[i + 2] ?? 0);
      s = p === 38 ? { ...s, fg: col } : { ...s, bg: col };
      i += 2;
    } else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) s = { ...s, fg: ANSI_16[p] ?? null };
    else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) s = { ...s, bg: ANSI_16[p - 10] ?? null };
  }
  return s;
}

export function ansiToHtml(input: string): string {
  let out = '', open = false;
  let state: State = { ...RESET };
  const apply = (next: State) => {
    if (open) { out += '</span>'; open = false; }
    const style = styleAttr(next);
    if (style) { out += `<span style="${style}">`; open = true; }
    state = next;
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '\x1b' && input[i + 1] === '[') {
      let j = i + 2;
      while (j < input.length && !(input[j]! >= '@' && input[j]! <= '~')) j++;
      if (input[j] === 'm') {
        const raw = input.slice(i + 2, j);
        apply(applySgr(state, raw === '' ? [0] : raw.split(';').map((p) => Number(p) || 0)));
      }
      i = j + 1;
    } else if (c === '\x1b' && input[i + 1] === ']') {
      // OSC — including OSC-8 hyperlinks. Strip, no markup. Terminated by BEL or ST.
      let j = i + 2;
      while (j < input.length && input[j] !== '\x07' && !(input[j] === '\x1b' && input[j + 1] === '\\')) j++;
      i = j + (input[j] === '\x07' ? 1 : 2);
    } else {
      out += esc(c);
      i++;
    }
  }
  if (open) out += '</span>';
  return out;
}

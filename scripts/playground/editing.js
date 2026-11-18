// Small editor helpers for the playground's plain <textarea>.

// Replace the selection, keeping the browser's undo history where it can.
function insert(area, text) {
  if (document.execCommand('insertText', false, text)) return;
  area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

// Tab: two spaces at the caret, or indent every selected line. Shift+Tab: outdent.
export function shiftLines(area, outdent) {
  const { selectionStart: start, selectionEnd: end, value } = area;
  if (!outdent && start === end) return insert(area, '  ');
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(from, end);
  const next = block.split('\n').map((line) => (outdent ? line.replace(/^ {1,2}/, '') : `  ${line}`)).join('\n');
  if (next === block) return;
  area.setSelectionRange(from, end);
  insert(area, next);
  if (start === end) area.setSelectionRange(from + next.length, from + next.length);
  else area.setSelectionRange(from, from + next.length);
}

// The Clipboard API where allowed, else the old copy command. True when copied.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

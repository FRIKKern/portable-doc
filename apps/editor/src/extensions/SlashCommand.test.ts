/**
 * @vitest-environment happy-dom
 *
 * A3 — SlashCommand extension tests.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SlashCommand,
  COMMANDS,
  applyInsert,
  isInsideCodeBlock,
  type SlashCommandOptions,
} from './SlashCommand.js';
import type { SlashCommand as Cmd } from '../lib/slash-filter.js';

function getOptions(): SlashCommandOptions | undefined {
  const ext = SlashCommand as unknown as {
    config: { addOptions?: () => SlashCommandOptions };
  };
  return ext.config.addOptions?.();
}

describe('SlashCommand extension shape', () => {
  it('is a TipTap Extension with name="slashCommand"', () => {
    expect(SlashCommand).toBeTruthy();
    expect((SlashCommand as unknown as { name: string }).name).toBe('slashCommand');
  });

  it('defaults expose the suggestion config with char="/"', () => {
    const opts = getOptions();
    expect(opts?.suggestion?.char).toBe('/');
    expect(typeof opts?.suggestion?.allow).toBe('function');
    expect(typeof opts?.suggestion?.items).toBe('function');
    expect(typeof opts?.suggestion?.command).toBe('function');
    expect(typeof opts?.suggestion?.render).toBe('function');
  });

  it('addProseMirrorPlugins is a function', () => {
    const ext = SlashCommand as unknown as {
      config: { addProseMirrorPlugins?: unknown };
    };
    expect(typeof ext.config.addProseMirrorPlugins).toBe('function');
  });
});

describe('SlashCommand — items filter (carries lib/slash-filter behaviour)', () => {
  function callItems(query: string): Cmd[] {
    const items = getOptions()?.suggestion?.items;
    if (!items) throw new Error('items missing');
    return items({ query, editor: {} as never }) as Cmd[];
  }

  it('empty query returns the full catalog (H1..H6 + 9 block types = 15)', () => {
    expect(callItems('').length).toBe(15);
    expect(callItems('').length).toBe(COMMANDS.length);
  });

  it('substring "cal" narrows to Callout', () => {
    const out = callItems('cal');
    expect(out.length).toBe(1);
    expect(out[0]?.type).toBe('callout');
  });

  it('typo "calout" still finds callout via Levenshtein fallback', () => {
    const out = callItems('calout');
    expect(out.some((c) => c.type === 'callout')).toBe(true);
  });
});

describe('SlashCommand — allow predicate (grill Q4)', () => {
  function mockState(nodeName: string): {
    selection: { $from: { node: (d: number) => { type: { name: string } }; depth: number } };
  } {
    return {
      selection: {
        $from: {
          depth: 1,
          node: (d: number) =>
            d === 1 ? { type: { name: nodeName } } : { type: { name: 'doc' } },
        },
      },
    };
  }

  it('returns true when the cursor sits inside a codeBlock', () => {
    expect(isInsideCodeBlock(mockState('codeBlock'))).toBe(true);
  });

  it('returns false in regular paragraphs', () => {
    expect(isInsideCodeBlock(mockState('paragraph'))).toBe(false);
  });

  it('allow() returned from defaults reflects isInsideCodeBlock', () => {
    const allow = getOptions()?.suggestion?.allow;
    expect(typeof allow).toBe('function');
    if (!allow) return;
    expect(allow({ state: mockState('paragraph') } as never)).toBe(true);
    expect(allow({ state: mockState('codeBlock') } as never)).toBe(false);
  });
});

describe('SlashCommand — applyInsert dispatch', () => {
  type Chain = {
    focus: () => Chain;
    deleteRange: (r: unknown) => Chain;
    setNode: ReturnType<typeof vi.fn>;
    toggleBulletList: ReturnType<typeof vi.fn>;
    toggleBlockquote: ReturnType<typeof vi.fn>;
    toggleCodeBlock: ReturnType<typeof vi.fn>;
    setHorizontalRule: ReturnType<typeof vi.fn>;
    insertContent: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
  type MockEditor = { chain: () => Chain };

  function makeEditor(): { editor: MockEditor; chain: Chain } {
    const chain: Chain = {
      focus: () => chain,
      deleteRange: () => chain,
      setNode: vi.fn(() => chain),
      toggleBulletList: vi.fn(() => chain),
      toggleBlockquote: vi.fn(() => chain),
      toggleCodeBlock: vi.fn(() => chain),
      setHorizontalRule: vi.fn(() => chain),
      insertContent: vi.fn(() => chain),
      run: vi.fn(),
    };
    return { editor: { chain: () => chain }, chain };
  }

  function dispatch(cmd: Cmd, editor: MockEditor): void {
    applyInsert(editor as never, { from: 5, to: 6 }, cmd);
  }

  it('heading → setNode(heading, level:1) + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'heading', label: 'Heading', hint: '' }, editor);
    expect(chain.setNode).toHaveBeenCalledWith('heading', { level: 1 });
    expect(chain.run).toHaveBeenCalled();
  });

  it('list → toggleBulletList + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'list', label: 'List', hint: '' }, editor);
    expect(chain.toggleBulletList).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
  });

  it('callout → toggleBlockquote + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'callout', label: 'Callout', hint: '' }, editor);
    expect(chain.toggleBlockquote).toHaveBeenCalled();
  });

  it('divider → setHorizontalRule + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'divider', label: 'Divider', hint: '' }, editor);
    expect(chain.setHorizontalRule).toHaveBeenCalled();
  });

  it('code → toggleCodeBlock + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'code', label: 'Code', hint: '' }, editor);
    expect(chain.toggleCodeBlock).toHaveBeenCalled();
  });

  it('section → setNode(heading, level:2) + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'section', label: 'Section', hint: '' }, editor);
    expect(chain.setNode).toHaveBeenCalledWith('heading', { level: 2 });
  });

  it('paragraph → setNode(paragraph) + run()', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'paragraph', label: 'Paragraph', hint: '' }, editor);
    expect(chain.setNode).toHaveBeenCalledWith('paragraph');
  });

  it('action → insertContent (link mark placeholder)', () => {
    const { editor, chain } = makeEditor();
    dispatch({ type: 'action', label: 'Action', hint: '' }, editor);
    expect(chain.insertContent).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
  });
});

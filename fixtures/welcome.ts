/**
 * Polished onboarding fixture for "Atlas".
 *
 * Covers: heading, paragraph, callout, list, action, section, divider.
 */

import type { PortableDoc } from '@portable-doc/core';

export const welcome: PortableDoc = {
  version: 1,
  title: 'Welcome to Atlas',
  preview: 'Your workspace is ready — invite your team and ship.',
  blocks: [
    {
      id: 'welcome-heading',
      type: 'heading',
      level: 1,
      text: 'Welcome to Atlas',
    },
    {
      id: 'welcome-intro',
      type: 'paragraph',
      content: [
        {
          type: 'text',
          value:
            'Your workspace is ready. Atlas keeps documents, decisions, and people in one place — across web, native, email, terminal, and plain text.',
        },
      ],
    },
    {
      id: 'welcome-setup-callout',
      type: 'callout',
      tone: 'success',
      title: 'Setup complete',
      content: [
        {
          type: 'text',
          value: 'Setup complete. You can now invite your team.',
        },
      ],
    },
    {
      id: 'welcome-next-steps',
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'text', value: 'Invite your team' }],
        [{ type: 'text', value: 'Create your first project' }],
        [{ type: 'text', value: 'Customize your workspace' }],
      ],
    },
    {
      id: 'welcome-primary-action',
      type: 'action',
      label: 'Open workspace',
      href: 'https://example.com/workspace',
      priority: 'primary',
    },
    {
      id: 'welcome-divider',
      type: 'divider',
    },
    {
      id: 'welcome-next-section',
      type: 'section',
      title: "What's next",
      blocks: [
        {
          id: 'welcome-next-paragraph',
          type: 'paragraph',
          content: [
            {
              type: 'text',
              value:
                'Browse the documentation to learn how Atlas adapts the same document to every surface — without losing fidelity.',
            },
          ],
        },
        {
          id: 'welcome-docs-action',
          type: 'action',
          label: 'Read the docs',
          href: 'https://example.com/docs',
          priority: 'secondary',
        },
      ],
    },
  ],
};

/**
 * Polished incident-alert fixture.
 *
 * Covers: heading, callout, paragraph, list, code, action, image, table.
 */

import type { PortableDoc } from '@portable-doc/core';

export const incident: PortableDoc = {
  version: 1,
  title: 'Database failover detected',
  preview: 'Primary DB unreachable at 14:32 UTC. Failover succeeded.',
  blocks: [
    {
      id: 'incident-heading',
      type: 'heading',
      level: 1,
      text: 'Database failover detected',
    },
    {
      id: 'incident-callout',
      type: 'callout',
      tone: 'danger',
      title: 'Active incident',
      content: [
        {
          type: 'text',
          value:
            'Primary DB became unreachable at 14:32 UTC. Failover succeeded at 14:33.',
        },
      ],
    },
    {
      id: 'incident-summary',
      type: 'paragraph',
      content: [
        {
          type: 'text',
          value:
            'The primary database stopped responding to health checks at 14:32 UTC. The replica was promoted automatically and the API resumed serving traffic at 14:33 UTC. Investigate root cause before failing back.',
        },
      ],
    },
    {
      id: 'incident-remediation',
      type: 'list',
      ordered: true,
      items: [
        [
          {
            type: 'text',
            value: 'Confirm the replica is healthy and accepting writes.',
          },
        ],
        [
          {
            type: 'text',
            value: 'Page the on-call DBA to inspect the former primary.',
          },
        ],
        [
          {
            type: 'text',
            value:
              'Postpone non-critical migrations until failback is complete.',
          },
        ],
      ],
    },
    {
      id: 'incident-runbook',
      type: 'code',
      lang: 'bash',
      value: [
        '$ kubectl rollout status deploy/api',
        '$ pgcli -h db-replica.svc -c "SELECT 1"',
        '$ tail -f /var/log/incident.log',
        '$ curl -s https://status.example.com/health',
      ].join('\n'),
    },
    {
      id: 'incident-dashboard-action',
      type: 'action',
      label: 'View incident dashboard',
      href: 'https://status.example.com/incidents/2026-05-08',
      priority: 'secondary',
    },
    {
      id: 'incident-cpu-graph',
      type: 'image',
      src: 'https://example.com/img/db-cpu.png',
      alt: 'DB CPU graph showing failover spike',
      surfaces: ['web', 'native'],
    },
    {
      id: 'incident-metrics-table',
      type: 'table',
      surfaces: ['web', 'native'],
      rows: [
        [
          [{ type: 'text', value: 'Metric' }],
          [{ type: 'text', value: 'Threshold' }],
          [{ type: 'text', value: 'Actual' }],
        ],
        [
          [{ type: 'text', value: 'Primary CPU' }],
          [{ type: 'text', value: '80%' }],
          [{ type: 'text', value: '99%' }],
        ],
        [
          [{ type: 'text', value: 'Replica lag' }],
          [{ type: 'text', value: '5s' }],
          [{ type: 'text', value: '0.4s' }],
        ],
      ],
    },
  ],
};

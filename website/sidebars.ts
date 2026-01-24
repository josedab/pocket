import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'quick-reference',
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'concepts/local-first',
        'concepts/database-model',
        'concepts/reactive-queries',
        'concepts/storage-backends',
        'concepts/sync-architecture',
      ],
    },
    {
      type: 'category',
      label: 'Framework Integration',
      collapsed: false,
      items: [
        'guides/react-integration',
        'guides/vue-integration',
        'guides/svelte-integration',
        'guides/solid-integration',
        'guides/react-native',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/offline-first-app',
        'guides/sync-setup',
        'guides/conflict-resolution',
        'guides/schema-validation',
        'guides/indexing',
        'guides/relationships',
        'guides/plugins',
        'guides/full-text-search',
        'guides/migrations',
        'guides/vectors-ai',
        'guides/encryption',
        'guides/crdts',
        'guides/selective-sync',
        'guides/ttl-expiration',
        'guides/data-seeding',
        'guides/migrating-from-other-databases',
      ],
    },
    {
      type: 'category',
      label: 'Best Practices',
      collapsed: true,
      items: ['guides/testing', 'guides/performance', 'guides/security'],
    },
    {
      type: 'category',
      label: 'API Reference',
      collapsed: false,
      items: [
        'api/database',
        'api/collection',
        'api/query-builder',
        'api/sync-engine',
        'api/react-hooks',
        'api/cli',
        'api/error-codes',
      ],
    },
    'troubleshooting',
    'faq',
    'comparison',
    'changelog',
    'contributing',
  ],
};

export default sidebars;

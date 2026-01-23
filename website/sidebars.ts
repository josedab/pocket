import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
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
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/react-integration',
        'guides/offline-first-app',
        'guides/sync-setup',
        'guides/conflict-resolution',
        'guides/schema-validation',
        'guides/indexing',
        'guides/plugins',
        'guides/full-text-search',
        'guides/migrations',
        'guides/react-native',
        'guides/vectors-ai',
        'guides/encryption',
        'guides/crdts',
        'guides/selective-sync',
        'guides/migrating-from-other-databases',
      ],
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

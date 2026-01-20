import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Pocket',
  description: 'Local-first database for web applications',
  base: '/pocket/',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/pocket/logo.svg' }],
    // Open Graph meta tags for social sharing
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Pocket' }],
    ['meta', { property: 'og:description', content: 'Local-first database for web applications' }],
    ['meta', { property: 'og:image', content: '/pocket/og-image.svg' }],
    ['meta', { property: 'og:url', content: 'https://pocket-db.github.io/pocket/' }],
    ['meta', { property: 'og:site_name', content: 'Pocket' }],
    // Twitter Card meta tags
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Pocket' }],
    ['meta', { name: 'twitter:description', content: 'Local-first database for web applications' }],
    ['meta', { name: 'twitter:image', content: '/pocket/og-image.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'ADRs', link: '/adr/' },
      {
        text: 'Examples',
        link: 'https://github.com/pocket-db/pocket/tree/main/examples',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Pocket?', link: '/guide/' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Database', link: '/guide/database' },
            { text: 'Collections', link: '/guide/collections' },
            { text: 'Documents', link: '/guide/documents' },
            { text: 'Queries', link: '/guide/queries' },
          ],
        },
        {
          text: 'Reactive Queries',
          items: [
            { text: 'Live Queries', link: '/guide/live-queries' },
            { text: 'React Integration', link: '/guide/react' },
          ],
        },
        {
          text: 'Storage Adapters',
          items: [
            { text: 'Overview', link: '/guide/storage' },
            { text: 'IndexedDB', link: '/guide/storage-indexeddb' },
            { text: 'OPFS', link: '/guide/storage-opfs' },
            { text: 'Memory', link: '/guide/storage-memory' },
          ],
        },
        {
          text: 'Sync',
          items: [
            { text: 'Overview', link: '/guide/sync' },
            { text: 'Server Setup', link: '/guide/sync-server' },
            { text: 'Conflict Resolution', link: '/guide/conflict-resolution' },
          ],
        },
      ],
      '/adr/': [
        {
          text: 'Architecture Decisions',
          items: [
            { text: 'Overview', link: '/adr/' },
            { text: 'ADR-001: Local-First', link: '/adr/adr-001-local-first-architecture' },
            { text: 'ADR-002: RxJS Reactivity', link: '/adr/adr-002-rxjs-for-reactivity' },
            { text: 'ADR-003: Storage Adapters', link: '/adr/adr-003-pluggable-storage-adapters' },
            { text: 'ADR-004: Vector Clocks', link: '/adr/adr-004-vector-clocks-for-sync' },
            { text: 'ADR-005: Monorepo', link: '/adr/adr-005-monorepo-structure' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/pocket-db/pocket' }],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 Pocket Contributors',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/pocket-db/pocket/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});

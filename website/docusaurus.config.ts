import type * as Preset from '@docusaurus/preset-classic';
import type { Config, Plugin } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'Pocket',
  tagline: 'A local-first database for the modern web',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://pocket-db.github.io',
  baseUrl: '/pocket/',

  organizationName: 'pocket-db',
  projectName: 'pocket',

  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/pocket-db/pocket/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    function webpackFallbackPlugin(): Plugin {
      return {
        name: 'webpack-fallback-plugin',
        configureWebpack() {
          return {
            resolve: {
              fallback: {
                'vscode-languageserver-types': false,
                'vscode-jsonrpc/lib/common/cancellation.js': false,
                'vscode-jsonrpc/lib/common/events.js': false,
                '@chevrotain/regexp-to-ast': false,
              },
            },
          };
        },
      };
    },
  ],

  themeConfig: {
    image: 'img/pocket-social-card.svg',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Pocket',
      logo: {
        alt: 'Pocket Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/playground',
          label: 'Playground',
          position: 'left',
        },
        {
          to: '/docs/api/database',
          label: 'API',
          position: 'left',
        },
        {
          to: '/docs/changelog',
          label: 'Changelog',
          position: 'left',
        },
        {
          to: '/docs/adr/README',
          label: 'ADRs',
          position: 'left',
        },
        {
          href: 'https://discord.gg/pocket-db',
          label: 'Discord',
          position: 'right',
        },
        {
          href: 'https://github.com/pocket-db/pocket',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'Core Concepts',
              to: '/docs/concepts/local-first',
            },
            {
              label: 'API Reference',
              to: '/docs/api/database',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.gg/pocket-db',
            },
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/pocket-db/pocket/discussions',
            },
            {
              label: 'Twitter / X',
              href: 'https://twitter.com/pocket_db',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/pocket-db/pocket',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/pocket',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Pocket Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

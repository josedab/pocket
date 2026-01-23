import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import type { ReactNode } from 'react';

import styles from './index.module.css';

function Badges() {
  return (
    <div className={styles.badges}>
      <a href="https://github.com/pocket-db/pocket/actions/workflows/ci.yml">
        <img
          src="https://github.com/pocket-db/pocket/actions/workflows/ci.yml/badge.svg"
          alt="CI"
        />
      </a>
      <a href="https://codecov.io/gh/pocket-db/pocket">
        <img
          src="https://codecov.io/gh/pocket-db/pocket/branch/main/graph/badge.svg"
          alt="Coverage"
        />
      </a>
      <a href="https://www.npmjs.com/package/pocket">
        <img src="https://img.shields.io/npm/v/pocket.svg" alt="npm version" />
      </a>
      <a href="https://bundlephobia.com/package/pocket">
        <img src="https://img.shields.io/bundlephobia/minzip/pocket" alt="Bundle Size" />
      </a>
      <a href="https://github.com/pocket-db/pocket">
        <img
          src="https://img.shields.io/github/stars/pocket-db/pocket?style=social"
          alt="GitHub Stars"
        />
      </a>
      <a href="https://opensource.org/licenses/MIT">
        <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" />
      </a>
    </div>
  );
}

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p className={styles.heroDescription}>
          Store data locally, work offline, sync when connected. Built for React with
          TypeScript-first design.
        </p>
        <Badges />
        <div className={styles.installCommand}>
          <code>npm install pocket</code>
        </div>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="https://github.com/pocket-db/pocket"
          >
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

const quickExample = `import { Database, createIndexedDBStorage } from 'pocket';

// Create a database
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Insert a document
const todo = await db.collection('todos').insert({
  _id: crypto.randomUUID(),
  title: 'Learn Pocket',
  completed: false,
});

// Subscribe to live updates
db.collection('todos')
  .find()
  .where('completed').equals(false)
  .live()
  .subscribe((todos) => {
    console.log('Todos updated:', todos);
  });`;

function QuickExample() {
  return (
    <section className={styles.exampleSection}>
      <div className="container">
        <div className={styles.sectionTitle}>
          <Heading as="h2">Simple, Powerful API</Heading>
          <p>Get productive in minutes with an intuitive document database.</p>
        </div>
        <div className={styles.codeExample}>
          <CodeBlock language="typescript">{quickExample}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

type FeatureItem = {
  title: string;
  icon: string;
  description: string;
};

const features: FeatureItem[] = [
  {
    title: 'Local-First',
    icon: '📱',
    description:
      'Data lives on the device. Zero latency reads and writes. Works offline by default.',
  },
  {
    title: 'Reactive Queries',
    icon: '⚡',
    description:
      'Subscribe to queries that automatically update when data changes. No manual refreshing.',
  },
  {
    title: 'TypeScript Native',
    icon: '🔷',
    description:
      'Full type safety with strict TypeScript. Your collections and queries are fully typed.',
  },
  {
    title: 'React Hooks',
    icon: '⚛️',
    description:
      'First-class React support with useLiveQuery, useMutation, and more. Built-in, not bolted on.',
  },
  {
    title: 'Sync Ready',
    icon: '🔄',
    description: 'Optional sync engine for multi-device support. WebSocket and HTTP transports.',
  },
  {
    title: 'Lightweight',
    icon: '🪶',
    description: 'Core is ~25KB gzipped. Tree-shakeable. Only bundle what you use.',
  },
];

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.sectionTitle}>
          <Heading as="h2">Why Pocket?</Heading>
          <p>Everything you need for client-side data management.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature, idx) => (
            <div key={idx} className={styles.featureCard}>
              <div className={styles.featureIcon}>{feature.icon}</div>
              <Heading as="h3">{feature.title}</Heading>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ArchitectureDiagram() {
  return (
    <section className={styles.architectureSection}>
      <div className="container">
        <div className={styles.sectionTitle}>
          <Heading as="h2">How It Works</Heading>
          <p>Data flows from your app to local storage, with optional server sync.</p>
        </div>
        <div className={styles.architectureDiagram}>
          <svg viewBox="0 0 800 300" className={styles.architectureSvg}>
            {/* App Layer */}
            <g className={styles.archNode}>
              <rect x="50" y="100" width="140" height="80" rx="8" className={styles.archBox} />
              <text x="120" y="135" textAnchor="middle" className={styles.archTitle}>
                Your App
              </text>
              <text x="120" y="155" textAnchor="middle" className={styles.archSubtitle}>
                React / JS
              </text>
            </g>

            {/* Arrow: App to Pocket */}
            <g className={styles.archArrow}>
              <line
                x1="190"
                y1="140"
                x2="250"
                y2="140"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
              <text x="220" y="130" textAnchor="middle" className={styles.archLabel}>
                queries
              </text>
            </g>

            {/* Pocket Layer */}
            <g className={styles.archNode}>
              <rect
                x="260"
                y="80"
                width="160"
                height="120"
                rx="8"
                className={styles.archBoxPrimary}
              />
              <text x="340" y="115" textAnchor="middle" className={styles.archTitleLight}>
                Pocket
              </text>
              <text x="340" y="140" textAnchor="middle" className={styles.archSubtitleLight}>
                Reactive Queries
              </text>
              <text x="340" y="160" textAnchor="middle" className={styles.archSubtitleLight}>
                Schema Validation
              </text>
              <text x="340" y="180" textAnchor="middle" className={styles.archSubtitleLight}>
                Change Tracking
              </text>
            </g>

            {/* Arrow: Pocket to Storage */}
            <g className={styles.archArrow}>
              <line
                x1="420"
                y1="140"
                x2="480"
                y2="140"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
              <text x="450" y="130" textAnchor="middle" className={styles.archLabel}>
                persist
              </text>
            </g>

            {/* Storage Layer */}
            <g className={styles.archNode}>
              <rect x="490" y="100" width="140" height="80" rx="8" className={styles.archBox} />
              <text x="560" y="135" textAnchor="middle" className={styles.archTitle}>
                Browser
              </text>
              <text x="560" y="155" textAnchor="middle" className={styles.archSubtitle}>
                IndexedDB / OPFS
              </text>
            </g>

            {/* Arrow: Storage to Server (optional) */}
            <g className={styles.archArrow}>
              <line
                x1="630"
                y1="140"
                x2="680"
                y2="140"
                strokeWidth="2"
                strokeDasharray="5,5"
                markerEnd="url(#arrowhead)"
              />
              <text x="655" y="130" textAnchor="middle" className={styles.archLabel}>
                sync
              </text>
            </g>

            {/* Server Layer (optional) */}
            <g className={styles.archNodeOptional}>
              <rect
                x="690"
                y="100"
                width="90"
                height="80"
                rx="8"
                className={styles.archBoxDashed}
              />
              <text x="735" y="135" textAnchor="middle" className={styles.archTitle}>
                Server
              </text>
              <text x="735" y="155" textAnchor="middle" className={styles.archSubtitle}>
                (optional)
              </text>
            </g>

            {/* Arrow definition */}
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" className={styles.archArrowHead} />
              </marker>
            </defs>

            {/* Instant label */}
            <g>
              <rect x="260" y="220" width="100" height="24" rx="4" className={styles.archBadge} />
              <text x="310" y="236" textAnchor="middle" className={styles.archBadgeText}>
                &lt;10ms reads
              </text>
            </g>

            {/* Offline label */}
            <g>
              <rect x="380" y="220" width="120" height="24" rx="4" className={styles.archBadge} />
              <text x="440" y="236" textAnchor="middle" className={styles.archBadgeText}>
                Works offline
              </text>
            </g>
          </svg>
        </div>
        <div className={styles.architectureLinks}>
          <Link to="/docs/concepts/local-first">Learn about local-first architecture</Link>
        </div>
      </div>
    </section>
  );
}

const reactExample = `import { PocketProvider, useLiveQuery } from 'pocket/react';

function TodoList() {
  const { data: todos, isLoading } = useLiveQuery(
    'todos',
    (c) => c.find().where('completed').equals(false)
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo._id}>{todo.title}</li>
      ))}
    </ul>
  );
}`;

function ReactSection() {
  return (
    <section className={styles.reactSection}>
      <div className="container">
        <div className="row">
          <div className="col col--6">
            <Heading as="h2">Built for React</Heading>
            <p>
              Pocket's React hooks make data fetching simple. Subscribe to live queries that update
              your UI automatically when data changes.
            </p>
            <ul>
              <li>
                <strong>useLiveQuery</strong> - Subscribe to query results
              </li>
              <li>
                <strong>useMutation</strong> - Handle writes with loading states
              </li>
              <li>
                <strong>useDocument</strong> - Watch a single document
              </li>
              <li>
                <strong>useSyncStatus</strong> - Monitor sync state
              </li>
            </ul>
            <Link className="button button--primary" to="/docs/guides/react-integration">
              React Guide
            </Link>
          </div>
          <div className="col col--6">
            <CodeBlock language="tsx">{reactExample}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

type PackageInfo = {
  name: string;
  description: string;
  size: string;
};

const packages: PackageInfo[] = [
  { name: 'pocket', description: 'All-in-one package', size: '-' },
  { name: '@pocket/core', description: 'Core database engine', size: '~25KB' },
  { name: '@pocket/react', description: 'React hooks', size: '~8KB' },
  { name: '@pocket/sync', description: 'Sync engine', size: '~12KB' },
  { name: '@pocket/storage-indexeddb', description: 'IndexedDB adapter', size: '~5KB' },
  { name: '@pocket/storage-opfs', description: 'OPFS adapter', size: '~8KB' },
  { name: '@pocket/storage-memory', description: 'In-memory adapter', size: '~3KB' },
];

function Community() {
  return (
    <section className={styles.community}>
      <div className="container">
        <div className={styles.sectionTitle}>
          <Heading as="h2">Join the Community</Heading>
          <p>Connect with developers building local-first applications.</p>
        </div>
        <div className={styles.communityGrid}>
          <a
            href="https://github.com/pocket-db/pocket"
            className={styles.communityCard}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className={styles.communityIcon}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </div>
            <div className={styles.communityContent}>
              <h3>GitHub</h3>
              <p>Star us, report issues, and contribute</p>
            </div>
          </a>
          <a
            href="https://github.com/pocket-db/pocket/discussions"
            className={styles.communityCard}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className={styles.communityIcon}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div className={styles.communityContent}>
              <h3>Discussions</h3>
              <p>Ask questions and share ideas</p>
            </div>
          </a>
          <a
            href="https://discord.gg/pocket-db"
            className={styles.communityCard}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className={styles.communityIcon}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </div>
            <div className={styles.communityContent}>
              <h3>Discord</h3>
              <p>Chat with the community in real-time</p>
            </div>
          </a>
          <a
            href="https://twitter.com/pocket_db"
            className={styles.communityCard}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className={styles.communityIcon}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <div className={styles.communityContent}>
              <h3>Twitter / X</h3>
              <p>Follow for updates and announcements</p>
            </div>
          </a>
        </div>
        <div className={styles.communityStats}>
          <div className={styles.stat}>
            <span className={styles.statNumber}>Open Source</span>
            <span className={styles.statLabel}>MIT License</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNumber}>TypeScript</span>
            <span className={styles.statLabel}>100% Type Safe</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNumber}>Active</span>
            <span className={styles.statLabel}>Maintained</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Packages() {
  return (
    <section className={styles.packages}>
      <div className="container">
        <div className={styles.sectionTitle}>
          <Heading as="h2">Modular by Design</Heading>
          <p>Install what you need. Tree-shake what you don't.</p>
        </div>
        <table className={styles.packagesTable}>
          <thead>
            <tr>
              <th>Package</th>
              <th>Description</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.name}>
                <td>
                  <code>{pkg.name}</code>
                </td>
                <td>{pkg.description}</td>
                <td>{pkg.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className={styles.cta}>
      <div className="container">
        <Heading as="h2">Ready to get started?</Heading>
        <p>Build your first local-first app in under 5 minutes.</p>
        <div className={styles.ctaButtons}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Read the Docs
          </Link>
          <Link
            className="button button--outline button--lg"
            to="https://github.com/pocket-db/pocket"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Local-First Database for the Web"
      description="A local-first database for web applications with reactive queries, TypeScript support, and optional sync."
    >
      <HomepageHeader />
      <main>
        <QuickExample />
        <Features />
        <ArchitectureDiagram />
        <ReactSection />
        <Community />
        <Packages />
        <CTA />
      </main>
    </Layout>
  );
}

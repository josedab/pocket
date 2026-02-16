/**
 * Deploy Configuration Generator — one-click deploy templates for hosting platforms.
 *
 * Generates platform-specific deployment configurations for Vercel, Netlify,
 * and Railway. Includes sync server setup, environment variable scaffolding,
 * and Docker support.
 *
 * @module create-pocket-app
 */

// ── Types ─────────────────────────────────────────────────

export type DeployPlatform = 'vercel' | 'netlify' | 'railway' | 'docker';

export type FrameworkPreset = 'nextjs' | 'remix' | 'sveltekit' | 'vite-react' | 'vite-vue';

export interface DeployConfig {
  platform: DeployPlatform;
  framework: FrameworkPreset;
  /** Include Pocket sync server configuration */
  includeSyncServer: boolean;
  /** Database name for the Pocket instance */
  databaseName: string;
  /** Region for serverless deployment */
  region?: string;
}

export interface GeneratedDeployFile {
  path: string;
  content: string;
  description: string;
}

export interface DeployConfigResult {
  files: GeneratedDeployFile[];
  envVars: EnvVar[];
  instructions: string[];
}

export interface EnvVar {
  name: string;
  value: string;
  secret: boolean;
  description: string;
}

// ── Generator ─────────────────────────────────────────────

/**
 * Generate deployment configuration files for a target platform.
 *
 * Returns all files needed to deploy a Pocket app plus environment
 * variable definitions and deployment instructions.
 */
export function generateDeployFiles(config: DeployConfig): DeployConfigResult {
  switch (config.platform) {
    case 'vercel':
      return generateVercelConfig(config);
    case 'netlify':
      return generateNetlifyConfig(config);
    case 'railway':
      return generateRailwayConfig(config);
    case 'docker':
      return generateDockerConfig(config);
  }
}

/** List all supported platforms */
export function getSupportedPlatforms(): { platform: DeployPlatform; name: string; description: string }[] {
  return [
    { platform: 'vercel', name: 'Vercel', description: 'Serverless deployment with edge functions' },
    { platform: 'netlify', name: 'Netlify', description: 'JAMstack deployment with serverless functions' },
    { platform: 'railway', name: 'Railway', description: 'Full-stack deployment with persistent storage' },
    { platform: 'docker', name: 'Docker', description: 'Containerized deployment for any platform' },
  ];
}

/** List supported framework presets */
export function getSupportedFrameworks(): { framework: FrameworkPreset; name: string }[] {
  return [
    { framework: 'nextjs', name: 'Next.js (App Router)' },
    { framework: 'remix', name: 'Remix' },
    { framework: 'sveltekit', name: 'SvelteKit' },
    { framework: 'vite-react', name: 'Vite + React' },
    { framework: 'vite-vue', name: 'Vite + Vue' },
  ];
}

// ── Vercel ────────────────────────────────────────────────

function generateVercelConfig(config: DeployConfig): DeployConfigResult {
  const files: GeneratedDeployFile[] = [];
  const envVars = getCommonEnvVars(config);

  files.push({
    path: 'vercel.json',
    content: JSON.stringify({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: config.framework === 'nextjs' ? 'nextjs' : config.framework === 'sveltekit' ? 'sveltekit' : null,
      buildCommand: getBuildCommand(config.framework),
      outputDirectory: getOutputDir(config.framework),
      ...(config.includeSyncServer ? {
        rewrites: [
          { source: '/api/pocket/:path*', destination: '/api/pocket/sync' },
        ],
      } : {}),
    }, null, 2),
    description: 'Vercel deployment configuration',
  });

  if (config.includeSyncServer) {
    files.push({
      path: 'api/pocket/sync.ts',
      content: `import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Pocket Sync API Route — handles bidirectional data synchronization.
 * Deploy as a Vercel Serverless Function.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { method } = req;

  res.setHeader('Access-Control-Allow-Origin', process.env.POCKET_CORS_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (method === 'POST') {
    // Sync endpoint — receives client changes and returns server changes
    const body = req.body as { changes?: unknown[]; lastSyncTimestamp?: number };
    const lastSync = body.lastSyncTimestamp ?? 0;

    res.status(200).json({
      changes: [],
      serverTimestamp: Date.now(),
      lastSyncTimestamp: lastSync,
    });
    return;
  }

  if (method === 'GET') {
    // Health check
    res.status(200).json({
      status: 'ok',
      database: process.env.POCKET_DB_NAME ?? '${config.databaseName}',
      timestamp: Date.now(),
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
`,
      description: 'Pocket sync API route for Vercel',
    });
  }

  files.push(generateEnvExample(envVars));

  return {
    files,
    envVars,
    instructions: [
      'Install the Vercel CLI: npm i -g vercel',
      'Link your project: vercel link',
      'Set environment variables: vercel env add POCKET_DB_NAME',
      'Deploy: vercel --prod',
    ],
  };
}

// ── Netlify ───────────────────────────────────────────────

function generateNetlifyConfig(config: DeployConfig): DeployConfigResult {
  const files: GeneratedDeployFile[] = [];
  const envVars = getCommonEnvVars(config);

  files.push({
    path: 'netlify.toml',
    content: `[build]
  command = "${getBuildCommand(config.framework)}"
  publish = "${getOutputDir(config.framework)}"

[build.environment]
  NODE_VERSION = "20"
  POCKET_DB_NAME = "${config.databaseName}"

${config.includeSyncServer ? `[[redirects]]
  from = "/api/pocket/*"
  to = "/.netlify/functions/pocket-sync/:splat"
  status = 200
` : ''}
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
`,
    description: 'Netlify deployment configuration',
  });

  if (config.includeSyncServer) {
    files.push({
      path: 'netlify/functions/pocket-sync.ts',
      content: `import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Pocket Sync Netlify Function — handles data synchronization.
 */
const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.POCKET_CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body ?? '{}') as { lastSyncTimestamp?: number };
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        changes: [],
        serverTimestamp: Date.now(),
        lastSyncTimestamp: body.lastSyncTimestamp ?? 0,
      }),
    };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        database: process.env.POCKET_DB_NAME ?? '${config.databaseName}',
        timestamp: Date.now(),
      }),
    };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

export { handler };
`,
      description: 'Pocket sync Netlify function',
    });
  }

  files.push(generateEnvExample(envVars));

  return {
    files,
    envVars,
    instructions: [
      'Install Netlify CLI: npm i -g netlify-cli',
      'Link your site: netlify link',
      'Set environment variables in Netlify dashboard',
      'Deploy: netlify deploy --prod',
    ],
  };
}

// ── Railway ───────────────────────────────────────────────

function generateRailwayConfig(config: DeployConfig): DeployConfigResult {
  const files: GeneratedDeployFile[] = [];
  const envVars = getCommonEnvVars(config);

  envVars.push({
    name: 'PORT',
    value: '3000',
    secret: false,
    description: 'Server port (Railway sets this automatically)',
  });

  files.push({
    path: 'railway.toml',
    content: `[build]
builder = "nixpacks"
buildCommand = "${getBuildCommand(config.framework)}"

[deploy]
startCommand = "${getStartCommand(config.framework)}"
healthcheckPath = "/api/health"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[service]
internalPort = 3000
`,
    description: 'Railway deployment configuration',
  });

  files.push({
    path: 'Procfile',
    content: `web: ${getStartCommand(config.framework)}\n`,
    description: 'Process file for Railway',
  });

  files.push(generateEnvExample(envVars));

  return {
    files,
    envVars,
    instructions: [
      'Install Railway CLI: npm i -g @railway/cli',
      'Login: railway login',
      'Create project: railway init',
      'Deploy: railway up',
    ],
  };
}

// ── Docker ────────────────────────────────────────────────

function generateDockerConfig(config: DeployConfig): DeployConfigResult {
  const files: GeneratedDeployFile[] = [];
  const envVars = getCommonEnvVars(config);

  files.push({
    path: 'Dockerfile',
    content: `# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN \\
  if [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile; \\
  elif [ -f package-lock.json ]; then npm ci; \\
  else npm install; fi

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV POCKET_DB_NAME=${config.databaseName}
RUN ${getBuildCommand(config.framework)}

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 pocket && \\
    adduser --system --uid 1001 pocket

COPY --from=builder /app/${getOutputDir(config.framework)} ./${getOutputDir(config.framework)}
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER pocket
EXPOSE 3000

CMD ${JSON.stringify(getStartCommand(config.framework).split(' '))}
`,
    description: 'Multi-stage Docker build for production',
  });

  files.push({
    path: '.dockerignore',
    content: `node_modules
.git
.env
.env.local
dist
.next
build
*.log
`,
    description: 'Docker ignore file',
  });

  files.push({
    path: 'docker-compose.yml',
    content: `version: '3.8'

services:
  app:
    build: .
    ports:
      - "\${PORT:-3000}:3000"
    environment:
      - POCKET_DB_NAME=\${POCKET_DB_NAME:-${config.databaseName}}
      - POCKET_SYNC_URL=\${POCKET_SYNC_URL:-}
      - POCKET_CORS_ORIGIN=\${POCKET_CORS_ORIGIN:-*}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
`,
    description: 'Docker Compose configuration',
  });

  files.push(generateEnvExample(envVars));

  return {
    files,
    envVars,
    instructions: [
      'Build image: docker build -t pocket-app .',
      'Run container: docker run -p 3000:3000 pocket-app',
      'Or with Compose: docker compose up -d',
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────

function getCommonEnvVars(config: DeployConfig): EnvVar[] {
  const vars: EnvVar[] = [
    {
      name: 'POCKET_DB_NAME',
      value: config.databaseName,
      secret: false,
      description: 'Pocket database name',
    },
  ];

  if (config.includeSyncServer) {
    vars.push(
      {
        name: 'POCKET_SYNC_URL',
        value: 'https://your-domain.com/api/pocket/sync',
        secret: false,
        description: 'URL of the Pocket sync server',
      },
      {
        name: 'POCKET_SYNC_SECRET',
        value: '',
        secret: true,
        description: 'Shared secret for sync authentication',
      },
      {
        name: 'POCKET_CORS_ORIGIN',
        value: '*',
        secret: false,
        description: 'Allowed CORS origins for sync API',
      },
    );
  }

  return vars;
}

function getBuildCommand(framework: FrameworkPreset): string {
  switch (framework) {
    case 'nextjs': return 'npm run build';
    case 'remix': return 'npm run build';
    case 'sveltekit': return 'npm run build';
    case 'vite-react': return 'npm run build';
    case 'vite-vue': return 'npm run build';
  }
}

function getOutputDir(framework: FrameworkPreset): string {
  switch (framework) {
    case 'nextjs': return '.next';
    case 'remix': return 'build';
    case 'sveltekit': return 'build';
    case 'vite-react': return 'dist';
    case 'vite-vue': return 'dist';
  }
}

function getStartCommand(framework: FrameworkPreset): string {
  switch (framework) {
    case 'nextjs': return 'npm run start';
    case 'remix': return 'npm run start';
    case 'sveltekit': return 'node build/index.js';
    case 'vite-react': return 'npx serve dist';
    case 'vite-vue': return 'npx serve dist';
  }
}

function generateEnvExample(envVars: EnvVar[]): GeneratedDeployFile {
  const content = envVars
    .map((v) => `# ${v.description}\n${v.name}=${v.secret ? '' : v.value}`)
    .join('\n\n');

  return {
    path: '.env.example',
    content: content + '\n',
    description: 'Example environment variables',
  };
}

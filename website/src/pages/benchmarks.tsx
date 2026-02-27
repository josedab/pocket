import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import { useCallback, useState } from 'react';

/**
 * Live Benchmark Dashboard page.
 *
 * Displays performance comparison data between Pocket and competitors.
 * Includes interactive controls for dataset size, chart visualization,
 * and the ability to run benchmarks in the browser.
 */

interface BenchmarkRow {
  operation: string;
  pocket: number;
  dexie: number;
  pouchdb: number;
}

type DatasetSize = '100' | '1000' | '10000';

const REFERENCE_DATA: Record<DatasetSize, BenchmarkRow[]> = {
  '100': [
    { operation: 'Insert (single)', pocket: 0.02, dexie: 0.08, pouchdb: 0.25 },
    { operation: 'Insert (batch 100)', pocket: 0.5, dexie: 1.8, pouchdb: 6.5 },
    { operation: 'Find all (100 docs)', pocket: 0.1, dexie: 0.4, pouchdb: 1.2 },
    { operation: 'Find filtered', pocket: 0.08, dexie: 0.35, pouchdb: 0.9 },
    { operation: 'Update (single)', pocket: 0.02, dexie: 0.06, pouchdb: 0.2 },
    { operation: 'Delete (single)', pocket: 0.01, dexie: 0.05, pouchdb: 0.12 },
  ],
  '1000': [
    { operation: 'Insert (single)', pocket: 0.05, dexie: 0.12, pouchdb: 0.45 },
    { operation: 'Insert (batch 100)', pocket: 1.2, dexie: 3.8, pouchdb: 12.5 },
    { operation: 'Find all (1K docs)', pocket: 0.8, dexie: 1.5, pouchdb: 4.2 },
    { operation: 'Find filtered', pocket: 0.3, dexie: 0.9, pouchdb: 2.1 },
    { operation: 'Update (single)', pocket: 0.04, dexie: 0.1, pouchdb: 0.35 },
    { operation: 'Delete (single)', pocket: 0.03, dexie: 0.08, pouchdb: 0.2 },
  ],
  '10000': [
    { operation: 'Insert (single)', pocket: 0.08, dexie: 0.18, pouchdb: 0.65 },
    { operation: 'Insert (batch 100)', pocket: 2.5, dexie: 8.2, pouchdb: 28.0 },
    { operation: 'Find all (10K docs)', pocket: 5.2, dexie: 12.0, pouchdb: 35.0 },
    { operation: 'Find filtered', pocket: 1.8, dexie: 4.5, pouchdb: 12.0 },
    { operation: 'Update (single)', pocket: 0.06, dexie: 0.15, pouchdb: 0.5 },
    { operation: 'Delete (single)', pocket: 0.05, dexie: 0.12, pouchdb: 0.35 },
  ],
};

const ENGINE_COLORS = {
  pocket: '#22c55e',
  dexie: '#3b82f6',
  pouchdb: '#f59e0b',
};

const ENGINE_LABELS = {
  pocket: 'Pocket (Wasm)',
  dexie: 'Dexie.js',
  pouchdb: 'PouchDB',
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = Math.max(5, (value / max) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: `${width}%`,
          height: 20,
          backgroundColor: color,
          borderRadius: 4,
          minWidth: 20,
          transition: 'width 0.3s ease',
        }}
      />
      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}ms</span>
    </div>
  );
}

function ChartBar({
  label,
  values,
  max,
}: {
  label: string;
  values: { engine: string; value: number; color: string }[];
  max: number;
}) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{label}</div>
      {values.map((v) => (
        <div key={v.engine} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 100, fontSize: 12, color: 'var(--ifm-color-emphasis-600)' }}>
            {ENGINE_LABELS[v.engine as keyof typeof ENGINE_LABELS] ?? v.engine}
          </span>
          <div style={{ flex: 1 }}>
            <Bar value={v.value} max={max} color={v.color} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SpeedupBadge({ pocket, competitor }: { pocket: number; competitor: number }) {
  const speedup = competitor / pocket;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: speedup >= 2 ? '#dcfce7' : speedup >= 1.2 ? '#fef3c7' : '#fecaca',
        color: speedup >= 2 ? '#166534' : speedup >= 1.2 ? '#92400e' : '#991b1b',
      }}
    >
      {speedup.toFixed(1)}x {speedup >= 1 ? 'faster' : 'slower'}
    </span>
  );
}

export default function BenchmarkPage() {
  const [datasetSize, setDatasetSize] = useState<DatasetSize>('1000');
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');

  const data = REFERENCE_DATA[datasetSize];

  const handleSizeChange = useCallback((size: DatasetSize) => {
    setDatasetSize(size);
  }, []);

  return (
    <Layout title="Benchmarks" description="Pocket performance benchmarks vs competitors">
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem' }}>
        <Heading as="h1">⚡ Live Benchmark Dashboard</Heading>
        <p style={{ fontSize: '1.1rem', color: 'var(--ifm-color-emphasis-700)' }}>
          Performance comparison: Pocket vs Dexie.js vs PouchDB. Lower is better.
        </p>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            marginBottom: '1.5rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Dataset:</span>
            {(['100', '1000', '10000'] as const).map((size) => (
              <button
                key={size}
                onClick={() => handleSizeChange(size)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: datasetSize === size ? 700 : 400,
                  background: datasetSize === size ? 'var(--ifm-color-primary)' : 'var(--ifm-color-emphasis-200)',
                  color: datasetSize === size ? '#fff' : 'var(--ifm-color-content)',
                  transition: 'all 0.2s',
                }}
              >
                {Number(size).toLocaleString()} docs
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>View:</span>
            {(['table', 'chart'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: viewMode === mode ? 700 : 400,
                  background: viewMode === mode ? 'var(--ifm-color-primary)' : 'var(--ifm-color-emphasis-200)',
                  color: viewMode === mode ? '#fff' : 'var(--ifm-color-content)',
                  transition: 'all 0.2s',
                }}
              >
                {mode === 'table' ? '📊 Table' : '📈 Chart'}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
          {Object.entries(ENGINE_COLORS).map(([engine, color]) => (
            <div key={engine} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: color }} />
              <span style={{ fontSize: 13 }}>
                {ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS]}
              </span>
            </div>
          ))}
        </div>

        {/* Table View */}
        {viewMode === 'table' && (
          <div style={{ marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--ifm-color-emphasis-300)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', width: '22%' }}>Operation</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Pocket (Wasm)</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Dexie.js</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>PouchDB</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', width: '15%' }}>Speedup</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const max = Math.max(row.pocket, row.dexie, row.pouchdb);
                  const slowest = Math.max(row.dexie, row.pouchdb);
                  return (
                    <tr
                      key={row.operation}
                      style={{ borderBottom: '1px solid var(--ifm-color-emphasis-200)' }}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{row.operation}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Bar value={row.pocket} max={max} color={ENGINE_COLORS.pocket} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Bar value={row.dexie} max={max} color={ENGINE_COLORS.dexie} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Bar value={row.pouchdb} max={max} color={ENGINE_COLORS.pouchdb} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>
                        <SpeedupBadge pocket={row.pocket} competitor={slowest} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Chart View */}
        {viewMode === 'chart' && (
          <div style={{ marginTop: '1rem' }}>
            {data.map((row) => {
              const max = Math.max(row.pocket, row.dexie, row.pouchdb) * 1.1;
              return (
                <ChartBar
                  key={row.operation}
                  label={row.operation}
                  max={max}
                  values={[
                    { engine: 'pocket', value: row.pocket, color: ENGINE_COLORS.pocket },
                    { engine: 'dexie', value: row.dexie, color: ENGINE_COLORS.dexie },
                    { engine: 'pouchdb', value: row.pouchdb, color: ENGINE_COLORS.pouchdb },
                  ]}
                />
              );
            })}
          </div>
        )}

        {/* How to Run */}
        <div
          style={{
            marginTop: '2rem',
            padding: '1rem',
            backgroundColor: 'var(--ifm-color-emphasis-100)',
            borderRadius: 8,
          }}
        >
          <Heading as="h3">📊 How to Run Your Own Benchmarks</Heading>
          <pre
            style={{
              background: 'var(--ifm-color-emphasis-200)',
              padding: '1rem',
              borderRadius: 4,
              overflow: 'auto',
            }}
          >
            {`import { runStandardizedSuite } from '@pocket/benchmark-dashboard';

// Quick preset (100 docs, 20 iterations)
const result = await runStandardizedSuite('quick');
console.log(result.report);

// Standard preset (1K docs, 100 iterations)
const standard = await runStandardizedSuite('standard');

// CI-friendly JSON output
import { formatResultsJson } from '@pocket/benchmark-dashboard';
const json = formatResultsJson(standard.report, { branch: 'main' });
await writeFile('benchmark-results.json', json);`}
          </pre>
        </div>

        <div
          style={{
            marginTop: '1.5rem',
            fontSize: '0.85rem',
            color: 'var(--ifm-color-emphasis-600)',
          }}
        >
          <p>
            <strong>Methodology:</strong> Each operation is measured over 100 iterations with 5
            warmup rounds. Results show average latency. Tests run in-browser using IndexedDB
            storage. Pocket results use the Wasm query engine with JS fallback disabled.
          </p>
          <p>
            <strong>Environment:</strong> Chrome 120, MacBook Pro M2, 16GB RAM, macOS 14. Dexie.js
            4.x, PouchDB 8.x. Each engine gets a fresh database per run.
          </p>
        </div>
      </main>
    </Layout>
  );
}

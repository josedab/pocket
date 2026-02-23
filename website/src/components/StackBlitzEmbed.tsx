import React from 'react';

interface StackBlitzEmbedProps {
  projectId?: string;
  title?: string;
  height?: string;
  view?: 'preview' | 'editor' | 'both';
  file?: string;
}

export default function StackBlitzEmbed({
  projectId = 'pocket-db/pocket/tree/main/examples/playground',
  title = 'Pocket Playground',
  height = '500px',
  view = 'both',
  file = 'src/App.tsx',
}: StackBlitzEmbedProps) {
  const src = `https://stackblitz.com/github/${projectId}?embed=1&file=${file}&view=${view}&theme=dark`;

  return (
    <div style={{ width: '100%', marginBlock: '1.5rem' }}>
      <iframe
        title={title}
        src={src}
        style={{
          width: '100%',
          height,
          border: '1px solid var(--ifm-color-emphasis-300)',
          borderRadius: '8px',
        }}
        loading="lazy"
        allow="cross-origin-isolated"
      />
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import type { SyncEngine, SyncStatus as SyncStatusType } from '@pocket/sync';

interface Props {
  syncEngine: SyncEngine;
}

export function SyncStatus({ syncEngine }: Props) {
  const [status, setStatus] = useState<SyncStatusType>('idle');

  useEffect(() => {
    const subscription = syncEngine.getStatus().subscribe(setStatus);
    return () => subscription.unsubscribe();
  }, [syncEngine]);

  const getStatusColor = () => {
    switch (status) {
      case 'idle':
        return '#6bcb77';
      case 'syncing':
        return '#4d96ff';
      case 'error':
        return '#ff6b6b';
      case 'offline':
      default:
        return '#888';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return 'Online';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Sync Error';
      case 'offline':
      default:
        return 'Offline';
    }
  };

  const handleSync = () => {
    if (status === 'offline') {
      syncEngine.start().catch(console.error);
    } else {
      syncEngine.forceSync().catch(console.error);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.indicator}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: getStatusColor(),
          }}
        />
        <span style={styles.text}>{getStatusText()}</span>
      </div>
      <button
        onClick={handleSync}
        style={styles.button}
        title={status === 'offline' ? 'Connect' : 'Force sync'}
      >
        {status === 'offline' ? 'Connect' : 'Sync'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  indicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    transition: 'background-color 0.3s',
  },
  text: {
    fontSize: '14px',
    color: '#888',
  },
  button: {
    padding: '6px 12px',
    fontSize: '12px',
    backgroundColor: '#2a2a4a',
    color: '#fff',
    border: '1px solid #3a3a5a',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

/**
 * Expo template for create-pocket-app.
 *
 * Generates a basic offline-first Expo application structure with
 * Pocket pre-configured using expo-sqlite for persistence.
 *
 * @module templates/expo
 */

// ────────────────────────────── Template Metadata ──────────────────────────────

/**
 * Expo template metadata.
 */
export interface ExpoTemplateMetadata {
  /** Template display name */
  name: string;

  /** Short description */
  description: string;

  /** Target framework */
  framework: 'react-native';

  /** package.json dependencies */
  dependencies: Record<string, string>;

  /** package.json devDependencies */
  devDependencies: Record<string, string>;

  /** app.json configuration */
  appJson: Record<string, unknown>;

  /** Template files keyed by relative path */
  files: Record<string, string>;
}

// ────────────────────────────── File Contents ──────────────────────────────

const APP_TSX = `import React from 'react';
import { StyleSheet, Text, View, FlatList, ActivityIndicator } from 'react-native';
import { PocketProvider, useQuery, useMutation } from '@pocket/react-native';
import { database } from './database';

interface Item {
  _id: string;
  title: string;
  createdAt: number;
}

function ItemList() {
  const { data: items, isLoading } = useQuery<Item>('items');
  const { insert } = useMutation<Item>('items');

  if (isLoading) {
    return <ActivityIndicator size="large" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pocket + Expo</Text>
      <Text style={styles.subtitle}>Offline-first app</Text>
      <Text style={styles.count}>Items: {items.length}</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text>{item.title}</Text>
          </View>
        )}
      />
    </View>
  );
}

export default function App() {
  return (
    <PocketProvider config={{ name: 'pocket-expo-app', storage: { type: 'sqlite', name: 'pocket-expo' } }}>
      <ItemList />
    </PocketProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  count: { fontSize: 14, color: '#999', marginBottom: 16 },
  item: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
`;

const DATABASE_TS = `import { createNativeSQLiteStorage } from '@pocket/react-native';

/**
 * Database setup for the Expo app.
 *
 * Uses expo-sqlite for native SQLite persistence with WAL mode
 * for optimal concurrent read/write performance.
 */
export const database = {
  name: 'pocket-expo-app',
  storage: 'sqlite' as const,
};
`;

// ────────────────────────────── getExpoTemplate ──────────────────────────────

/**
 * Returns the Expo template metadata for create-pocket-app.
 *
 * Includes all dependencies, app.json config, and starter files
 * needed to bootstrap an offline-first Expo application.
 *
 * @returns The Expo template metadata
 *
 * @example
 * ```typescript
 * import { getExpoTemplate } from './templates/expo.js';
 *
 * const template = getExpoTemplate();
 * console.log(template.name); // 'Expo (React Native)'
 * ```
 */
export function getExpoTemplate(): ExpoTemplateMetadata {
  return {
    name: 'Expo (React Native)',
    description: 'Offline-first Expo app with Pocket and expo-sqlite',
    framework: 'react-native',

    dependencies: {
      expo: '~50.0.0',
      'expo-sqlite': '~13.0.0',
      react: '^18.2.0',
      'react-native': '0.73.0',
      '@pocket/core': 'latest',
      '@pocket/react': 'latest',
      '@pocket/react-native': 'latest',
    },

    devDependencies: {
      '@types/react': '^18.2.0',
      typescript: '^5.3.0',
    },

    appJson: {
      expo: {
        name: 'pocket-expo-app',
        slug: 'pocket-expo-app',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/icon.png',
        userInterfaceStyle: 'light',
        splash: {
          image: './assets/splash.png',
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
        assetBundlePatterns: ['**/*'],
        ios: { supportsTablet: true },
        android: { adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#ffffff' } },
        plugins: ['expo-sqlite'],
      },
    },

    files: {
      'App.tsx': APP_TSX,
      'src/database.ts': DATABASE_TS,
    },
  };
}

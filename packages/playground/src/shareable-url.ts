/**
 * Shareable URL System — encodes playground state into compact URLs
 * for sharing and embedding.
 */

/** Playground state to encode in a URL. */
export interface PlaygroundState {
  readonly code: string;
  readonly language?: 'typescript' | 'javascript';
  readonly autoRun?: boolean;
  readonly theme?: 'light' | 'dark';
  readonly title?: string;
}

/** Decoded state from a URL. */
export interface DecodedState extends PlaygroundState {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Encode playground state into a URL-safe hash string.
 *
 * Uses base64url encoding of JSON for compact representation.
 */
export function encodePlaygroundState(state: PlaygroundState): string {
  try {
    const json = JSON.stringify({
      c: state.code,
      l: state.language ?? 'typescript',
      r: state.autoRun ?? false,
      t: state.theme ?? 'light',
      n: state.title ?? '',
    });
    // Use base64url encoding (browser-safe)
    const encoded = btoa(encodeURIComponent(json));
    return encoded;
  } catch {
    return '';
  }
}

/**
 * Decode playground state from a URL hash string.
 */
export function decodePlaygroundState(hash: string): DecodedState {
  try {
    const json = decodeURIComponent(atob(hash));
    const data = JSON.parse(json) as Record<string, unknown>;

    return {
      valid: true,
      code: (data.c as string) ?? '',
      language: (data.l as 'typescript' | 'javascript') ?? 'typescript',
      autoRun: (data.r as boolean) ?? false,
      theme: (data.t as 'light' | 'dark') ?? 'light',
      title: (data.n as string) ?? '',
    };
  } catch (err) {
    return {
      valid: false,
      code: '',
      error: err instanceof Error ? err.message : 'Invalid state',
    };
  }
}

/**
 * Generate a full shareable URL for a playground state.
 */
export function generateShareableUrl(baseUrl: string, state: PlaygroundState): string {
  const hash = encodePlaygroundState(state);
  return `${baseUrl}#${hash}`;
}

/**
 * Parse a shareable URL back into playground state.
 */
export function parseShareableUrl(url: string): DecodedState {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) {
    return { valid: false, code: '', error: 'No hash in URL' };
  }
  return decodePlaygroundState(url.slice(hashIndex + 1));
}

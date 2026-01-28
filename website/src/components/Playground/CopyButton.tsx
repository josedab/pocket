/**
 * Copy Button Component
 *
 * Provides a button to copy code/text to clipboard with visual feedback.
 *
 * @module Playground/CopyButton
 */

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import styles from './CopyButton.module.css';

export interface CopyButtonProps {
  /** The text to copy to clipboard */
  text: string;
  /** Optional label (defaults to "Copy") */
  label?: string;
  /** Optional success label (defaults to "Copied!") */
  successLabel?: string;
  /** Optional className for styling */
  className?: string;
}

/**
 * Copy to clipboard button with visual feedback
 */
export function CopyButton({
  text,
  label = 'Copy',
  successLabel = 'Copied!',
  className,
}: CopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${styles.copyButton} ${copied ? styles.copied : ''} ${className ?? ''}`}
      title={copied ? successLabel : label}
      aria-label={copied ? successLabel : label}
    >
      {copied ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span className={styles.label}>{copied ? successLabel : label}</span>
    </button>
  );
}

/**
 * Copy code block button (positioned in corner of code block)
 */
export function CopyCodeButton({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${styles.codeButton} ${copied ? styles.copied : ''}`}
      title={copied ? 'Copied!' : 'Copy code'}
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default CopyButton;

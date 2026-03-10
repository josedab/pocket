/**
 * PocketErrorBoundary — React Error Boundary for Pocket database operations.
 *
 * Catches JavaScript errors in its child component tree, logs them, and
 * displays a fallback UI instead of crashing the entire app.
 *
 * @example Basic usage
 * ```tsx
 * import { PocketErrorBoundary, useLiveQuery } from '@pocket/react';
 *
 * function App() {
 *   return (
 *     <PocketErrorBoundary fallback={<div>Something went wrong</div>}>
 *       <TodoList />
 *     </PocketErrorBoundary>
 *   );
 * }
 * ```
 *
 * @example With render prop fallback
 * ```tsx
 * <PocketErrorBoundary
 *   fallback={(error, reset) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={reset}>Retry</button>
 *     </div>
 *   )}
 *   onError={(error) => reportToService(error)}
 * >
 *   <MyComponent />
 * </PocketErrorBoundary>
 * ```
 *
 * @module @pocket/react
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Props for PocketErrorBoundary
 */
export interface PocketErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /**
   * Fallback UI when an error is caught.
   * Can be a React node or a render function receiving (error, resetFn).
   */
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Called when the boundary is reset */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary component for Pocket operations.
 *
 * Catches errors thrown during rendering, in lifecycle methods, and in
 * constructors of the whole tree below. Provides a reset mechanism to
 * allow retrying after transient failures.
 */
export class PocketErrorBoundary extends Component<PocketErrorBoundaryProps, State> {
  constructor(props: PocketErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (typeof fallback === 'function') {
        return fallback(error, this.reset);
      }
      return fallback;
    }

    return children;
  }
}

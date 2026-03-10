import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PocketErrorBoundary } from '../error-boundary.js';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from child');
  }
  return React.createElement('div', null, 'Child rendered');
}

describe('PocketErrorBoundary', () => {
  // Suppress console.error for expected error boundary triggers
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Error Boundary')) return;
      if (typeof args[0] === 'string' && args[0].includes('The above error')) return;
      originalError.call(console, ...args);
    };
  });
  afterAll(() => {
    console.error = originalError;
  });

  it('should render children when no error', () => {
    render(
      React.createElement(
        PocketErrorBoundary,
        { fallback: React.createElement('div', null, 'Error') },
        React.createElement(ThrowingChild, { shouldThrow: false })
      )
    );
    expect(screen.getByText('Child rendered')).toBeDefined();
  });

  it('should render fallback ReactNode when child throws', () => {
    render(
      React.createElement(
        PocketErrorBoundary,
        { fallback: React.createElement('div', null, 'Something went wrong') },
        React.createElement(ThrowingChild, { shouldThrow: true })
      )
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('should render fallback function with error and reset', () => {
    render(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: (error: Error, _reset: () => void) =>
            React.createElement('div', null, `Caught: ${error.message}`),
        },
        React.createElement(ThrowingChild, { shouldThrow: true })
      )
    );
    expect(screen.getByText('Caught: Test error from child')).toBeDefined();
  });

  it('should call onError callback when error is caught', () => {
    const onError = vi.fn();
    render(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: React.createElement('div', null, 'Error'),
          onError,
        },
        React.createElement(ThrowingChild, { shouldThrow: true })
      )
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Test error from child' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('should reset when reset function is called', () => {
    let _resetFn: (() => void) | undefined;

    const { rerender } = render(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: (_error: Error, reset: () => void) => {
            _resetFn = reset;
            return React.createElement('button', { onClick: reset }, 'Reset');
          },
        },
        React.createElement(ThrowingChild, { shouldThrow: true })
      )
    );

    expect(screen.getByText('Reset')).toBeDefined();

    // Re-render with non-throwing child and reset
    rerender(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: (_error: Error, reset: () => void) => {
            _resetFn = reset;
            return React.createElement('button', { onClick: reset }, 'Reset');
          },
        },
        React.createElement(ThrowingChild, { shouldThrow: false })
      )
    );

    // Trigger reset
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText('Child rendered')).toBeDefined();
  });

  it('should call onReset callback when reset', () => {
    const onReset = vi.fn();
    let _resetFn: (() => void) | undefined;

    const { rerender } = render(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: (_error: Error, reset: () => void) => {
            _resetFn = reset;
            return React.createElement('button', { onClick: reset }, 'Reset');
          },
          onReset,
        },
        React.createElement(ThrowingChild, { shouldThrow: true })
      )
    );

    rerender(
      React.createElement(
        PocketErrorBoundary,
        {
          fallback: (_error: Error, reset: () => void) => {
            _resetFn = reset;
            return React.createElement('button', { onClick: reset }, 'Reset');
          },
          onReset,
        },
        React.createElement(ThrowingChild, { shouldThrow: false })
      )
    );

    fireEvent.click(screen.getByText('Reset'));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

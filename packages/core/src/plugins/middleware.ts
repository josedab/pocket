import type { MiddlewareDefinition, MiddlewareFunction, OperationContext } from './types.js';

/**
 * Middleware chain executor
 */
export class MiddlewareChain {
  private readonly middlewares: MiddlewareDefinition[] = [];

  /**
   * Add middleware to the chain
   */
  use(middleware: MiddlewareDefinition): void {
    this.middlewares.push(middleware);
  }

  /**
   * Remove middleware by name
   */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Execute middleware chain
   */
  async execute<T>(context: OperationContext, finalHandler: () => Promise<T>): Promise<T> {
    const applicableMiddlewares = this.getApplicableMiddlewares(context);

    if (applicableMiddlewares.length === 0) {
      return finalHandler();
    }

    // Build the chain from end to start
    let chain = finalHandler;

    for (let i = applicableMiddlewares.length - 1; i >= 0; i--) {
      const middleware = applicableMiddlewares[i]!;
      const next = chain;
      chain = () => middleware.handler(context, next) as Promise<T>;
    }

    return chain();
  }

  /**
   * Get middlewares applicable to context
   */
  private getApplicableMiddlewares(context: OperationContext): MiddlewareDefinition[] {
    return this.middlewares.filter((middleware) => {
      // Check operation match
      if (middleware.operations && middleware.operations.length > 0) {
        if (!middleware.operations.includes(context.operation)) {
          return false;
        }
      }

      // Check collection match
      if (middleware.collections && middleware.collections.length > 0) {
        if (!middleware.collections.includes(context.collection)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get all middleware names
   */
  getNames(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  /**
   * Check if middleware exists
   */
  has(name: string): boolean {
    return this.middlewares.some((m) => m.name === name);
  }

  /**
   * Clear all middleware
   */
  clear(): void {
    this.middlewares.length = 0;
  }
}

/**
 * Create a logging middleware
 */
export function createLoggingMiddleware(
  logger: (message: string, context: OperationContext) => void
): MiddlewareDefinition {
  return {
    name: 'logging',
    handler: async (context, next) => {
      const start = Date.now();
      logger(`[${context.operation}] Starting on ${context.collection}`, context);

      try {
        const result = await next();
        const duration = Date.now() - start;
        logger(
          `[${context.operation}] Completed on ${context.collection} in ${duration}ms`,
          context
        );
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        logger(
          `[${context.operation}] Failed on ${context.collection} after ${duration}ms: ${error instanceof Error ? error.message : String(error)}`,
          context
        );
        throw error;
      }
    },
  };
}

/**
 * Create a timing middleware
 */
export function createTimingMiddleware(
  onTiming: (operation: string, collection: string, durationMs: number) => void
): MiddlewareDefinition {
  return {
    name: 'timing',
    handler: async (context, next) => {
      const start = performance.now();
      try {
        return await next();
      } finally {
        const duration = performance.now() - start;
        onTiming(context.operation, context.collection, duration);
      }
    },
  };
}

/**
 * Create a validation middleware
 */
export function createValidationMiddleware(
  validator: (context: OperationContext) => boolean | string
): MiddlewareDefinition {
  return {
    name: 'validation',
    operations: ['insert', 'update'],
    handler: async (context, next) => {
      const result = validator(context);
      if (result !== true) {
        throw new Error(typeof result === 'string' ? result : 'Validation failed');
      }
      return next();
    },
  };
}

/**
 * Create a rate limiting middleware
 */
export function createRateLimitMiddleware(maxOperationsPerSecond: number): MiddlewareDefinition {
  const operationTimestamps: number[] = [];
  const windowMs = 1000;

  return {
    name: 'rate-limit',
    handler: async (context, next) => {
      const now = Date.now();

      // Remove timestamps outside the window
      while (operationTimestamps.length > 0 && operationTimestamps[0]! < now - windowMs) {
        operationTimestamps.shift();
      }

      if (operationTimestamps.length >= maxOperationsPerSecond) {
        throw new Error(
          `Rate limit exceeded: ${maxOperationsPerSecond} operations per second on ${context.collection}`
        );
      }

      operationTimestamps.push(now);
      return next();
    },
  };
}

/**
 * Create a retry middleware
 */
export function createRetryMiddleware(
  maxRetries = 3,
  delayMs = 100,
  shouldRetry?: (error: Error) => boolean
): MiddlewareDefinition {
  return {
    name: 'retry',
    handler: async (_context, next) => {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await next();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === maxRetries) {
            throw lastError;
          }

          if (shouldRetry && !shouldRetry(lastError)) {
            throw lastError;
          }

          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
        }
      }

      throw lastError!;
    },
  };
}

/**
 * Compose multiple middleware functions into one
 */
export function composeMiddleware(
  ...handlers: MiddlewareFunction<OperationContext, unknown>[]
): MiddlewareFunction<OperationContext, unknown> {
  return async (ctx, finalNext) => {
    let index = -1;

    const dispatch = async (i: number): Promise<unknown> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      const handler = handlers[i];
      if (!handler) {
        return finalNext();
      }

      return handler(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

/**
 * Create a middleware chain
 */
export function createMiddlewareChain(): MiddlewareChain {
  return new MiddlewareChain();
}

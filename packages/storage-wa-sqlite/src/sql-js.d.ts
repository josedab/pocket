/**
 * Minimal type declaration for sql.js module.
 *
 * This provides just enough typing for the dynamic import fallback
 * in the adapter. Users are expected to provide their own sql.js
 * initialization via the sqlJsFactory config option.
 */
declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
  }

  interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    prepare(sql: string): SqlJsStatement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;

  export default initSqlJs;
  export type { SqlJsStatic, SqlJsDatabase, SqlJsStatement };
}

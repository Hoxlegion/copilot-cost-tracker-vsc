/**
 * Type declarations for sql.js
 * Minimal type definitions to suppress TS7016 error
 */

declare module "sql.js" {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string): Array<{ columns: string[]; values: any[][] }>;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: Record<string, any> | any[]): boolean;
    step(): boolean;
    reset(): void;
    get(): any[];
    getAsObject(): Record<string, any>;
    free(): boolean;
  }

  export interface InitSqlJsStatic {
    (config?: { locateFile?: () => string }): Promise<SqlJsStatic>;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  const initSqlJs: InitSqlJsStatic;
  export default initSqlJs;
  export { initSqlJs };
}

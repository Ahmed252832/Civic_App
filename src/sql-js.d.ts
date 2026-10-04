declare module 'sql.js' {
  type Database = {
    run(sql: string, params?: Array<string | number | null>): void;
    exec(sql: string): Array<{ values: Array<Array<string | number | null>> }>;
    close(): void;
  };
  const initSqlJs: (options: { locateFile: (name: string) => string }) => Promise<{ Database: new () => Database }>;
  export default initSqlJs;
}
declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}

import { initDatabase, resolveDbPath } from "./db.ts";
import { createHandler } from "./app.ts";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);
const databasePath = resolveDbPath();

const db = initDatabase(databasePath);
const handle = createHandler({ db, dbPath: databasePath, host });

Bun.serve({ port, hostname: host, fetch: handle });

console.log(`Minhas Tarefas API em http://${host}:${port} (banco: ${databasePath})`);

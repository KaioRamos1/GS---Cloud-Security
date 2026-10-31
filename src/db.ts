import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','concluida','cancelada')),
  priority TEXT NOT NULL DEFAULT 'media' CHECK(priority IN ('baixa','media','alta')),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`;

const DEMO_TASKS: [string, string, string, string][] = [
  ["Estudar computação em nuvem", "Revisar os conceitos de IaaS, PaaS e SaaS para o trabalho", "pendente", "alta"],
  ["Provisionar a VM no Azure", "Criar a VM com SKU B1s e liberar a porta 80 no NSG", "concluida", "media"],
  ["Publicar o repositório no GitHub", "Subir o código e compartilhar o link", "pendente", "baixa"],
];

export function resolveDbPath(): string {
  const base = process.env.XDG_DATA_HOME ?? `${homedir()}/.local/share`;
  return process.env.TODO_API_DB_PATH ?? `${base}/minhas-tarefas/tasks.sqlite3`;
}

export function connect(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function initDatabase(path: string): Database {
  const db = connect(path);
  db.exec(SCHEMA);
  const { total } = db.query("SELECT COUNT(*) AS total FROM tasks").get() as { total: number };
  if (total === 0) {
    const insert = db.prepare("INSERT INTO tasks (title, description, status, priority) VALUES (?, ?, ?, ?)");
    for (const task of DEMO_TASKS) insert.run(...task);
  }
  return db;
}

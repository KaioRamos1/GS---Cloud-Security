import type { Database } from "bun:sqlite";
import { SQLiteError } from "bun:sqlite";
import { taskPayload, ValidationError, type TaskFields } from "./validate.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const TASK_ID_RE = /^\/api\/tasks\/(\d+)$/;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function ok(status: number, data: unknown): Response {
  return json(status, { data });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 1_000_000) throw new ValidationError("Corpo da requisição excede 1 MB.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ValidationError("JSON inválido.");
  }
}

export interface HandlerConfig {
  db: Database;
  dbPath: string;
  host: string;
}

export function createHandler({ db, dbPath, host }: HandlerConfig) {
  const dashboardFile = new URL("../public/dashboard.html", import.meta.url);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (method === "GET" && path === "/") {
      const file = Bun.file(dashboardFile);
      if (!(await file.exists())) return fail(404, "not_found", "Dashboard não encontrado.");
      return new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (!path.startsWith("/api/")) {
      return fail(404, "not_found", "Rota não encontrada.");
    }

    try {
      if (method === "GET" && path === "/api/health") {
        return json(200, { status: "ok", database: dbPath, host });
      }

      if (path === "/api/tasks") {
        if (method === "GET") {
          const status = url.searchParams.get("status");
          const tasks = status
            ? db.query("SELECT * FROM tasks WHERE status = ? ORDER BY id").all(status)
            : db.query("SELECT * FROM tasks ORDER BY CASE status WHEN 'pendente' THEN 0 ELSE 1 END, id").all();
          return ok(200, tasks);
        }
        if (method === "POST") {
          const fields = taskPayload(await readBody(request), true);
          const keys = Object.keys(fields);
          const values = keys.map((key) => fields[key as keyof TaskFields]);
          const result = db
            .query(`INSERT INTO tasks (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
            .run(...values);
          return ok(201, db.query("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid));
        }
      }

      const match = TASK_ID_RE.exec(path);
      if (match) {
        const id = Number(match[1]);
        if (method === "GET") {
          const task = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
          return task ? ok(200, task) : fail(404, "not_found", "Tarefa não encontrada.");
        }
        if (method === "PUT") {
          const fields = taskPayload(await readBody(request), false);
          const keys = Object.keys(fields);
          const values = keys.map((key) => fields[key as keyof TaskFields]);
          const assignments = [...keys.map((key) => `${key} = ?`), "updated_at = CURRENT_TIMESTAMP"];
          const result = db.query(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
          if (result.changes === 0) return fail(404, "not_found", "Tarefa não encontrada.");
          return ok(200, db.query("SELECT * FROM tasks WHERE id = ?").get(id));
        }
        if (method === "DELETE") {
          if (url.searchParams.get("confirm") !== "true") {
            return fail(409, "confirmation_required", "Confirme a exclusão com ?confirm=true.");
          }
          const result = db.query("DELETE FROM tasks WHERE id = ?").run(id);
          if (result.changes === 0) return fail(404, "not_found", "Tarefa não encontrada.");
          return new Response(null, { status: 204 });
        }
      }

      if (method === "GET" && path === "/api/dashboard") {
        const stats = db
          .query(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(status = 'pendente'), 0) AS pendentes,
                    COALESCE(SUM(status = 'concluida'), 0) AS concluidas,
                    COALESCE(SUM(status = 'cancelada'), 0) AS canceladas
             FROM tasks`
          )
          .get();
        return ok(200, stats);
      }

      return fail(404, "not_found", "Rota não encontrada.");
    } catch (error) {
      if (error instanceof ValidationError) return fail(400, "validation_error", error.message);
      if (error instanceof SQLiteError) return fail(409, "conflict", "Registro duplicado ou restrição violada.");
      console.error(error);
      return fail(500, "internal_error", "Erro interno. Verifique os dados informados.");
    }
  };
}

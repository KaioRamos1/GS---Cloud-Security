import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { initDatabase } from "../src/db.ts";
import { createHandler } from "../src/app.ts";
import { taskPayload, ValidationError } from "../src/validate.ts";

let db: Database;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "minhas-tarefas-test-"));
  const databasePath = join(dir, "tasks.sqlite3");
  db = initDatabase(databasePath);
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: createHandler({ db, dbPath: databasePath, host: "127.0.0.1" }),
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  db.close();
});

const post = (body: string) =>
  fetch(`${baseUrl}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

describe("health e seeds", () => {
  test("health responde ok com caminho do banco", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(String(body.database).includes("tasks.sqlite3")).toBe(true);
  });

  test("primeiro início semeia três tarefas de demonstração", async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });
});

describe("CRUD de tarefas", () => {
  test("POST cria tarefa e responde 201", async () => {
    const res = await post(
      JSON.stringify({ title: "Tarefa de teste", description: "Criada pelo teste", priority: "alta", due_date: "2026-12-31" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.title).toBe("Tarefa de teste");
    expect(body.data.status).toBe("pendente");
    expect(body.data.priority).toBe("alta");
    expect(body.data.due_date).toBe("2026-12-31");
  });

  test("GET por id retorna a tarefa criada", async () => {
    const created = await (await post(JSON.stringify({ title: "Buscar por id" }))).json();
    const res = await fetch(`${baseUrl}/api/tasks/${created.data.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.title).toBe("Buscar por id");
  });

  test("GET de id inexistente responde 404", async () => {
    const res = await fetch(`${baseUrl}/api/tasks/99999`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("filtro ?status= retorna apenas o status pedido", async () => {
    const res = await fetch(`${baseUrl}/api/tasks?status=concluida`);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((t: { status: string }) => t.status === "concluida")).toBe(true);
  });

  test("PUT atualiza campos permitidos", async () => {
    const created = await (await post(JSON.stringify({ title: "Tarefa para PUT" }))).json();
    const res = await fetch(`${baseUrl}/api/tasks/${created.data.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "concluida" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("concluida");
    expect(body.data.title).toBe("Tarefa para PUT");
  });

  test("PUT sem campos válidos responde 400", async () => {
    const res = await fetch(`${baseUrl}/api/tasks/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_error");
  });

  test("DELETE sem confirmação responde 409 e mantém a tarefa", async () => {
    const created = await (await post(JSON.stringify({ title: "Exclusão protegida" }))).json();
    const res = await fetch(`${baseUrl}/api/tasks/${created.data.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("confirmation_required");
    const still = await fetch(`${baseUrl}/api/tasks/${created.data.id}`);
    expect(still.status).toBe(200);
  });

  test("DELETE com confirm=true remove a tarefa", async () => {
    const created = await (await post(JSON.stringify({ title: "Excluir de fato" }))).json();
    const res = await fetch(`${baseUrl}/api/tasks/${created.data.id}?confirm=true`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const gone = await fetch(`${baseUrl}/api/tasks/${created.data.id}`);
    expect(gone.status).toBe(404);
  });
});

describe("validação", () => {
  test("POST sem title responde 400", async () => {
    const res = await post(JSON.stringify({ priority: "alta" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_error");
  });

  test("POST com status inválido responde 400", async () => {
    const res = await post(JSON.stringify({ title: "X", status: "arquivada" }));
    expect(res.status).toBe(400);
  });

  test("POST com JSON inválido responde 400", async () => {
    const res = await post("{isto não é json");
    expect(res.status).toBe(400);
  });

  test("taskPayload rejeita title vazio", () => {
    expect(() => taskPayload({ title: "   " }, true)).toThrow(ValidationError);
  });

  test("taskPayload rejeita due_date fora do formato", () => {
    expect(() => taskPayload({ title: "X", due_date: "31/12/2026" }, true)).toThrow(ValidationError);
  });

  test("taskPayload descarta campos fora da whitelist", () => {
    const fields = taskPayload({ title: "X", id: 99, is_admin: true }, true);
    expect(Object.keys(fields)).toEqual(["title"]);
  });
});

describe("rotas e dashboard", () => {
  test("rota desconhecida responde 404 em JSON", async () => {
    const res = await fetch(`${baseUrl}/api/qualquer`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("dashboard agrega contadores", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBeGreaterThanOrEqual(3);
    expect(body.data.pendentes).toBeGreaterThanOrEqual(1);
  });

  test("GET / serve o dashboard HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("Minhas Tarefas");
  });
});

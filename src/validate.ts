export class ValidationError extends Error {}

const STATUSES = new Set(["pendente", "concluida", "cancelada"]);
const PRIORITIES = new Set(["baixa", "media", "alta"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TaskFields {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
}

export function taskPayload(raw: unknown, creating: boolean): TaskFields {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("Corpo da requisição deve ser um objeto JSON.");
  }
  const data = raw as Record<string, unknown>;
  if (creating && (typeof data.title !== "string" || !data.title.trim())) {
    throw new ValidationError("Campo obrigatório ausente: title.");
  }
  if ("title" in data && data.title !== undefined && data.title !== null) {
    if (typeof data.title !== "string" || !data.title.trim()) {
      throw new ValidationError("title não pode ser vazio.");
    }
    if (data.title.trim().length > 200) {
      throw new ValidationError("title deve ter no máximo 200 caracteres.");
    }
  }
  if ("description" in data && data.description !== null && data.description !== undefined) {
    if (typeof data.description !== "string") throw new ValidationError("description deve ser texto.");
    if (data.description.length > 2000) throw new ValidationError("description deve ter no máximo 2000 caracteres.");
  }
  if ("status" in data && data.status !== undefined && data.status !== null) {
    if (typeof data.status !== "string" || !STATUSES.has(data.status)) {
      throw new ValidationError("status deve ser pendente, concluida ou cancelada.");
    }
  }
  if ("priority" in data && data.priority !== undefined && data.priority !== null) {
    if (typeof data.priority !== "string" || !PRIORITIES.has(data.priority)) {
      throw new ValidationError("priority deve ser baixa, media ou alta.");
    }
  }
  if ("due_date" in data && data.due_date !== null && data.due_date !== undefined && data.due_date !== "") {
    if (typeof data.due_date !== "string" || !DATE_RE.test(data.due_date)) {
      throw new ValidationError("due_date deve usar o formato AAAA-MM-DD.");
    }
  }
  const fields: TaskFields = {};
  if (typeof data.title === "string" && data.title.trim()) fields.title = data.title.trim();
  if (typeof data.description === "string") fields.description = data.description;
  if (typeof data.status === "string" && STATUSES.has(data.status)) fields.status = data.status;
  if (typeof data.priority === "string" && PRIORITIES.has(data.priority)) fields.priority = data.priority;
  if (typeof data.due_date === "string" && DATE_RE.test(data.due_date)) fields.due_date = data.due_date;
  else if (data.due_date === null || data.due_date === "") fields.due_date = null;
  if (!creating && Object.keys(fields).length === 0) {
    throw new ValidationError("Informe ao menos um campo válido para atualizar.");
  }
  return fields;
}

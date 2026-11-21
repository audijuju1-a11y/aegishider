/** HTML templating with automatic escaping. `html` output is the only trusted type. */
export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return escapeHtml(value);
  throw new Error(`Unsupported template value: ${typeof value}`);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + (strings[i + 1] ?? "");
  }
  return new SafeHtml(out);
}

export function join(parts: unknown[], separator: SafeHtml | string = ""): SafeHtml {
  const sep = separator instanceof SafeHtml ? separator.value : escapeHtml(separator);
  return new SafeHtml(parts.map(renderValue).join(sep));
}

/** Renders a SafeHtml tree to a string (used at the response boundary). */
export function render(node: SafeHtml): string {
  return node.value;
}

export function attr(name: string, value: string | number | boolean | null | undefined): SafeHtml {
  if (value === null || value === undefined || value === false) return new SafeHtml("");
  if (value === true) return new SafeHtml(` ${name}`);
  return new SafeHtml(` ${name}="${escapeHtml(String(value))}"`);
}

export function attrs(map: Record<string, string | number | boolean | null | undefined>): SafeHtml {
  return new SafeHtml(
    Object.entries(map)
      .map(([key, value]) => attr(key, value).value)
      .join(""),
  );
}

export function nl2br(value: string): SafeHtml {
  return new SafeHtml(escapeHtml(value).replace(/\r?\n/g, "<br>"));
}

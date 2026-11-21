import { escapeHtml, SafeHtml } from "./html";

/**
 * Minimal, safe Markdown renderer for documentation pages.
 * Input is escaped first; only constructs produced here can emit markup.
 * Supports headings, paragraphs, lists, fenced code, blockquotes, tables,
 * horizontal rules and inline code / bold / italic / links.
 */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = /^(https?:\/\/|\/|#)/i.test(href) ? href : "#";
    const external = /^https?:\/\//i.test(safeHref);
    return `<a href="${escapeHtml(safeHref)}"${external ? ' rel="noopener noreferrer nofollow" target="_blank"' : ""}>${label}</a>`;
  });
  return out;
}

interface TableRow {
  cells: string[];
  header: boolean;
}

export function renderMarkdown(markdown: string): SafeHtml {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let tableRows: TableRow[] = [];
  let inBlockquote = false;
  let quoteLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (!inBlockquote) return;
    out.push(`<blockquote><p>${inline(quoteLines.join(" "))}</p></blockquote>`);
    quoteLines = [];
    inBlockquote = false;
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const header = tableRows[0]!;
    const body = tableRows.slice(1);
    out.push("<div class=\"md-table\"><table><thead><tr>" +
      header.cells.map((cell) => `<th>${inline(cell)}</th>`).join("") +
      "</tr></thead><tbody>" +
      body.map((row) => "<tr>" + row.cells.map((cell) => `<td>${inline(cell)}</td>`).join("") + "</tr>").join("") +
      "</tbody></table></div>");
    tableRows = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(
          `<pre class="md-code"><code data-lang="${escapeHtml(codeLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        flushParagraph();
        flushList();
        flushQuote();
        flushTable();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      out.push("<hr>");
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      inBlockquote = true;
      quoteLines.push(quote[1]!);
      continue;
    }
    flushQuote();

    const table = /^\|(.+)\|$/.exec(line.trim());
    if (table) {
      flushParagraph();
      flushList();
      const cells = table[1]!.split("|").map((cell) => cell.trim());
      const isDivider = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
      if (!isDivider) {
        tableRows.push({ cells, header: tableRows.length === 0 });
      }
      continue;
    }
    flushTable();

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        flushList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((bullet ?? ordered)![1]!)}</li>`);
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }

  if (inCode) {
    out.push(`<pre class="md-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  flushList();
  flushQuote();
  flushTable();
  return new SafeHtml(out.join("\n"));
}

/** Strip markdown for meta descriptions / excerpts. */
export function markdownExcerpt(markdown: string, maxLength = 160): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}

/**
 * RFC 4180 CSV reader. Hand-written rather than a dependency: the repo has no
 * CSV library, broker exports need only the core grammar (quoted fields,
 * doubled quotes, CRLF), and an incremental push() lets the browser feed a
 * large file chunk by chunk without holding a second copy in memory.
 */

export interface CsvRow {
  /** 1-based physical line on which the record starts. */
  line: number;
  cells: string[];
}

export class CsvStreamParser {
  private readonly rows: CsvRow[] = [];
  private cells: string[] = [];
  private field = "";
  private inQuotes = false;
  /** A quote seen inside a quoted field: either "" (literal quote) or the closing quote. */
  private pendingQuote = false;
  /** A CR seen outside quotes; a following LF belongs to the same line break. */
  private pendingCr = false;
  private atStart = true;
  private line = 1;
  private recordLine = 1;

  push(chunk: string): void {
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index]!;
      if (this.atStart) {
        this.atStart = false;
        if (character === "\uFEFF") continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (character === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (character === '"') this.pendingQuote = true;
        else {
          this.field += character;
          if (character === "\n") this.line += 1;
        }
        continue;
      }
      if (this.pendingCr) {
        this.pendingCr = false;
        if (character === "\n") continue;
      }
      if (character === '"' && this.field === "") this.inQuotes = true;
      else if (character === ",") this.endField();
      else if (character === "\r" || character === "\n") {
        this.pendingCr = character === "\r";
        this.endRecord();
        this.line += 1;
        this.recordLine = this.line;
      } else this.field += character;
    }
  }

  /** Flushes the final record and returns every non-blank record. */
  end(): CsvRow[] {
    if (this.inQuotes && !this.pendingQuote) throw new Error(`Unclosed quoted field starting on line ${this.recordLine}`);
    this.pendingQuote = false;
    this.inQuotes = false;
    if (this.field !== "" || this.cells.length > 0) this.endRecord();
    return this.rows;
  }

  private endField() {
    this.cells.push(this.field);
    this.field = "";
  }

  private endRecord() {
    this.endField();
    if (this.cells.some((cell) => cell.trim() !== "")) {
      this.rows.push({ line: this.recordLine, cells: this.cells.map((cell) => cell.trim()) });
    }
    this.cells = [];
  }
}

export function parseCsv(text: string): CsvRow[] {
  const parser = new CsvStreamParser();
  parser.push(text);
  return parser.end();
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

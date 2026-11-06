/**
 * RFC 4180 CSV reader. Hand-written rather than a dependency: the repo has no
 * CSV library, broker exports need only the core grammar (quoted fields,
 * doubled quotes, CRLF), and an incremental push() lets the browser feed a
 * large file chunk by chunk without holding a second copy in memory. A tab
 * delimiter covers Excel's "Unicode text" export.
 */

/**
 * Import limits. Measured in Bun on a generated Zerodha tradebook: 500,000
 * rows (49 MB) took 1.4 s to parse and 2.7 s to analyse on one thread with
 * ~350 MB of heap; 200,000 rows (20 MB) took 0.6 s and 1.0 s. Analysis runs on
 * the page's thread, so the limits keep it near a second. A retail tradebook
 * holds a few thousand rows a year.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 200_000;

export type CsvDelimiter = "," | "\t";

/**
 * Picks the delimiter from the header record: tab when it has more tabs than
 * commas. Semicolon-separated files (European Excel locales) are refused: their
 * numbers use decimal commas, which the Indian-format amount parser would read
 * as thousands separators.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let inQuotes = false;
  for (const character of text) {
    if (character === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (character === "\n" || character === "\r")) break;
    else if (!inQuotes && character in counts) counts[character as keyof typeof counts] += 1;
  }
  if (counts["\t"] > counts[","]) return "\t";
  if (counts[";"] > counts[","]) {
    throw new Error("The file is semicolon-separated. Save it as comma-separated CSV: decimal commas cannot be told from thousands separators.");
  }
  return ",";
}

export interface CsvRow {
  /** 1-based physical line on which the record starts. */
  line: number;
  cells: string[];
}

export class CsvStreamParser {
  private readonly rows: CsvRow[] = [];
  private readonly delimiter: CsvDelimiter;
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

  constructor({ delimiter = "," }: { delimiter?: CsvDelimiter } = {}) {
    this.delimiter = delimiter;
  }

  /** Non-blank records completed so far, header included, so a reader can stop at a limit. */
  get recordCount(): number {
    return this.rows.length;
  }

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
      else if (character === this.delimiter) this.endField();
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

/** A text cell starting with one of these is evaluated as a formula by Excel, Sheets or LibreOffice. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Writes RFC 4180 CSV that is safe to open in a spreadsheet (OWASP CSV
 * injection): a text cell starting with = + - @ TAB or CR gets a leading
 * single quote, so "=HYPERLINK(...)" from an imported file opens as text.
 * The cell's type decides: a `number` is written as is, so -21293.75 stays a
 * number, while a string is always text, even "-12.5", because toCsv cannot
 * tell a figure from untrusted file content. Callers pass figures as numbers.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const escape = (value: string | number) => {
    const text = typeof value === "number" ? String(value) : FORMULA_TRIGGER.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

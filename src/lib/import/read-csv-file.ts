import { CsvStreamParser, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, sniffDelimiter, type CsvDelimiter, type CsvRow } from "@shared/domain/investing/import/csv";

const ENCODING_LABELS = { "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252" } as const;
type Encoding = keyof typeof ENCODING_LABELS;

export interface CsvFile {
  headers: string[];
  rows: CsvRow[];
  encoding: (typeof ENCODING_LABELS)[Encoding];
  delimiter: CsvDelimiter;
}

const SPLIT_ADVICE = "Export one financial year at a time.";

/** Files people pick by mistake, named so the error says what to do instead. */
const SIGNATURES: Array<[number[], string]> = [
  [[0x50, 0x4b, 0x03, 0x04], "This is an Excel workbook (.xlsx) or another zip archive, not a CSV. In Excel use File > Save As > CSV UTF-8."],
  [[0xd0, 0xcf, 0x11, 0xe0], "This is an Excel 97-2003 workbook (.xls), not a CSV. In Excel use File > Save As > CSV UTF-8."],
  [[0x25, 0x50, 0x44, 0x46], "This is a PDF, not a CSV. Download the tradebook from your broker as CSV."],
];

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((byte, index) => bytes[index] === byte);

/**
 * A byte-order mark decides (Excel's "CSV UTF-8" writes EF BB BF, its
 * "Unicode text" FF FE); otherwise the file is tried as UTF-8. NUL bytes
 * without a UTF-16 mark mean binary data, never a broker CSV.
 */
function sniffEncoding(head: Uint8Array): Encoding {
  if (startsWith(head, [0xef, 0xbb, 0xbf])) return "utf-8";
  if (startsWith(head, [0xff, 0xfe])) return "utf-16le";
  if (startsWith(head, [0xfe, 0xff])) return "utf-16be";
  for (const [signature, message] of SIGNATURES) if (startsWith(head, signature)) throw new Error(message);
  if (head.includes(0)) throw new Error("This is not a text CSV file: it contains binary data. Download the tradebook from your broker as CSV.");
  return "utf-8";
}

class InvalidUtf8 extends Error {}

async function parseAs(file: File, encoding: Encoding, onProgress: (fraction: number) => void) {
  const reader = file.stream().getReader();
  // Fatal for UTF-8 only, so bytes that are not UTF-8 restart the read as Windows-1252 instead of becoming U+FFFD.
  const decoder = new TextDecoder(encoding, { fatal: encoding === "utf-8" });
  const decode = (bytes?: Uint8Array) => {
    try {
      return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    } catch {
      throw new InvalidUtf8();
    }
  };
  let parser: CsvStreamParser | undefined;
  let delimiter: CsvDelimiter = ",";
  // One header record plus the data rows.
  const checkRowLimit = (records: number) => {
    if (records <= MAX_IMPORT_ROWS + 1) return;
    const limit = MAX_IMPORT_ROWS.toLocaleString("en-IN");
    throw new Error(`The file has more than ${limit} rows; the limit is ${limit}. ${SPLIT_ADVICE}`);
  };
  const push = (text: string) => {
    if (!parser && text === "") return;
    if (!parser) {
      delimiter = sniffDelimiter(text);
      parser = new CsvStreamParser({ delimiter });
    }
    parser.push(text);
    checkRowLimit(parser.recordCount);
  };
  let bytesRead = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      push(decode(value));
      onProgress(file.size > 0 ? bytesRead / file.size : 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    push(decode());
  } catch (caught) {
    await reader.cancel();
    throw caught;
  }
  const records = parser?.end() ?? [];
  checkRowLimit(records.length);
  return { records, delimiter };
}

/**
 * Streams a local File through the CSV parser in the browser's own chunks,
 * yielding to the event loop between them so a large tradebook keeps the page
 * responsive and the progress bar moving. Nothing is uploaded. Files over the
 * size limit are refused before a byte is read; the row limit stops the read
 * as soon as it is passed.
 */
export async function readCsvFile(file: File, onProgress: (fraction: number) => void): Promise<CsvFile> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMPORT_BYTES / 1024 / 1024} MB. ${SPLIT_ADVICE}`);
  }
  let encoding = sniffEncoding(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  const parsed = await parseAs(file, encoding, onProgress).catch((caught: unknown) => {
    if (!(caught instanceof InvalidUtf8)) throw caught;
    // Excel's plain "CSV" on Windows writes the ANSI code page; every byte decodes in Windows-1252.
    encoding = "windows-1252";
    return parseAs(file, encoding, onProgress);
  });
  const [header, ...rows] = parsed.records;
  if (!header) throw new Error("The file is empty.");
  if (rows.length === 0) throw new Error("The file has a header row but no trades.");
  return { headers: header.cells, rows, encoding: ENCODING_LABELS[encoding], delimiter: parsed.delimiter };
}

export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

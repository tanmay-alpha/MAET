import { CsvStreamParser, type CsvRow } from "@shared/domain/investing/import/csv";

/**
 * Streams a local File through the CSV parser in the browser's own chunks,
 * yielding to the event loop between them so a large tradebook keeps the page
 * responsive and the progress bar moving. Nothing is uploaded.
 */
export async function readCsvFile(file: File, onProgress: (fraction: number) => void): Promise<CsvRow[]> {
  const parser = new CsvStreamParser();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let bytesRead = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    parser.push(decoder.decode(value, { stream: true }));
    onProgress(file.size > 0 ? bytesRead / file.size : 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  parser.push(decoder.decode());
  return parser.end();
}

export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

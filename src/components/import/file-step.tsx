import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, type CsvRow } from "@shared/domain/investing/import/csv";
import { detectFormat, FORMAT_LABELS, guessMapping, isMappingComplete, type BrokerFormat, type ColumnMapping } from "@shared/domain/investing/import/normalize";
import { SAMPLE_TRADEBOOK_CSV, SAMPLE_TRADEBOOK_NAME } from "@shared/domain/investing/import/sample";
import { readCsvFile } from "@/lib/import/read-csv-file";

export interface LoadedFile {
  name: string;
  sample: boolean;
  headers: string[];
  rows: CsvRow[];
  /** How the bytes were read, shown when it is not plain comma-separated UTF-8. */
  readAs?: string;
}

export interface FileChoice {
  file: LoadedFile;
  format: BrokerFormat;
  mapping?: ColumnMapping;
}

const MAPPED_FIELDS: Array<{ key: keyof ColumnMapping; label: string; optional?: boolean }> = [
  { key: "date", label: "Trade date" },
  { key: "symbol", label: "Symbol" },
  { key: "side", label: "Buy / sell" },
  { key: "quantity", label: "Quantity" },
  { key: "price", label: "Price" },
  { key: "tradeId", label: "Trade id", optional: true },
];

const selectClass = "rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground";

export function FileStep({ initial, onContinue }: { initial?: FileChoice; onContinue: (choice: FileChoice) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState(initial?.file);
  const [format, setFormat] = useState<BrokerFormat>(initial?.format ?? "generic");
  const [mapping, setMapping] = useState(initial?.mapping ?? (initial && guessMapping(initial.file.headers)));
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();

  function accept(loaded: LoadedFile) {
    setFile(loaded);
    setFormat(detectFormat(loaded.headers) ?? "generic");
    setMapping(guessMapping(loaded.headers));
  }

  async function readFile(selected: File) {
    setError(undefined);
    setFile(undefined);
    setProgress(0);
    try {
      const { headers, rows, encoding, delimiter } = await readCsvFile(selected, setProgress);
      const readAs = encoding === "UTF-8" && delimiter === "," ? undefined : `${encoding}, ${delimiter === "\t" ? "tab" : "comma"}-separated`;
      accept({ name: selected.name, sample: false, headers, rows, readAs });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProgress(undefined);
    }
  }

  function loadSample() {
    setError(undefined);
    const [header, ...rows] = parseCsv(SAMPLE_TRADEBOOK_CSV);
    accept({ name: SAMPLE_TRADEBOOK_NAME, sample: true, headers: header!.cells, rows });
  }

  const detected = file ? detectFormat(file.headers) : null;
  const ready = file && (format !== "generic" || (mapping && isMappingComplete(mapping)));

  return <section aria-labelledby="file-step-heading" className="border border-border bg-panel p-4 text-xs">
    <h2 id="file-step-heading" className="text-sm font-semibold">Choose a tradebook</h2>
    <p className="mt-1 text-muted-foreground">Zerodha Console tradebook or Groww order history (CSV) are recognised from their headers; any other CSV can be mapped column by column. Up to {MAX_IMPORT_BYTES / 1024 / 1024} MB or {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows.</p>
    <p className="mt-1 text-foreground">Your file is read in this browser tab only. Nothing is sent or stored.</p>

    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={progress !== undefined}
        className="flex items-center gap-1.5 rounded border border-primary bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">
        <FileUp className="h-3.5 w-3.5" aria-hidden /> Choose CSV file
      </button>
      <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" aria-label="Tradebook CSV file" className="sr-only"
        onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void readFile(selected); }} />
      <button type="button" onClick={loadSample} className="rounded border border-border px-3 py-1.5 hover:bg-accent">Load sample tradebook</button>
      <span className="text-muted-foreground">The sample is invented data in Zerodha format.</span>
    </div>

    {progress !== undefined && <div className="mt-3" role="status">
      <progress value={progress} max={1} aria-label="Reading file" className="h-1.5 w-full max-w-sm accent-primary" />
      <span className="ml-2 font-mono tabular-nums">{Math.round(progress * 100)}%</span>
    </div>}
    {error && <p role="alert" className="mt-3 text-bear">Could not read the file: {error}</p>}

    {file && <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{file.name}</span>
        {file.sample && <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Sample data</span>}
        <span className="text-muted-foreground">{file.rows.length} data rows{file.readAs && ` · read as ${file.readAs}`} · {detected ? `detected ${FORMAT_LABELS[detected]}` : "format not recognised: map the columns below"}</span>
      </div>
      <label className="mt-2 flex items-center gap-2">Format
        <select aria-label="File format" value={format} onChange={(event) => setFormat(event.target.value as BrokerFormat)} className={selectClass}>
          {(Object.keys(FORMAT_LABELS) as BrokerFormat[]).map((key) => <option key={key} value={key}>{FORMAT_LABELS[key]}</option>)}
        </select>
      </label>
      {format === "generic" && mapping && <fieldset className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-muted-foreground">Map columns. Dates may be YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY; side must read buy/sell.</legend>
        {MAPPED_FIELDS.map(({ key, label, optional }) => <label key={key} className="flex items-center justify-between gap-2">{label}
          <select aria-label={`${label} column`} value={mapping[key]} onChange={(event) => setMapping({ ...mapping, [key]: Number(event.target.value) })} className={`${selectClass} w-40`}>
            <option value={-1}>{optional ? "None" : "Choose…"}</option>
            {file.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
          </select>
        </label>)}
      </fieldset>}
      <button type="button" disabled={!ready} onClick={() => onContinue({ file, format, mapping: format === "generic" ? mapping : undefined })}
        className="mt-3 rounded border border-primary bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">
        Review rows
      </button>
    </div>}
  </section>;
}

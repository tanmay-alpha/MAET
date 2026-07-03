const NIFTY_500_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv";

export type NseIndexConstituent = {
  symbol: string;
  name: string;
  industry: string;
  isin: string;
};

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

export function parseNseIndexCsv(csv: string): NseIndexConstituent[] {
  const lines = csv.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((header) => header.toUpperCase());
  const column = (name: string) => headers.indexOf(name);
  const nameColumn = column("COMPANY NAME");
  const industryColumn = column("INDUSTRY");
  const symbolColumn = column("SYMBOL");
  const seriesColumn = column("SERIES");
  const isinColumn = column("ISIN CODE");
  if ([nameColumn, symbolColumn, seriesColumn, isinColumn].some((index) => index < 0)) {
    throw new Error("NSE index CSV is missing required columns");
  }

  const entries = lines.slice(1).flatMap((line): NseIndexConstituent[] => {
    const row = parseCsvRow(line);
    const symbol = row[symbolColumn]?.trim().toUpperCase();
    if (row[seriesColumn]?.trim().toUpperCase() !== "EQ" || !symbol || !/^[A-Z0-9&.-]+$/u.test(symbol)) return [];
    return [{
      symbol,
      name: row[nameColumn]?.trim() || symbol,
      industry: row[industryColumn]?.trim() || "",
      isin: row[isinColumn]?.trim() || "",
    }];
  });
  return [...new Map(entries.map((entry) => [entry.symbol, entry])).values()];
}

export async function getNifty500Constituents(): Promise<NseIndexConstituent[]> {
  const response = await fetch(NIFTY_500_URL, {
    headers: { "user-agent": "MAET market scanner/1.0", accept: "text/csv" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`NSE Nifty 500 list returned HTTP ${response.status}`);
  const entries = parseNseIndexCsv(await response.text());
  if (entries.length < 450) throw new Error(`NSE Nifty 500 list returned only ${entries.length} EQ companies`);
  return entries;
}

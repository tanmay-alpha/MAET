import { describe, expect, it } from "bun:test";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@shared/domain/investing/import/csv";
import { readCsvFile } from "./read-csv-file";

const read = (parts: BlobPart[], name = "tradebook.csv") => readCsvFile(new File(parts, name), () => {});

function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([0xff, 0xfe]);
  for (let index = 0; index < text.length; index += 1) {
    bytes[2 + index * 2] = text.charCodeAt(index) & 0xff;
    bytes[3 + index * 2] = text.charCodeAt(index) >> 8;
  }
  return bytes;
}

describe("readCsvFile encodings", () => {
  it("reads UTF-8 with a BOM, including ₹ split across chunks", async () => {
    const file = await read(["\uFEFFsymbol,price\r\nINFY,\"₹1,480.50\"\r\n"]);
    expect(file).toMatchObject({ encoding: "UTF-8", delimiter: ",", headers: ["symbol", "price"] });
    expect(file.rows.map((row) => row.cells)).toEqual([["INFY", "₹1,480.50"]]);
  });

  it("reads Excel 'Unicode text': UTF-16 LE with a BOM, tab-separated", async () => {
    const file = await read([utf16le("Symbol\tDate\tSide\tQty\tPrice\r\nNESTLÉ\t15-01-2024\tBuy\t2\t2450\r\n")], "export.txt");
    expect(file).toMatchObject({ encoding: "UTF-16 LE", delimiter: "\t", headers: ["Symbol", "Date", "Side", "Qty", "Price"] });
    expect(file.rows.map((row) => row.cells)).toEqual([["NESTLÉ", "15-01-2024", "Buy", "2", "2450"]]);
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8", async () => {
    // "Nestlé" saved by Excel as "CSV (Comma delimited)" on Windows: é is the single byte 0xE9.
    const bytes = new Uint8Array([...new TextEncoder().encode("name,qty\r\nNestl"), 0xe9, ...new TextEncoder().encode(",2\r\n")]);
    const file = await read([bytes]);
    expect(file.encoding).toBe("Windows-1252");
    expect(file.rows[0]!.cells).toEqual(["Nestlé", "2"]);
  });
});

describe("readCsvFile rejects what it cannot read", () => {
  it("names an Excel workbook instead of decoding zip bytes as text", async () => {
    await expect(read([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])], "tradebook.xlsx")).rejects.toThrow(/Excel workbook/);
  });

  it("refuses other binary files", async () => {
    await expect(read([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])], "chart.png")).rejects.toThrow(/not a text CSV/);
  });

  it("explains an empty file and a header with no trades", async () => {
    await expect(read([""])).rejects.toThrow("The file is empty.");
    await expect(read(["\r\n\r\n"])).rejects.toThrow("The file is empty.");
    await expect(read(["symbol,trade_date,trade_type,quantity,price\r\n"])).rejects.toThrow("The file has a header row but no trades.");
  });

  it("refuses a semicolon-separated file instead of misreading decimal commas", async () => {
    await expect(read(["symbol;qty;price\nINFY;2;1480,50\n"])).rejects.toThrow(/semicolon/i);
  });

  it("refuses a file over the size limit without reading it", async () => {
    let pulled = false;
    const file = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "huge.csv");
    file.stream = () => {
      pulled = true;
      throw new Error("read");
    };
    await expect(readCsvFile(file, () => {})).rejects.toThrow("The file is 25.0 MB; the limit is 25 MB. Export one financial year at a time.");
    expect(pulled).toBe(false);
  });

  it("stops reading once the row limit is passed", async () => {
    const text = `h\n${"1\n".repeat(MAX_IMPORT_ROWS + 1)}`;
    await expect(read([text])).rejects.toThrow("The file has more than 2,00,000 rows; the limit is 2,00,000. Export one financial year at a time.");
    const atLimit = await read([`h\n${"1\n".repeat(MAX_IMPORT_ROWS)}`]);
    expect(atLimit.rows).toHaveLength(MAX_IMPORT_ROWS);
  });
});

import { createQueryProcedure } from "@/lib/trpc";
import type {
  CompletedRunSummary,
  CsvExport,
  CsvKind,
  RunComparison,
  RunReport,
} from "../../../server/modules/research-reports/contracts";

export type { CompletedRunSummary, CsvKind, RunComparison, RunReport };

/** researchReports procedures (server/api/trpc/routers/research-reports.ts). */
export const researchReports = {
  listRuns: createQueryProcedure<{ limit?: number } | undefined, { runs: CompletedRunSummary[] }>("researchReports.listRuns"),
  getReport: createQueryProcedure<{ jobId: string }, RunReport>("researchReports.getReport"),
  exportCsv: createQueryProcedure<{ jobId: string; kind: CsvKind }, CsvExport>("researchReports.exportCsv"),
  compare: createQueryProcedure<{ jobIds: string[] }, RunComparison>("researchReports.compare"),
};

/** Saves text as a file through a temporary object URL. */
export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked after the click has been handled; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

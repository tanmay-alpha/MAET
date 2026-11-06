import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { analyseImport } from "@shared/domain/investing/import/analyse";
import { FileStep, type FileChoice } from "@/components/import/file-step";
import { ReviewStep } from "@/components/import/review-step";
import { ResultsStep } from "@/components/import/results-step";

export const Route = createFileRoute("/_app/import")({
  head: () => ({
    meta: [
      { title: "Import portfolio — MAET" },
      { name: "description", content: "Analyse a Zerodha or Groww tradebook in the browser: FIFO holdings, realised STCG/LTCG by financial year and XIRR." },
    ],
  }),
  component: ImportPage,
});

const STEPS = ["File", "Review", "Results"] as const;

function ImportPage() {
  const [choice, setChoice] = useState<FileChoice>();
  const [step, setStep] = useState<(typeof STEPS)[number]>("File");
  const analysis = useMemo(
    () => choice && analyseImport(choice.format, choice.file.headers, choice.file.rows, choice.mapping),
    [choice],
  );

  return <div className="mx-auto max-w-7xl px-4 py-6">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold">Import portfolio</h1>
        <p className="text-xs text-muted-foreground">Analyse a broker tradebook: FIFO holdings, realised gains by financial year and XIRR.</p>
      </div>
      <ol aria-label="Steps" className="flex gap-3 text-xs">
        {STEPS.map((name, index) => <li key={name} aria-current={step === name ? "step" : undefined}
          className={step === name ? "font-semibold text-foreground" : "text-muted-foreground"}>{index + 1}. {name}</li>)}
      </ol>
    </div>
    {step === "File" || !choice || !analysis
      ? <FileStep initial={choice} onContinue={(next) => { setChoice(next); setStep("Review"); }} />
      : step === "Review"
        ? <ReviewStep analysis={analysis} headers={choice.file.headers} onBack={() => setStep("File")} onContinue={() => setStep("Results")} />
        : <ResultsStep analysis={analysis} onBack={() => setStep("Review")} />}
  </div>;
}

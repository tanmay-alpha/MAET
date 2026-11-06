import { INDEX_CONTRACT_DEFAULTS } from "@shared/domain/options/index-contracts";
import { visibleContractErrors, type ContractDraft, type ContractErrors } from "@/lib/payoff-lab-state";
import { Field, INPUT_CLASS, decimalDraft } from "./field";

interface ContractInputsProps {
  value: ContractDraft;
  errors: ContractErrors;
  daysToExpiry: number | null;
  onChange: (patch: Partial<ContractDraft>) => void;
  onSymbolChange: (symbol: string) => void;
}

const INDEX_SYMBOLS = Object.keys(INDEX_CONTRACT_DEFAULTS);
const INDEX_LOTS = Object.entries(INDEX_CONTRACT_DEFAULTS)
  .map(([symbol, defaults]) => `${symbol} ${defaults.lotSize}`)
  .join(", ");

export function ContractInputs({ value, errors: allErrors, daysToExpiry, onChange, onSymbolChange }: ContractInputsProps) {
  const errors = visibleContractErrors(value, allErrors);
  const decimal = (key: "spot" | "lotSize" | "strikeStep" | "rate" | "iv") => ({
    value: value[key],
    "aria-invalid": errors[key] !== undefined,
    inputMode: "decimal" as const,
    autoComplete: "off",
    className: INPUT_CLASS,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: decimalDraft(event.target.value) }),
  });

  return (
    <section aria-label="Contract" className="rounded border border-border bg-panel px-3 py-2.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 xl:grid-cols-8">
        <Field label="Underlying" error={errors.symbol}>
          <input
            className={`${INPUT_CLASS} uppercase`}
            value={value.symbol}
            aria-invalid={errors.symbol !== undefined}
            list="payoff-index-symbols"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onSymbolChange(event.target.value)}
          />
          <datalist id="payoff-index-symbols">
            {INDEX_SYMBOLS.map((symbol) => (
              <option key={symbol} value={symbol} />
            ))}
          </datalist>
        </Field>
        <Field label="Spot" error={errors.spot}>
          <input {...decimal("spot")} placeholder="e.g. 24010" />
        </Field>
        <Field label="Lot size" error={errors.lotSize}>
          <input {...decimal("lotSize")} inputMode="numeric" />
        </Field>
        <Field label="Strike step" error={errors.strikeStep}>
          <input {...decimal("strikeStep")} />
        </Field>
        <Field label="Expiry" error={errors.expiry}>
          <input
            type="date"
            className={INPUT_CLASS}
            value={value.expiry}
            aria-invalid={errors.expiry !== undefined}
            onChange={(event) => onChange({ expiry: event.target.value })}
          />
        </Field>
        <Field label="Days to expiry">
          <output className={`${INPUT_CLASS} flex items-center text-muted-foreground`}>
            {daysToExpiry === null ? "—" : daysToExpiry}
          </output>
        </Field>
        <Field label="Rate %" error={errors.rate}>
          <input {...decimal("rate")} />
        </Field>
        <Field label="IV %" error={errors.iv}>
          <input {...decimal("iv")} />
        </Field>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Index lots per NSE circular NSE/FAOP/70616 (Oct 2025): {INDEX_LOTS}. Stock option lots vary by stock. Every
        field is editable.
      </p>
    </section>
  );
}

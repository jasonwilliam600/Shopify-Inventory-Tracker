export const INDIVIDUAL_CORRECTION_REASONS = [
  "Manually verified product match",
  "Manufacturer prefix exception",
  "Supplier SKU formatting difference",
  "Incorrect previous mapping",
  "Selling unit / package quantity exception",
  "Other reason",
] as const;

export type IndividualCorrectionReason = typeof INDIVIDUAL_CORRECTION_REASONS[number];

/** Keep the existing API's plain reason string and 12–2000 character limits. */
export function resolveIndividualReason(choice: string, other: string): string {
  if (!INDIVIDUAL_CORRECTION_REASONS.some(reason => reason === choice)) return "";
  const reason = choice === "Other reason" ? other.trim() : choice;
  return reason.length >= 12 && reason.length <= 2000 ? reason : "";
}

export function IndividualCorrectionReasonField({ choice, other, onChoice, onOther }: {
  choice: IndividualCorrectionReason;
  other: string;
  onChoice: (choice: IndividualCorrectionReason) => void;
  onOther: (other: string) => void;
}) {
  return <>
    <label className="center-field center-reason">
      <span>Reason for individual correction <b>Required</b></span>
      <select value={choice} onChange={event => onChoice(event.target.value as IndividualCorrectionReason)}
        required data-testid="select-center-individual-reason">
        {INDIVIDUAL_CORRECTION_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
      </select>
    </label>
    {choice === "Other reason" && <label className="center-field center-reason">
      <span>Other reason <b>Required · at least 12 characters</b></span>
      <textarea value={other} onChange={event => onOther(event.target.value)} rows={3}
        required minLength={12} maxLength={2000}
        placeholder="Explain the reason for this individual correction."
        data-testid="input-center-individual-reason" />
    </label>}
  </>;
}

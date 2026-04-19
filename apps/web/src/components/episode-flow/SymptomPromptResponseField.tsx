'use client';

import type {
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomResponseType,
} from '@abstrack/types';

/** Visible focus ring on the card when the visually hidden radio is focused with keyboard (see `sr-only` inputs). */
const radioLabelFocusVisibleClass =
  'has-[input:focus-visible]:outline-none has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-app-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-app-bg';

export type SymptomPromptResponseFieldProps = {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer | undefined;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
};

function defaultAnswerForType(type: SymptomResponseType): SymptomPromptAnswer {
  switch (type) {
    case 'yes_no':
      return { type: 'yes_no', value: null };
    case 'severity_scale':
      return { type: 'severity_scale', value: null };
    case 'free_text':
      return { type: 'free_text', value: '' };
    case 'photo':
      return { type: 'photo', value: null };
    case 'video':
      return { type: 'video', value: null };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Renders the capture UI for one preset symptom line (Week 5 skeleton: no media pipeline).
 *
 * @param props - Line metadata, current answer, change handler, disabled flag.
 * @returns Response-type-specific controls.
 */
export function SymptomPromptResponseField({
  line,
  answer,
  onChange,
  disabled,
}: SymptomPromptResponseFieldProps) {
  const effective = answer ?? defaultAnswerForType(line.response_type);

  switch (line.response_type) {
    case 'yes_no': {
      const v = effective.type === 'yes_no' ? effective.value : null;
      return (
        <div
          role="radiogroup"
          aria-label={`${line.symptom_name} yes or no`}
          className="flex flex-col gap-3"
        >
          {(['yes', 'no'] as const).map((which) => {
            const boolVal = which === 'yes';
            const selected = v === boolVal;
            return (
              <label
                key={which}
                className={`flex min-h-[56px] cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
                  selected
                    ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                    : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`symptom-yesno-${line.id}`}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => {
                    onChange({ type: 'yes_no', value: boolVal });
                  }}
                />
                <span className="capitalize">{which}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case 'severity_scale': {
      const sev = effective.type === 'severity_scale' ? effective.value : null;
      return (
        <div
          role="radiogroup"
          aria-label={`${line.symptom_name} severity 1 to 5`}
          className="flex flex-wrap gap-2"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = sev === n;
            return (
              <label
                key={n}
                className={`flex h-14 min-w-[52px] cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
                  selected
                    ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                    : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`symptom-sev-${line.id}`}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => {
                    onChange({ type: 'severity_scale', value: n });
                  }}
                />
                {n}
              </label>
            );
          })}
        </div>
      );
    }
    case 'free_text': {
      const text = effective.type === 'free_text' ? effective.value : '';
      return (
        <textarea
          id={`symptom-text-${line.id}`}
          aria-label={`${line.symptom_name} notes`}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            onChange({ type: 'free_text', value: e.target.value });
          }}
          placeholder="Type a short note (optional)"
          rows={5}
          className="w-full rounded-xl border border-app-border/90 bg-app-surface p-4 text-base text-app-ink shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-50"
        />
      );
    }
    case 'photo':
      return (
        <div
          role="status"
          className="rounded-xl border border-dashed border-app-border/90 bg-app-surface/80 p-6 text-center text-sm leading-relaxed text-app-ink"
        >
          Photo capture will open here during an episode. This step is a
          placeholder for now.
        </div>
      );
    case 'video':
      return (
        <div
          role="status"
          className="rounded-xl border border-dashed border-app-border/90 bg-app-surface/80 p-6 text-center text-sm leading-relaxed text-app-ink"
        >
          Video capture will open here during an episode. This step is a
          placeholder for now.
        </div>
      );
    default: {
      const _exhaustive: never = line.response_type;
      return _exhaustive;
    }
  }
}

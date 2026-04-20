'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PresetSymptomRow, SymptomPromptAnswer } from '@abstrack/types';
import { createDefaultSymptomPromptAnswer } from '@abstrack/types';

/** Visible focus ring on keyboard-focused radio buttons (`button[role="radio"]`). */
const radioLabelFocusVisibleClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

export type SymptomPromptResponseFieldProps = {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer | undefined;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
};

type YesNoValue = boolean | null;

function SymptomYesNoRadiogroup({
  line,
  v,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  v: YesNoValue;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /**
   * When `v` is null (no selection / deselected), keeps the tab stop on the last-focused or
   * last-clicked option so focus does not stay on a button with `tabIndex={-1}`.
   */
  const [rovingIdx, setRovingIdx] = useState(0);
  useLayoutEffect(() => {
    if (v === true) {
      setRovingIdx(0);
    } else if (v === false) {
      setRovingIdx(1);
    } else {
      const ae =
        typeof document !== 'undefined' ? document.activeElement : null;
      const i = itemRefs.current.findIndex((el) => el === ae);
      if (i >= 0) {
        setRovingIdx(i);
      }
    }
  }, [v]);
  const tabStopIndex = v === null ? rovingIdx : v === true ? 0 : 1;

  const getFocusedIdx = (): number => {
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const i = itemRefs.current.findIndex((el) => el === ae);
    return i >= 0 ? i : tabStopIndex;
  };

  const moveTo = (nextIdx: number) => {
    const boolVal = nextIdx === 0;
    onChange({
      type: 'yes_no',
      value: boolVal,
    });
    requestAnimationFrame(() => {
      itemRefs.current[nextIdx]?.focus();
    });
  };

  const onGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const len = 2;
    const cur = getFocusedIdx();
    const { key } = e;
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault();
      moveTo((cur + 1) % len);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault();
      moveTo((cur - 1 + len) % len);
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      moveTo(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      moveTo(len - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={`${line.symptom_name} yes or no`}
      className="flex flex-col gap-3"
      onKeyDown={onGroupKeyDown}
    >
      {(['yes', 'no'] as const).map((which, i) => {
        const boolVal = which === 'yes';
        const selected = v === boolVal;
        return (
          <button
            key={which}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={which}
            tabIndex={i === tabStopIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              const next = selected ? null : boolVal;
              onChange({
                type: 'yes_no',
                value: next,
              });
              if (next === null) {
                requestAnimationFrame(() => {
                  itemRefs.current[i]?.focus();
                });
              }
            }}
            className={`flex min-h-[56px] cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
              selected
                ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span className="capitalize">{which}</span>
          </button>
        );
      })}
    </div>
  );
}

function SymptomSeverityRadiogroup({
  line,
  sev,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  sev: number | null;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = [1, 2, 3, 4, 5] as const;
  const len = values.length;
  /** When `sev` is null, preserves roving tab stop after deselect (same idea as yes/no). */
  const [rovingIdx, setRovingIdx] = useState(0);
  useLayoutEffect(() => {
    if (sev !== null) {
      setRovingIdx(sev - 1);
    } else {
      const ae =
        typeof document !== 'undefined' ? document.activeElement : null;
      const i = itemRefs.current.findIndex((el) => el === ae);
      if (i >= 0) {
        setRovingIdx(i);
      }
    }
  }, [sev]);
  const tabStopIndex = sev !== null ? sev - 1 : rovingIdx;

  const getFocusedIdx = (): number => {
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const i = itemRefs.current.findIndex((el) => el === ae);
    return i >= 0 ? i : tabStopIndex;
  };

  const moveTo = (index: number) => {
    const n = values[index];
    onChange({
      type: 'severity_scale',
      value: n,
    });
    requestAnimationFrame(() => {
      itemRefs.current[index]?.focus();
    });
  };

  const onGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const cur = getFocusedIdx();
    const { key } = e;
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault();
      moveTo((cur + 1) % len);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault();
      moveTo((cur - 1 + len) % len);
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      moveTo(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      moveTo(len - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={`${line.symptom_name} severity 1 to 5`}
      className="flex flex-wrap gap-2"
      onKeyDown={onGroupKeyDown}
    >
      {values.map((n, i) => {
        const selected = sev === n;
        return (
          <button
            key={n}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Severity ${n}`}
            tabIndex={i === tabStopIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              const next = selected ? null : n;
              onChange({
                type: 'severity_scale',
                value: next,
              });
              if (next === null) {
                requestAnimationFrame(() => {
                  itemRefs.current[i]?.focus();
                });
              }
            }}
            className={`flex h-14 min-w-[52px] cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
              selected
                ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
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
  const effective =
    answer ?? createDefaultSymptomPromptAnswer(line.response_type);

  switch (line.response_type) {
    case 'yes_no': {
      const v = effective.type === 'yes_no' ? effective.value : null;
      return (
        <SymptomYesNoRadiogroup
          line={line}
          v={v}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    case 'severity_scale': {
      const sev = effective.type === 'severity_scale' ? effective.value : null;
      return (
        <SymptomSeverityRadiogroup
          line={line}
          sev={sev}
          onChange={onChange}
          disabled={disabled}
        />
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
          Photo symptom capture is coming in a later update. For now, use Next
          or Skip symptom to continue this episode flow.
        </div>
      );
    case 'video':
      return (
        <div
          role="status"
          className="rounded-xl border border-dashed border-app-border/90 bg-app-surface/80 p-6 text-center text-sm leading-relaxed text-app-ink"
        >
          Video symptom capture is coming in a later update. For now, use Next
          or Skip symptom to continue this episode flow.
        </div>
      );
    default: {
      const _exhaustive: never = line.response_type;
      return _exhaustive;
    }
  }
}

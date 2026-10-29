import { PRESET_LABEL, presetRange } from '../lib/dates';
import type { DateRange, RangePreset } from '../lib/dates';
import { Field } from './ui';

export interface RangeState {
  preset: RangePreset;
  range: DateRange;
}

export const initialRange = (): RangeState => ({ preset: 'today', range: presetRange('today') });

const chip = (on: boolean) =>
  `min-h-10 rounded-full px-3.5 text-sm font-bold ring-1 ring-line ${on ? 'bg-pri text-pri-ink' : 'bg-surface text-muted hover:bg-bg'}`;

/** Preset chips (Hari ini / 7 hari / Bulan ini) plus a custom from–to range. */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: RangeState;
  onChange: (next: RangeState) => void;
}) {
  const presets = ['today', '7d', 'month'] as const;
  return (
    <div>
      <div role="group" aria-label="Rentang tanggal" className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value.preset === p}
            className={chip(value.preset === p)}
            onClick={() => onChange({ preset: p, range: presetRange(p) })}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          className={chip(value.preset === 'custom')}
          onClick={() => onChange({ ...value, preset: 'custom' })}
        >
          {PRESET_LABEL.custom}
        </button>
      </div>
      {value.preset === 'custom' ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field
            label="Dari"
            type="date"
            value={value.range.from}
            max={value.range.to}
            onChange={(e) =>
              e.target.value &&
              onChange({ ...value, range: { ...value.range, from: e.target.value } })
            }
          />
          <Field
            label="Sampai"
            type="date"
            value={value.range.to}
            min={value.range.from}
            onChange={(e) =>
              e.target.value &&
              onChange({ ...value, range: { ...value.range, to: e.target.value } })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

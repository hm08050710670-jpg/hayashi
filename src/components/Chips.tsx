interface ChipOption<T> {
  value: T;
  label: string;
}

interface ChipsProps<T> {
  /** 選択肢のまとまりの名前（画面に表示し、読み上げにも使う） */
  label: string;
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
  /** 見出しを画面には出さず、読み上げだけに使う */
  hideLabel?: boolean;
}

/** 1つだけ選ぶ、押しやすい大きさの選択ボタン群。 */
export function Chips<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
  hint,
  hideLabel,
}: ChipsProps<T>) {
  return (
    <div className="field">
      {hideLabel ? null : <div className="field-label">{label}</div>}
      <div className="chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className="chip"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

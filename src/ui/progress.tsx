import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type ProgressProps = {
  label: string;
  value?: number;
  max?: number;
  detail?: ReactNode;
  className?: string;
};

/** Use value only when the underlying work reports a real, measurable amount. */
export function Progress({ label, value, max = 100, detail, className = "" }: ProgressProps) {
  const determinate = Number.isFinite(value);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = determinate ? Math.min(Math.max(value!, 0), safeMax) : undefined;
  return <div className={`tl-progress ${className}`}>
    <div className="tl-progress__copy"><span>{label}</span>{detail && <span className="tl-progress__detail">{detail}</span>}</div>
    <progress className="tl-progress__track" max={safeMax} value={safeValue} aria-label={label} />
  </div>;
}

export type ProgressStep = { id: string; label: string; description?: ReactNode };
export type ProgressStepsProps = {
  label: string;
  items: readonly ProgressStep[];
  currentId: string;
  className?: string;
};

/** Named steps communicate actual workflow state without inventing a percentage. */
export function ProgressSteps({ label, items, currentId, className = "" }: ProgressStepsProps) {
  const currentIndex = items.findIndex((item) => item.id === currentId);
  return <ol aria-label={label} className={`tl-progress-steps ${className}`}>
    {items.map((item, index) => {
      const complete = currentIndex >= 0 && index < currentIndex;
      const current = index === currentIndex;
      return <li key={item.id} className="tl-progress-steps__item" data-state={complete ? "complete" : current ? "current" : "upcoming"} aria-current={current ? "step" : undefined}>
        <span className="tl-progress-steps__marker" aria-hidden="true">{complete ? <Check size={16} /> : index + 1}</span>
        <span className="tl-progress-steps__copy"><span className="tl-progress-steps__label">{item.label}</span>{item.description && <span className="tl-progress-steps__description">{item.description}</span>}</span>
      </li>;
    })}
  </ol>;
}

import { Check, FileCheck2, FolderOpen, ListChecks } from 'lucide-react';
import type { PublicCopy } from './copy';
import styles from './public-site.module.css';

/**
 * A product-shaped explanation of the work path. This is intentionally not a
 * screenshot and none of its labels pretend to be live controls or live data.
 */
export function HeroWorkflowScene({ copy }: { copy: PublicCopy }) {
  const proof = copy.proof;

  return <figure className={styles.heroWorkflow} aria-label={copy.mechanismIllustration}>
    <svg className={styles.heroWorkflowPath} viewBox="0 0 680 460" aria-hidden="true">
      <path d="M98 126 C210 126 171 220 282 220 S394 338 534 338" />
      <path d="M521 327 L538 338 L521 350" />
      <circle cx="282" cy="220" r="7" />
    </svg>

    <div className={styles.heroGoalObject}>
      <span><FolderOpen size={17} aria-hidden="true" />{proof.goalLabel}</span>
      <p>{proof.goal}</p>
    </div>

    <div className={styles.heroAssistantObject}>
      <div className={styles.heroAssistantTitle}><ListChecks size={17} aria-hidden="true" /><span>{proof.planLabel}</span></div>
      <ol>{proof.plan.map((item, index) => <li key={item.title}>
        <span>{index + 1}</span><strong>{item.title}</strong>{index < 2 && <Check size={15} aria-hidden="true" />}
      </li>)}</ol>
      <p><span aria-hidden="true" />{proof.findings[0]}</p>
    </div>

    <div className={styles.heroDecisionObject}>
      <span>{proof.decisionLabel}</span>
      <strong>{proof.decision}</strong>
      <i aria-hidden="true"><Check size={20} /></i>
    </div>

    <div className={styles.heroResultObject}>
      <span><FileCheck2 size={17} aria-hidden="true" />{proof.resultLabel}</span>
      <ul>{proof.results.map((result) => <li key={result.title}>{result.title}</li>)}</ul>
    </div>
  </figure>;
}

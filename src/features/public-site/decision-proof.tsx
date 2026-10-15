'use client';

import { ArrowDown, Check, CircleAlert, FileCheck2 } from 'lucide-react';
import { useState } from 'react';
import type { PublicCopy } from './copy';
import styles from './public-site.module.css';

/** A truthful explanatory sequence. It deliberately contains no pretend product controls. */
export function DecisionProof({ copy }: { copy: PublicCopy }) {
  const proof = copy.proof;
  const [activeStep, setActiveStep] = useState(0);
  const currentStep = proof.plan[activeStep] ?? proof.plan[0]!;

  return <section className={styles.decisionProof} id="process" aria-labelledby="decision-proof-title">
    <header className={styles.proofLead}>
      <h2 id="decision-proof-title">{proof.title}</h2>
      <p>{proof.intro}</p>
    </header>

    <div className={styles.proofSequence}>
      <blockquote className={styles.proofGoal}>
        <span>{proof.goalLabel}</span>
        <p>{proof.goal}</p>
      </blockquote>

      <ArrowDown className={styles.proofArrow} size={24} aria-hidden="true" />

      <div className={styles.proofAssistant}>
        <div className={styles.proofPlan}>
          <h3>{proof.planLabel}</h3>
          <ol>{proof.plan.map((item, index) => <li key={item.title}>
            <button type="button" aria-pressed={index === activeStep} aria-controls="assistant-plan-detail" onClick={() => setActiveStep(index)}>
              <span>{item.title}</span>
            </button>
          </li>)}</ol>
          <div className={styles.proofPlanDetail} id="assistant-plan-detail" aria-live="polite"><p>{currentStep.text}</p></div>
        </div>
        <div className={styles.proofFindings}>
          <h3><CircleAlert size={20} aria-hidden="true" />{proof.findingLabel}</h3>
          <ul>{proof.findings.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>

      <ArrowDown className={styles.proofArrow} size={24} aria-hidden="true" />

      <div className={styles.proofDecision}>
        <div>
          <h3>{proof.decisionLabel}</h3>
          <p>{proof.decision}</p>
        </div>
        <Check size={30} aria-hidden="true" />
      </div>

      <ArrowDown className={styles.proofArrow} size={24} aria-hidden="true" />

      <div className={styles.proofResults}>
        <h3><FileCheck2 size={21} aria-hidden="true" />{proof.resultLabel}</h3>
        <dl>{proof.results.map((result) => <div key={result.title}><dt>{result.title}</dt><dd>{result.text}</dd></div>)}</dl>
        <p>{proof.continuation}</p>
      </div>
    </div>
  </section>;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEventHandler } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, Film, FolderOpen, History, ImageIcon, PencilLine, Presentation, ShieldCheck, Sparkles, Table2 } from "lucide-react";
import type { Locale } from "@/i18n";
import { useLocale } from "@/i18n/provider";
import { LocaleSelect, ProductHeader } from "@/ui";
import { AccountMenu } from "@/features/identity/ui/account-menu";
import { useIdentityAccount } from "@/features/identity/ui/identity-locale-provider";
import { publicCopy, type PublicCopy } from "./copy";
import { StartWork } from './start-work';
import { ConnectedMaterialsScene } from './connected-materials-scene';
import { DecisionProof } from './decision-proof';
import { HeroWorkflowScene } from './hero-workflow-scene';
import { identityClient } from '@/features/identity/ui/transport';
import { authHref } from '@/features/identity/ui/navigation';
import styles from "./public-site.module.css";

type PublicView = "home" | "help" | "privacy";

function PublicLanguage({ locale, view }: { locale: Locale; view: PublicView }) {
  const router = useRouter();
  return <LocaleSelect compact selectedLocale={locale} onLocaleChange={(next) => router.replace(`/${next}${view === "home" ? "" : `/${view}`}`, { scroll: false })} />;
}

function PublicFooter({ locale, copy, signedIn }: { locale: Locale; copy: PublicCopy; signedIn: boolean }) {
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <div><Link href={`/${locale}`} className={styles.footerBrand}><Image src="/brand/tirlik-mark.svg" width={32} height={32} alt="" />Tirlik</Link><p>{copy.footerText}</p></div>
      <nav aria-label={copy.help}><Link href={`/${locale}/help`}>{copy.help}</Link><Link href={`/${locale}/privacy`}>{copy.privacy}</Link><a href="https://github.com/DarinaX2005X/digital-taraz-hackhathon">{copy.repository}</a></nav>
      <nav aria-label={copy.account}>{signedIn ? <><Link href="/app/work">{copy.work}</Link><Link href="/settings">{copy.account}</Link><Link href="/settings/team">{copy.team}</Link></> : <><Link href="/sign-in">{copy.signIn}</Link><Link href="/sign-up">{copy.start}</Link></>}</nav>
    </div>
  </footer>;
}

function Scenarios({ copy, onStart }: { copy: PublicCopy; onStart: (goal: string) => void }) {
  const [selected, setSelected] = useState(0);
  const item = copy.scenarioItems[selected] ?? copy.scenarioItems[0]!;
  const icons = [FileText, Table2, ImageIcon];
  const Icon = icons[selected] ?? FileText;
  return <section className={styles.scenarios} id="scenarios" aria-labelledby="scenarios-title">
    <div className={styles.sectionLead}><h2 id="scenarios-title">{copy.introTitle}</h2><p>{copy.intro}</p></div>
    <div className={styles.scenarioLayout}>
      <div className={styles.scenarioChoices} role="group" aria-label={copy.scenarios}>{copy.scenarioItems.map((scenario, index) => {
        const ItemIcon = icons[index] ?? FileText;
        return <button key={scenario.title} type="button" aria-pressed={index === selected} onClick={() => setSelected(index)}><ItemIcon size={22} aria-hidden="true" /><span>{scenario.title}</span><ArrowRight size={18} aria-hidden="true" /></button>;
      })}</div>
      <div className={styles.scenarioDetail} aria-live="polite" aria-atomic="true">
        <p className={styles.task}>{item.task}</p>
        <div className={styles.materialFlow}>
          <div><FolderOpen size={28} aria-hidden="true" /><h3>{copy.inputLabel}</h3><p>{item.input}</p></div>
          <ArrowRight className={styles.flowArrow} size={24} aria-hidden="true" />
          <div><Icon size={28} aria-hidden="true" /><h3>{copy.outputLabel}</h3><p>{item.output}</p></div>
        </div>
        <p className={styles.scenarioExplanation}>{item.detail}</p>
        <a className="tl-button tl-button--secondary" href="#start" onClick={() => onStart(item.task.replace(/^[«“]|[»”]$/g, ''))}>{copy.useScenario}<ArrowRight size={18} aria-hidden="true" /></a>
      </div>
    </div>
  </section>;
}

function HomeContent({ copy, locale, signedIn, onDraftChange }: { copy: PublicCopy; locale: Locale; signedIn: boolean; onDraftChange: (value: string) => void }) {
  const [scenarioGoal, setScenarioGoal] = useState<string>();
  const controlIcons = [PencilLine, ShieldCheck, History];
  return <main id="public-main">
    <section className={styles.hero} aria-labelledby="tirlik-title">
      <div className={styles.heroContent}>
        <h1 id="tirlik-title">{copy.heroTitle}</h1>
        <p className={styles.heroDescription}>{copy.description}</p>
        <div className={styles.heroActions}>
          {signedIn
            ? <Link href="/app/work" className="tl-button tl-button--primary">{copy.cabinet}<ArrowRight size={19} aria-hidden="true" /></Link>
            : <a href="#start" className="tl-button tl-button--primary">{copy.ownTaskAction}<ArrowRight size={19} aria-hidden="true" /></a>}
          <div className={styles.mediaActions}>
            <button type="button" className="tl-button tl-button--secondary" disabled title={copy.mediaPending}><Film size={19} aria-hidden="true" />{copy.watchDemo}</button>
            <button type="button" className="tl-button tl-button--secondary" disabled title={copy.mediaPending}><Presentation size={19} aria-hidden="true" />{copy.presentation}</button>
          </div>
        </div>
      </div>
      <HeroWorkflowScene copy={copy} />
    </section>
    <section className={styles.exampleBand} aria-labelledby="example-title">
      <div className={styles.exampleIllustration} aria-hidden="true"><Sparkles size={26} /><span /><span /><span /></div>
      <div><h2 id="example-title">{copy.exampleTitle}</h2><p>{copy.exampleBody}</p></div>
      <Link href={`/${locale}/demo`} className="tl-button tl-button--primary">{copy.exampleAction}<ArrowRight size={19} aria-hidden="true" /></Link>
    </section>
    <DecisionProof copy={copy} />
    <StartWork copy={copy} signedIn={signedIn} scenarioGoal={scenarioGoal} onDraftChange={onDraftChange} />
    <Scenarios copy={copy} onStart={setScenarioGoal} />
    <section className={styles.controlSection} aria-labelledby="control-title">
      <div className={styles.controlIntro}><div><h2 id="control-title">{copy.controlTitle}</h2><p>{copy.controlBody}</p></div><ConnectedMaterialsScene copy={copy} /></div>
      <div className={styles.controlItems}>{copy.controlItems.map((item, index) => {
        const Icon = controlIcons[index] ?? PencilLine;
        return <div key={item.title}><Icon size={24} aria-hidden="true" /><h3>{item.title}</h3><p>{item.text}</p></div>;
      })}</div>
    </section>
    <section className={styles.boundaries} aria-labelledby="boundary-title">
      <div><h2 id="boundary-title">{copy.boundaryTitle}</h2><p>{copy.boundaryText}</p></div>
      <ul>{copy.boundaryItems.map((item) => <li key={item}><Check size={20} aria-hidden="true" /><span>{item}</span></li>)}</ul>
    </section>
    <section className={styles.access} aria-labelledby="access-title"><div><h2 id="access-title">{copy.accessTitle}</h2><p>{copy.accessText}</p></div><div className={styles.accessActions}><a className="tl-button tl-button--primary" href="#start">{copy.ownTaskAction}<ArrowRight size={20} aria-hidden="true" /></a><Link href={signedIn ? "/app/work" : "/sign-in"}>{signedIn ? copy.resumeWork : copy.signIn}</Link></div></section>
  </main>;
}

function InformationContent({ copy, locale, view }: { copy: PublicCopy; locale: Locale; view: Exclude<PublicView, "home"> }) {
  const links = { signup: "/sign-up", reset: "/auth/reset", team: "/settings/team", tour: '/settings#tour' };
  return <main id="public-main" className={styles.information}>
    <Link className={styles.back} href={`/${locale}`}><ArrowLeft size={18} aria-hidden="true" />{copy.back}</Link>
    <h1>{view === "help" ? copy.helpTitle : copy.privacyTitle}</h1>
    <p className={styles.informationIntro}>{view === "help" ? copy.helpIntro : copy.privacyIntro}</p>
    <div className={styles.informationSections}>{(view === "help" ? copy.helpSections : copy.privacySections).map((section) => {
      const content = <><h2>{section.title}</h2><p>{section.text}</p>{section.link && <span className={styles.informationLink}>{section.action}<ArrowRight size={18} aria-hidden="true" /></span>}</>;
      return section.link
        ? <Link key={section.title} className={styles.informationCard} href={links[section.link]}><section>{content}</section></Link>
        : <section key={section.title}>{content}</section>;
    })}</div>
  </main>;
}

export function PublicSite({ routeLocale, view = "home" }: { routeLocale?: Locale; view?: PublicView }) {
  const router = useRouter();
  const publicGoal = useRef(''), authAttempt = useRef<{ goal: string; key: string } | undefined>(undefined), authNavigating = useRef(false);
  const [authFailure, setAuthFailure] = useState(false);
  const rememberGoal = useCallback((value: string) => { publicGoal.current = value; }, []);
  const { locale: preferredLocale, setLocale } = useLocale();
  const locale = routeLocale ?? preferredLocale;
  const copy = publicCopy[locale];
  const account = useIdentityAccount();
  const lastRouteLocale = useRef<Locale | undefined>(undefined);
  useEffect(() => { try { const saved = sessionStorage.getItem('tirlik.public-goal.v1'); if (saved && saved.length <= 12000) publicGoal.current = saved; } catch { /* The in-memory goal remains available. */ } }, []);
  const preserveAuthDraft: MouseEventHandler<HTMLDivElement> = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !publicGoal.current.trim()) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.target || anchor.origin !== window.location.origin || !['/sign-in', '/sign-up'].includes(anchor.pathname)) return;
    event.preventDefault();
    if (authNavigating.current) return;
    authNavigating.current = true; setAuthFailure(false);
    const goal = publicGoal.current.trim();
    if (authAttempt.current?.goal !== goal) authAttempt.current = { goal, key: crypto.randomUUID() };
    void identityClient.saveIntent({ goal, returnTo: '/app/work' }, authAttempt.current.key).then((saved) => {
      router.push(authHref(anchor.pathname as '/sign-in' | '/sign-up', { returnTo: '/app/work', intentToken: saved.intentToken }));
    }).catch(() => { authNavigating.current = false; setAuthFailure(true); });
  };
  useEffect(() => {
    if (lastRouteLocale.current === routeLocale) return;
    lastRouteLocale.current = routeLocale;
    if (routeLocale && routeLocale !== preferredLocale) setLocale(routeLocale);
  }, [routeLocale, preferredLocale, setLocale]);
  return <div className={styles.site} lang={locale} onClickCapture={preserveAuthDraft}>
    <ProductHeader wide homeLabel={copy.home} homeHref={`/${locale}`} navigation={<nav className={styles.headerNav} aria-label={copy.scenarios}><Link href={`/${locale}#scenarios`}>{copy.scenarios}</Link><Link href={`/${locale}#process`}>{copy.process}</Link></nav>}>
      <PublicLanguage locale={locale} view={view} />
      {account.viewer ? <AccountMenu /> : <Link className="tl-button tl-button--secondary" href="/sign-in">{copy.signIn}</Link>}
    </ProductHeader>
    {authFailure && <p role="alert" className={styles.startError}>{copy.ownTaskError}</p>}
    {view === "home" ? <HomeContent copy={copy} locale={locale} signedIn={Boolean(account.viewer)} onDraftChange={rememberGoal} /> : <InformationContent copy={copy} locale={locale} view={view} />}
    <PublicFooter copy={copy} locale={locale} signedIn={Boolean(account.viewer)} />
  </div>;
}

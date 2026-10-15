"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, FileText, FolderOpen, History, ImageIcon, ListChecks, PencilLine, ShieldCheck, Table2, Users } from "lucide-react";
import type { Locale } from "@/i18n";
import { useLocale } from "@/i18n/provider";
import { LocaleSelect, ProductHeader } from "@/ui";
import { AccountMenu } from "@/features/identity/ui/account-menu";
import { useIdentityAccount } from "@/features/identity/ui/identity-locale-provider";
import { publicCopy, type PublicCopy } from "./copy";
import styles from "./public-site.module.css";

type PublicView = "home" | "help" | "privacy";

function PublicLanguage({ locale, view }: { locale: Locale; view: PublicView }) {
  const router = useRouter();
  return <LocaleSelect compact selectedLocale={locale} onLocaleChange={(next) => router.replace(`/${next}${view === "home" ? "" : `/${view}`}`, { scroll: false })} />;
}

function PublicFooter({ locale, copy }: { locale: Locale; copy: PublicCopy }) {
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <div><Link href={`/${locale}`} className={styles.footerBrand}><Image src="/brand/tirlik-mark.svg" width={32} height={32} alt="" />Tirlik</Link><p>{copy.footerText}</p></div>
      <nav aria-label={copy.help}><Link href={`/${locale}/help`}>{copy.help}</Link><Link href={`/${locale}/privacy`}>{copy.privacy}</Link><a href="https://github.com/DarinaX2005X/digital-taraz-hackhathon">{copy.repository}</a></nav>
      <nav aria-label={copy.account}><Link href="/sign-in">{copy.signIn}</Link><Link href="/sign-up">{copy.start}</Link><Link href="/settings/team">{copy.team}</Link></nav>
    </div>
  </footer>;
}

function Scenarios({ copy }: { copy: PublicCopy }) {
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
      </div>
    </div>
  </section>;
}

function HomeContent({ copy, signedIn }: { copy: PublicCopy; signedIn: boolean }) {
  const controlIcons = [PencilLine, ShieldCheck, History];
  const stepIcons = [FolderOpen, ListChecks, Check];
  return <main id="public-main">
    <section className={styles.hero} aria-labelledby="tirlik-title">
      <Image className={styles.heroImage} src="/site/business-materials.png" alt={copy.illustration} fill sizes="100vw" preload />
      <div className={styles.heroContent}>
        <h1 id="tirlik-title">Tirlik</h1>
        <p className={styles.tagline}>{copy.tagline}</p>
        <p className={styles.heroDescription}>{copy.description}</p>
        <div className={styles.heroActions}>
          <Link href={signedIn ? "/app/work" : "/sign-up"} className="tl-button tl-button--primary">{signedIn ? copy.work : copy.start}<ArrowRight size={19} aria-hidden="true" /></Link>
          <a href="#scenarios" className={styles.explore}>{copy.explore}<ArrowDown size={18} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
    <Scenarios copy={copy} />
    <section className={styles.controlSection} aria-labelledby="control-title">
      <div className={styles.controlIntro}><h2 id="control-title">{copy.controlTitle}</h2><p>{copy.controlBody}</p></div>
      <div className={styles.controlItems}>{copy.controlItems.map((item, index) => {
        const Icon = controlIcons[index] ?? PencilLine;
        return <div key={item.title}><Icon size={24} aria-hidden="true" /><h3>{item.title}</h3><p>{item.text}</p></div>;
      })}</div>
    </section>
    <section className={styles.process} id="process" aria-labelledby="process-title">
      <h2 id="process-title">{copy.processTitle}</h2>
      <ol className={styles.steps}>{copy.steps.map((item, index) => {
        const Icon = stepIcons[index] ?? Check;
        return <li key={item.title}><span className={styles.stepIcon}><Icon size={25} aria-hidden="true" /></span><h3>{item.title}</h3><p>{item.text}</p></li>;
      })}</ol>
    </section>
    <section className={styles.boundaries} aria-labelledby="boundary-title">
      <div><h2 id="boundary-title">{copy.boundaryTitle}</h2><p>{copy.boundaryText}</p></div>
      <ul>{copy.boundaryItems.map((item) => <li key={item}><Check size={20} aria-hidden="true" /><span>{item}</span></li>)}</ul>
    </section>
    <section className={styles.access} aria-labelledby="access-title"><div><h2 id="access-title">{copy.accessTitle}</h2><p>{copy.accessText}</p></div><div className={styles.accessActions}><Link className="tl-button tl-button--primary" href={signedIn ? "/app/work" : "/sign-up"}><Users size={20} aria-hidden="true" />{signedIn ? copy.work : copy.start}</Link><Link href={signedIn ? "/settings" : "/sign-in"}>{signedIn ? copy.account : copy.signIn}</Link></div></section>
  </main>;
}

function InformationContent({ copy, locale, view }: { copy: PublicCopy; locale: Locale; view: Exclude<PublicView, "home"> }) {
  const links = { signup: "/sign-up", verify: "/auth/verify", reset: "/auth/reset", team: "/settings/team" };
  return <main id="public-main" className={styles.information}>
    <Link className={styles.back} href={`/${locale}`}><ArrowLeft size={18} aria-hidden="true" />{copy.back}</Link>
    <h1>{view === "help" ? copy.helpTitle : copy.privacyTitle}</h1>
    <p className={styles.informationIntro}>{view === "help" ? copy.helpIntro : copy.privacyIntro}</p>
    <div className={styles.informationSections}>{(view === "help" ? copy.helpSections : copy.privacySections).map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p>{section.link && <Link className={styles.informationLink} href={links[section.link]}>{section.action}<ArrowRight size={18} aria-hidden="true" /></Link>}</section>)}</div>
  </main>;
}

export function PublicSite({ routeLocale, view = "home" }: { routeLocale?: Locale; view?: PublicView }) {
  const { locale: preferredLocale, setLocale } = useLocale();
  const locale = routeLocale ?? preferredLocale;
  const copy = publicCopy[locale];
  const account = useIdentityAccount();
  const lastRouteLocale = useRef<Locale | undefined>(undefined);
  useEffect(() => {
    if (lastRouteLocale.current === routeLocale) return;
    lastRouteLocale.current = routeLocale;
    if (routeLocale && routeLocale !== preferredLocale) setLocale(routeLocale);
  }, [routeLocale, preferredLocale, setLocale]);
  return <div className={styles.site} lang={locale}>
    <ProductHeader wide homeLabel={copy.home} homeHref={`/${locale}`} navigation={<nav className={styles.headerNav} aria-label={copy.scenarios}><Link href={`/${locale}#scenarios`}>{copy.scenarios}</Link><Link href={`/${locale}#process`}>{copy.process}</Link></nav>}>
      <PublicLanguage locale={locale} view={view} />
      {account.viewer ? <AccountMenu /> : <Link className="tl-button tl-button--secondary" href="/sign-in">{copy.signIn}</Link>}
    </ProductHeader>
    {view === "home" ? <HomeContent copy={copy} signedIn={Boolean(account.viewer)} /> : <InformationContent copy={copy} locale={locale} view={view} />}
    <PublicFooter copy={copy} locale={locale} />
  </div>;
}

"use client";

import { useRef, useState } from "react";
import { Download, Film, Presentation } from "lucide-react";
import { Dialog } from "@/ui";
import type { PublicCopy } from "./copy";
import styles from "./public-site.module.css";

const videoPath = "/video/tirlik-product-film-ru.mp4";

export function PublicMediaActions({ copy }: { copy: PublicCopy }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return <>
    <div className={styles.mediaActions}>
      <button ref={trigger} type="button" className="tl-button tl-button--secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Film size={19} aria-hidden="true" />{copy.watchDemo}
      </button>
      <a className="tl-button tl-button--secondary" href="/presentation/tirlik-presentation.pdf" target="_blank" rel="noopener noreferrer">
        <Presentation size={19} aria-hidden="true" />{copy.presentation}
      </a>
    </div>
    <a className={styles.presentationDownload} href="/presentation/tirlik-presentation.pptx" download>
      <Download size={15} aria-hidden="true" />{copy.presentationDownload}
    </a>
    <Dialog open={open} onOpenChange={setOpen} title={copy.videoTitle} description={copy.videoDescription} returnFocus={trigger} className={styles.mediaDialog}
      footer={<a className="tl-button tl-button--secondary" href={videoPath} download><Download size={17} aria-hidden="true" />{copy.videoDownload}</a>}>
      {open && <video className={styles.mediaVideo} controls playsInline preload="none" width={1920} height={1080} poster="/video/tirlik-product-film-poster.jpg" aria-label={copy.videoTitle}>
        <source src={videoPath} type="video/mp4" />
        <track src="/video/tirlik-product-film-ru.vtt" kind="captions" srcLang="ru" label="Русский" default />
        <a href={videoPath} download>{copy.videoDownload}</a>
      </video>}
    </Dialog>
  </>;
}

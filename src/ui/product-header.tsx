import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function ProductHeader({ homeLabel, homeHref = "/", navigation, wide = false, children }: { homeLabel: string; homeHref?: string; navigation?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return <header className={`tl-product-header${wide ? " tl-product-header--wide" : ""}`}>
    <div className="tl-product-header__inner">
      <Link href={homeHref} className="tl-product-header__brand" aria-label={`Tirlik. ${homeLabel}`}>
        <Image src="/brand/tirlik-mark.svg" width={36} height={36} alt="" priority />
        <span>Tirlik</span>
      </Link>
      {navigation}
      {children && <div className="tl-product-header__actions">{children}</div>}
    </div>
  </header>;
}

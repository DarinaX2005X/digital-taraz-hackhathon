import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function ProductHeader({ homeLabel, homeHref = "/", children }: { homeLabel: string; homeHref?: string; children?: ReactNode }) {
  return <header className="tl-product-header">
    <div className="tl-product-header__inner">
      <Link href={homeHref} className="tl-product-header__brand" aria-label={`Tirlik. ${homeLabel}`}>
        <Image src="/brand/tirlik-mark.svg" width={36} height={36} alt="" priority />
        <span>Tirlik</span>
      </Link>
      {children && <div className="tl-product-header__actions">{children}</div>}
    </div>
  </header>;
}

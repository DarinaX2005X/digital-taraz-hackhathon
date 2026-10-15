import { useId } from 'react';
import type { PublicCopy } from './copy';
import styles from './public-site.module.css';

/** An authored illustration of connected materials, never a captured result. */
export function ConnectedMaterialsScene({ copy }: { copy: PublicCopy }) {
  const id = useId().replaceAll(':', '');
  return <figure className={styles.connectedScene}>
    <svg viewBox="0 0 640 350" role="img" aria-label={copy.mechanismIllustration}>
      <defs>
        <linearGradient id={`${id}-folder`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#4d9a90" /><stop offset="1" stopColor="#17665e" /></linearGradient>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#ffffff" /><stop offset="1" stopColor="#dceae5" /></linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#a9c1b7" /><stop offset="1" stopColor="#e0ebe6" /></linearGradient>
        <radialGradient id={`${id}-light`}><stop stopColor="#bce6d6" stopOpacity=".3" /><stop offset="1" stopColor="#bce6d6" stopOpacity="0" /></radialGradient>
        <filter id={`${id}-contact`} x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <ellipse cx="322" cy="212" rx="290" ry="136" fill={`url(#${id}-light)`} />
      <ellipse cx="182" cy="298" rx="128" ry="12" fill="#081f19" opacity=".25" filter={`url(#${id}-contact)`} />
      <ellipse cx="471" cy="286" rx="99" ry="12" fill="#081f19" opacity=".22" filter={`url(#${id}-contact)`} />
      <path d="M92 140 Q92 128 104 128 H158 L176 147 H260 Q272 147 272 159 V277 Q272 289 259 289 H104 Q92 289 92 277Z" fill="#0c4d48" />
      <path d="M116 106 L225 90 L263 125 L264 252 L125 272Z" fill="#aec9bd" />
      <path d="M119 101 L225 85 L257 116 L259 247 L126 266Z" fill={`url(#${id}-paper)`} />
      <path d="M225 85 L228 119 L257 116Z" fill="#bad1c5" />
      <path d="M139 139 L228 127 M140 157 L230 145 M141 175 L231 163" stroke="#a8c5b7" strokeWidth="6" strokeLinecap="round" />
      <path d="M74 187 Q72 175 86 175 L271 175 Q284 175 281 189 L265 288 Q264 297 251 297 H99 Q87 297 86 285Z" fill={`url(#${id}-folder)`} />
      <path d="M87 178 H269" stroke="#8ec1af" strokeWidth="2" opacity=".8" />
      <path d="M89 284 Q90 293 102 293 H249" stroke="#105951" strokeWidth="3" />
      <rect x="112" y="205" width="113" height="47" rx="9" fill="#ecf7f0" />
      <path d="M126 219 H196 M126 236 H157" stroke="#5b8e7b" strokeWidth="5" strokeLinecap="round" />
      <path d="M214 233 L219 238 L229 226" transform="translate(-14 1)" fill="none" stroke="#147365" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M283 224 H308 Q331 224 331 201 V166 Q331 146 353 146 H389" fill="none" stroke="#a5d5c3" strokeWidth="3" />
      <path d="M377 139 L389 146 L377 153" fill="none" stroke="#a5d5c3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="331" cy="188" r="10" fill="#142e27" stroke="#a5d5c3" strokeWidth="2" />
      <path d="M326 188 L330 192 L337 183" fill="none" stroke="#c4eadc" strokeWidth="2" strokeLinecap="round" />
      <path d="M403 74 L516 91 L555 128 L551 274 L411 259Z" fill={`url(#${id}-edge)`} />
      <path d="M399 67 L513 84 L551 120 L547 266 L405 250Z" fill={`url(#${id}-paper)`} />
      <path d="M513 84 L513 118 L551 120Z" fill="#bdd4c8" />
      <path d="M418 111 L491 121" stroke="#417b69" strokeWidth="8" strokeLinecap="round" />
      <path d="M418 134 L522 148 M418 150 L522 164" stroke="#adc7ba" strokeWidth="5" strokeLinecap="round" />
      <path d="M415 175 L528 190 L527 217 L414 202Z" fill="#b8ddcd" />
      <path d="M426 189 L472 195 M493 198 L515 201" stroke="#34755e" strokeWidth="5" strokeLinecap="round" />
      <path d="M417 222 L494 233" stroke="#7a9b8d" strokeWidth="5" strokeLinecap="round" />
      <path d="M546 242 L566 232 L582 244 L577 269 L559 281 L541 267Z" fill="#dcefe4" stroke="#bfdccc" strokeWidth="2" />
      <path d="M552 255 L560 263 L573 247" fill="none" stroke="#16705a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <figcaption><span>{copy.mechanismSource}</span><span>{copy.mechanismResult}</span></figcaption>
  </figure>;
}

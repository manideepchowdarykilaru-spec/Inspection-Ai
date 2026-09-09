import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * LMPC brand mark: a balance scale over the letters LMPC and the department's
 * long name. The original artwork is used when `public/logo.png` exists; the
 * inline vector below is the fallback so the page never shows a broken image.
 */

const GOLD = '#F2B92C';
const BROWN = '#8A5A00';
const DARK = '#6E4600';

export function LmpcMark({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <svg
      viewBox="0 0 400 400"
      role="img"
      aria-label="LMPC — Legal Metrology Packaged Commodities"
      className={className}
    >
      {/* finial */}
      <polygon points="200,22 214,48 200,70 186,48" fill={BROWN} />
      <rect x="194" y="70" width="12" height="14" rx="2" fill={GOLD} />
      {/* pole */}
      <rect x="192" y="84" width="16" height="190" rx="6" fill={BROWN} />
      <rect x="196" y="84" width="4" height="190" fill={GOLD} opacity="0.55" />
      <circle cx="200" cy="112" r="14" fill={BROWN} />
      {/* beam */}
      <path
        d="M 84 130 C 130 100, 170 118, 200 108 C 230 118, 270 100, 316 130"
        stroke={BROWN}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="84" cy="130" r="6" fill={BROWN} />
      <circle cx="316" cy="130" r="6" fill={BROWN} />
      {/* chains */}
      {[
        [84, 130, 40, 212, 128, 212],
        [316, 130, 272, 212, 360, 212],
      ].map(([x, y, l, ly, r, ry], i) => (
        <g key={i} stroke={GOLD} strokeWidth="3" fill="none">
          <line x1={x} y1={y} x2={l} y2={ly} />
          <line x1={x} y1={y} x2={r} y2={ry} />
          <line x1={x} y1={y} x2={x} y2={ly} />
        </g>
      ))}
      {/* pans */}
      <path d="M 40 212 A 44 44 0 0 0 128 212 Z" fill={GOLD} />
      <path d="M 272 212 A 44 44 0 0 0 360 212 Z" fill={GOLD} />
      {/* base */}
      <circle cx="200" cy="270" r="14" fill={BROWN} />
      <rect x="150" y="280" width="100" height="18" rx="6" fill={BROWN} />
      <rect x="132" y="296" width="136" height="14" rx="5" fill={DARK} />
      {showText && (
        <>
          <text
            x="200"
            y="366"
            textAnchor="middle"
            fontFamily="'Playfair Display', Georgia, 'Times New Roman', serif"
            fontWeight="800"
            fontSize="64"
            fill={GOLD}
            stroke={DARK}
            strokeWidth="2.5"
            letterSpacing="4"
          >
            LMPC
          </text>
          <text
            x="200"
            y="388"
            textAnchor="middle"
            fontFamily="Inter, 'Segoe UI', system-ui, sans-serif"
            fontWeight="700"
            fontSize="12.5"
            fill={BROWN}
            letterSpacing="3"
          >
            LEGAL METROLOGY PACKAGED COMMODITIES
          </text>
        </>
      )}
    </svg>
  );
}

/** The department's own artwork when it has been supplied, else the vector mark. */
export function BrandLogo({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <LmpcMark className={className} />;
  return (
    <img
      src="/logo.png"
      alt="LMPC — Legal Metrology Packaged Commodities"
      className={cn('object-contain', className)}
      onError={() => setMissing(true)}
      draggable={false}
    />
  );
}

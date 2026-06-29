import type { ReactNode } from 'react'

// One parametric SVG cow — the app's icon and the face of every success and error.
// Cow colours are fixed on purpose (a cow is a cow in every theme).
export type CowMood = 'happy' | 'thinking' | 'celebrating' | 'worried' | 'speedy'

interface CowProps {
  /** Expression. Defaults to a content, happy cow. */
  mood?: CowMood
  /** Rendered width and height, in pixels. */
  size?: number
  /** A slow, occasional blink. Use on resting/hero placements, not tiny icons. */
  blink?: boolean
  /** When set, the cow is announced to screen readers; otherwise it is decorative. */
  title?: string
  className?: string
}

const PATCH = '#3a2f26'
const EYE = '#2a2118'
const NOSE = '#9c6f64'
const GOLD = '#d9b876'

const openEyes = (
  <>
    <ellipse cx="31" cy="39" rx="3.3" ry="3.9" fill={EYE} />
    <ellipse cx="49" cy="39" rx="3.3" ry="3.9" fill={EYE} />
    <circle cx="32.1" cy="37.7" r="1.05" fill="#fff" />
    <circle cx="50.1" cy="37.7" r="1.05" fill="#fff" />
  </>
)

const eyes: Record<CowMood, ReactNode> = {
  happy: openEyes,
  speedy: openEyes,
  thinking: (
    <>
      <ellipse cx="31" cy="39" rx="3.1" ry="3.6" fill={EYE} />
      <ellipse cx="49" cy="39" rx="3.1" ry="3.6" fill={EYE} />
      <circle cx="31.6" cy="36.6" r="1" fill="#fff" />
      <circle cx="49.6" cy="36.6" r="1" fill="#fff" />
    </>
  ),
  celebrating: (
    <>
      <path d="M28 40 q3 -4.5 6.4 0" stroke={EYE} strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <path d="M45.6 40 q3.2 -4.5 6.4 0" stroke={EYE} strokeWidth="2.3" fill="none" strokeLinecap="round" />
    </>
  ),
  worried: (
    <>
      <ellipse cx="31" cy="40" rx="3" ry="3.4" fill={EYE} />
      <ellipse cx="49" cy="40" rx="3" ry="3.4" fill={EYE} />
      <circle cx="31.9" cy="38.9" r="0.95" fill="#fff" />
      <circle cx="49.9" cy="38.9" r="0.95" fill="#fff" />
      <path d="M27 34 L33 31.8" stroke={PATCH} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M53 34 L47 31.8" stroke={PATCH} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
}

const happyMouth = (
  <path d="M35 57 q5 3 10 0" stroke={NOSE} strokeWidth="1.5" fill="none" strokeLinecap="round" />
)

const mouth: Record<CowMood, ReactNode> = {
  happy: happyMouth,
  speedy: happyMouth,
  thinking: <ellipse cx="40" cy="57.6" rx="2.1" ry="1.6" fill={NOSE} />,
  celebrating: <path d="M34 56 q6 6.5 12 0 q-6 1.6 -12 0 z" fill="#8a5d52" />,
  worried: (
    <path d="M35 58.6 q5 -3 10 0" stroke={NOSE} strokeWidth="1.5" fill="none" strokeLinecap="round" />
  ),
}

function sparkle(x: number, y: number, s: number): ReactNode {
  return (
    <path
      d="M0 -3 L0.7 -0.7 L3 0 L0.7 0.7 L0 3 L-0.7 0.7 L-3 0 L-0.7 -0.7 Z"
      fill={GOLD}
      transform={`translate(${x} ${y}) scale(${s})`}
    />
  )
}

const extras: Record<CowMood, ReactNode> = {
  happy: null,
  speedy: null,
  thinking: (
    <g fill="#7f8a9c">
      <circle cx="60" cy="24" r="1.5" />
      <circle cx="65" cy="19" r="1.9" />
      <circle cx="71" cy="13" r="2.4" />
    </g>
  ),
  celebrating: (
    <>
      {sparkle(13, 17, 1)}
      {sparkle(67, 15, 1.2)}
      {sparkle(69, 44, 0.85)}
    </>
  ),
  worried: <path d="M61 25 q2.4 4 0 5.4 q-2.4 -1.4 0 -5.4 z" fill="#8fb6d6" />,
}

const motionLines = (
  <g stroke={GOLD} strokeWidth="2" strokeLinecap="round" opacity="0.7">
    <path d="M1 31 h7" />
    <path d="M0 41 h9" />
    <path d="M2 51 h6" />
  </g>
)

export function Cow({ mood = 'happy', size = 40, blink = false, title, className }: CowProps) {
  const classes = ['cow', blink ? 'cow-blink' : '', className].filter(Boolean).join(' ')
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      className={classes}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {mood === 'speedy' ? motionLines : null}
      <ellipse cx="17" cy="33" rx="9.5" ry="6.5" fill="#efe6d8" transform="rotate(-26 17 33)" />
      <ellipse cx="63" cy="33" rx="9.5" ry="6.5" fill="#efe6d8" transform="rotate(26 63 33)" />
      <ellipse cx="16" cy="34" rx="4.3" ry="2.8" fill="#e0a99d" transform="rotate(-26 16 34)" />
      <ellipse cx="64" cy="34" rx="4.3" ry="2.8" fill="#e0a99d" transform="rotate(26 64 34)" />
      <path d="M30 18 q-5 -5 -3 -11 q5 3 5 9 z" fill={GOLD} />
      <path d="M50 18 q5 -5 3 -11 q-5 3 -5 9 z" fill={GOLD} />
      <ellipse cx="40" cy="41" rx="25" ry="22.5" fill="#f6efe4" />
      <ellipse cx="29" cy="26" rx="10" ry="7" fill={PATCH} transform="rotate(-18 29 26)" />
      <path d="M37 16 q3 -5 6 0 q-1.5 4 -3 4 q-1.5 0 -3 -4 z" fill={PATCH} />
      <ellipse cx="23" cy="46" rx="4" ry="2.6" fill="#f0c4b8" opacity="0.55" />
      <ellipse cx="57" cy="46" rx="4" ry="2.6" fill="#f0c4b8" opacity="0.55" />
      <ellipse cx="40" cy="53" rx="15.5" ry="10.5" fill="#e7b8ac" />
      <ellipse cx="34" cy="53" rx="2" ry="2.7" fill={NOSE} />
      <ellipse cx="46" cy="53" rx="2" ry="2.7" fill={NOSE} />
      <g className="cow-eyes">{eyes[mood]}</g>
      {mouth[mood]}
      {extras[mood]}
    </svg>
  )
}

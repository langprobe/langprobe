import { PulseBeams } from "@/components/PulseBeams";

/**
 * Hero scene for /login: five labelled signal sources flowing into a
 * single observability surface (the central brand mark).
 *
 * v2 changes from the first version:
 *  - Source endpoints pulled inward from the corners so labels are
 *    NEVER cropped at any viewport size. The 858×434 viewBox now uses
 *    only ~80% of its area for source dots — corners stay empty.
 *  - Source dots are bigger (r=4) and white, with a pulsing halo ring
 *    that matches each beam's cadence. Each one is unmistakable.
 *  - Labels are now formal "chip" badges (bordered, mono, slightly
 *    bigger) rather than thin floating text. Render in HTML overlays
 *    rather than SVG <text> so we get proper letter-spacing/typography.
 *  - Each chip carries a fake "live" tick (e.g. "3.2k/min") so each
 *    source feels like a real telemetry stream, not just a label.
 *  - Beam paths use rounded right-angles (Q-curves) instead of sharp
 *    corners so the geometry feels engineered.
 */

const CENTER_X = 429;
const CENTER_Y = 300;

interface BeamSource {
  /** Where the beam starts — pulled inward from the SVG corners. */
  origin: { x: number; y: number };
  /** SVG path from origin to centre. Uses Q-curves at the bend. */
  path: string;
  /** SMIL duration string. */
  duration: string;
  /** SMIL begin offset for stagger. */
  delay: string;
  /** Signal type label. */
  label: string;
  /** Fake live tick under the label — gives each source identity. */
  rate: string;
  /** Where to anchor the label chip relative to the origin dot. */
  labelAnchor: "tl" | "tr" | "bl" | "br" | "t";
}

// Origins are positioned at ~80% of the canvas width so labels (which
// extend outward by ~80px) never get clipped by the rail edge. The
// center is kept at (429, 217). Beams use a rounded-right-angle path
// (M start → V/H to mid → quadratic-bezier turn → L end) which reads
// as deliberately engineered rather than scrappy.
const beamSources: BeamSource[] = [
  {
    origin: { x: 90, y: 110 },
    // up-left → 90° bend down → centre
    path: "M90 110 L90 280 Q90 300 110 300 L429 300",
    duration: "5.6s",
    delay: "0s",
    label: "runs",
    rate: "3.2k/min",
    labelAnchor: "tl",
  },
  {
    origin: { x: 768, y: 110 },
    path: "M768 110 L768 280 Q768 300 748 300 L429 300",
    duration: "5.6s",
    delay: "0.7s",
    label: "otel",
    rate: "1.8k/min",
    labelAnchor: "tr",
  },
  {
    origin: { x: 90, y: 490 },
    path: "M90 490 L90 320 Q90 300 110 300 L429 300",
    duration: "5.6s",
    delay: "1.4s",
    label: "replays",
    rate: "12/min",
    labelAnchor: "bl",
  },
  {
    origin: { x: 768, y: 490 },
    path: "M768 490 L768 320 Q768 300 748 300 L429 300",
    duration: "5.6s",
    delay: "2.1s",
    label: "evals",
    rate: "248/hr",
    labelAnchor: "br",
  },
  {
    origin: { x: 429, y: 30 },
    path: "M429 30 L429 300",
    duration: "5.6s",
    delay: "2.8s",
    label: "feedback",
    rate: "45/hr",
    labelAnchor: "t",
  },
];

export function LoginScene() {
  const beams = beamSources.map((s) => ({
    path: s.path,
    duration: s.duration,
    delay: s.delay,
    connectionPoints: [
      // Source dot — bigger so it's a real focal point.
      { cx: s.origin.x, cy: s.origin.y, r: 4 },
      // Centre — the brand mark React content takes over here, but we
      // keep the data shape symmetric.
      { cx: CENTER_X, cy: CENTER_Y, r: 5 },
    ],
  }));

  return (
    <PulseBeams beams={beams} width={858} height={600}>
      <CenterEntity />
      <SourceLabels sources={beamSources} />
    </PulseBeams>
  );
}

// ---------------------------------------------------------------------------
// Centre node
// ---------------------------------------------------------------------------

function CenterEntity() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        textAlign: "center",
        padding: "0 24px",
        position: "relative",
      }}
    >
      <BrandNode />
      <div
        style={{
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: "-0.024em",
          color: "#FFFFFF",
        }}
      >
        langprobe
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "rgba(255, 255, 255, 0.55)",
          maxWidth: 320,
          fontFamily: "var(--f-mono)",
          letterSpacing: "0.02em",
        }}
      >
        every run, every span, every eval. one place.
      </div>
    </div>
  );
}

function BrandNode() {
  return (
    <div
      style={{
        position: "relative",
        width: 80,
        height: 80,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Three concentric rings ripple outward, staggered. */}
      <PulseRing inset={-18} delay="0s" border="rgba(255,255,255,0.05)" />
      <PulseRing inset={-10} delay="2.7s" border="rgba(255,255,255,0.08)" />
      <PulseRing inset={-4} delay="5.4s" border="rgba(255,255,255,0.12)" />

      {/* Static outline ring — anchors the centre when the pulses
          are between cycles. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: -4,
          borderRadius: 16,
          border: "1px solid rgba(255, 255, 255, 0.10)",
        }}
      />

      <span
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: "#FFFFFF",
          color: "#0A0A0A",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--f-mono)",
          fontSize: 28,
          fontWeight: 600,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.6), 0 0 40px rgba(255,255,255,0.22), 0 12px 32px rgba(255,255,255,0.06)",
        }}
      >
        t
      </span>

      <style>{`
        @keyframes brand-pulse-ring {
          0%   { transform: scale(0.85); opacity: 0; }
          20%  { opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        /* Scope reduced-motion override to the pulse-ring elements
         * so we don't accidentally kill animations on every other
         * aria-hidden element across the auth page. */
        @media (prefers-reduced-motion: reduce) {
          [data-pulse-ring] { animation: none !important; opacity: 0.4 !important; }
        }
      `}</style>
    </div>
  );
}

function PulseRing({
  inset,
  delay,
  border,
}: {
  inset: number;
  delay: string;
  border: string;
}) {
  return (
    <span
      aria-hidden
      data-pulse-ring
      style={{
        position: "absolute",
        inset,
        borderRadius: 16,
        border: `1px solid ${border}`,
        animation: "brand-pulse-ring 8s ease-out infinite",
        animationDelay: delay,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Source labels — chips with mono label + rate tick
// ---------------------------------------------------------------------------

interface SourceLabelsProps {
  sources: BeamSource[];
}

function SourceLabels({ sources }: SourceLabelsProps) {
  // Wrap in an absolute-positioned container that EXACTLY mirrors the
  // SVG's letterbox (preserveAspectRatio="xMidYMid meet"). Container
  // queries compute the letterbox math identically to the SVG so chips
  // stay glued to their dots at every rail size.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
        containerType: "size",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "min(100cqw, calc(100cqh * 858 / 600))",
          height: "min(100cqh, calc(100cqw * 600 / 858))",
        }}
      >
        {sources.map((s) => (
          <SourceChip key={s.label} source={s} />
        ))}
      </div>
    </div>
  );
}

function SourceChip({ source }: { source: BeamSource }) {
  // Translate viewBox coordinates (0..858 / 0..434) to percentages
  // so the chip stays glued to its dot regardless of canvas scale.
  const leftPct = (source.origin.x / 858) * 100;
  const topPct = (source.origin.y / 600) * 100;

  // Each anchor offsets the chip in the right direction so it sits
  // *outside* the dot, never overlapping a beam.
  const positions: Record<
    BeamSource["labelAnchor"],
    { offsetX: number; offsetY: number; align: "flex-start" | "flex-end" | "center"; transform: string }
  > = {
    tl: { offsetX: -16, offsetY: -16, align: "flex-end", transform: "translate(-100%, -100%)" },
    tr: { offsetX: 16, offsetY: -16, align: "flex-start", transform: "translate(0, -100%)" },
    bl: { offsetX: -16, offsetY: 16, align: "flex-end", transform: "translate(-100%, 0)" },
    br: { offsetX: 16, offsetY: 16, align: "flex-start", transform: "translate(0, 0)" },
    t: { offsetX: 0, offsetY: -24, align: "center", transform: "translate(-50%, -100%)" },
  };
  const pos = positions[source.labelAnchor];

  return (
    <div
      style={{
        position: "absolute",
        left: `calc(${leftPct}% + ${pos.offsetX}px)`,
        top: `calc(${topPct}% + ${pos.offsetY}px)`,
        transform: pos.transform,
        display: "flex",
        flexDirection: "column",
        alignItems: pos.align,
        gap: 4,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 9px",
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255, 255, 255, 0.92)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.95)",
            boxShadow: "0 0 6px rgba(255,255,255,0.6)",
          }}
        />
        {source.label}
      </span>
      <span
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          color: "rgba(255, 255, 255, 0.42)",
          letterSpacing: "0.03em",
        }}
      >
        {source.rate}
      </span>
    </div>
  );
}

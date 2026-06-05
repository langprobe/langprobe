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
const CENTER_Y = 217;

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
    origin: { x: 110, y: 90 },
    // up-left → 90° bend down → centre
    path: "M110 90 L110 197 Q110 217 130 217 L429 217",
    duration: "3.2s",
    delay: "0s",
    label: "runs",
    rate: "3.2k/min",
    labelAnchor: "tl",
  },
  {
    origin: { x: 748, y: 90 },
    path: "M748 90 L748 197 Q748 217 728 217 L429 217",
    duration: "3.2s",
    delay: "0.4s",
    label: "otel",
    rate: "1.8k/min",
    labelAnchor: "tr",
  },
  {
    origin: { x: 110, y: 344 },
    path: "M110 344 L110 237 Q110 217 130 217 L429 217",
    duration: "3.2s",
    delay: "0.8s",
    label: "replays",
    rate: "12/min",
    labelAnchor: "bl",
  },
  {
    origin: { x: 748, y: 344 },
    path: "M748 344 L748 237 Q748 217 728 217 L429 217",
    duration: "3.2s",
    delay: "1.2s",
    label: "evals",
    rate: "248/hr",
    labelAnchor: "br",
  },
  {
    origin: { x: 429, y: 60 },
    path: "M429 60 L429 217",
    duration: "3.2s",
    delay: "1.6s",
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
    <PulseBeams beams={beams} width={858} height={434}>
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
        tracebility
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
        every run · every span · every eval — one place
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
      <PulseRing inset={-10} delay="1.6s" border="rgba(255,255,255,0.08)" />
      <PulseRing inset={-4} delay="3.2s" border="rgba(255,255,255,0.12)" />

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
        @media (prefers-reduced-motion: reduce) {
          [data-pulse-ring] { animation: none !important; opacity: 0.5 !important; }
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
        animation: "brand-pulse-ring 4.8s ease-out infinite",
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
  // SVG's viewBox aspect ratio, so % positions translate cleanly.
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
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 858,
          maxHeight: 434,
          aspectRatio: "858 / 434",
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
  const topPct = (source.origin.y / 434) * 100;

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
    t: { offsetX: 0, offsetY: -16, align: "center", transform: "translate(-50%, -100%)" },
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

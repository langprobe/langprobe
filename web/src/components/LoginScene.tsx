import { PulseBeams } from "@/components/PulseBeams";

/**
 * The "single entity tracing every signal" hero scene for /login.
 *
 * Five beams flow from the corners of the data plane into the central
 * brand mark — each labelled with one of the signal types tracebility
 * actually ingests: runs, evals, replays, feedback, otel.
 *
 * The whole thing is monochrome on near-black: dark canvas matches our
 * --accent, beams pulse white-to-transparent. No purple, no cyan, no
 * gradient on the brand. The scene reads as "data converging" without
 * ever drifting from DESIGN.md.
 *
 * Paths are hand-tuned to (1) terminate cleanly at the central node,
 * (2) have visually distinct shapes (rounded corner, straight line,
 * diagonal) so the eye perceives multiple sources, (3) keep the
 * starting endpoints at meaningful coordinates so we can label them
 * with the signal-type tag.
 */

const CENTER_X = 429;
const CENTER_Y = 217;

interface BeamSource {
  /** Where the beam starts (the labelled endpoint). */
  origin: { x: number; y: number };
  /** SMIL path from origin to centre. */
  path: string;
  /** Initial gradient vector (sets up the pulse offscreen). */
  initial: { x1: string; y1: string; x2: string; y2: string };
  /** Final gradient vector — the pulse arrives at the centre. */
  animate: { x1: string; y1: string; x2: string; y2: string };
  /** SMIL duration string. */
  duration: string;
  /** SMIL begin offset for stagger. */
  delay: string;
  /** Signal label (rendered as a small mono-tag at the origin). */
  label: string;
}

const beamSources: BeamSource[] = [
  {
    origin: { x: 60, y: 60 },
    path: "M60 60 L60 217 L429 217",
    initial: { x1: "60", y1: "60", x2: "60", y2: "70" },
    animate: { x1: "429", y1: "217", x2: "429", y2: "227" },
    duration: "3.6s",
    delay: "0s",
    label: "runs",
  },
  {
    origin: { x: 798, y: 60 },
    path: "M798 60 L798 217 L429 217",
    initial: { x1: "798", y1: "60", x2: "798", y2: "70" },
    animate: { x1: "429", y1: "217", x2: "429", y2: "227" },
    duration: "3.6s",
    delay: "0.6s",
    label: "otel",
  },
  {
    origin: { x: 60, y: 374 },
    path: "M60 374 L60 217 L429 217",
    initial: { x1: "60", y1: "374", x2: "60", y2: "364" },
    animate: { x1: "429", y1: "217", x2: "429", y2: "207" },
    duration: "3.6s",
    delay: "1.2s",
    label: "replays",
  },
  {
    origin: { x: 798, y: 374 },
    path: "M798 374 L798 217 L429 217",
    initial: { x1: "798", y1: "374", x2: "798", y2: "364" },
    animate: { x1: "429", y1: "217", x2: "429", y2: "207" },
    duration: "3.6s",
    delay: "1.8s",
    label: "evals",
  },
  {
    origin: { x: 429, y: 30 },
    path: "M429 30 L429 217",
    initial: { x1: "429", y1: "30", x2: "429", y2: "40" },
    animate: { x1: "429", y1: "217", x2: "429", y2: "227" },
    duration: "3.6s",
    delay: "2.4s",
    label: "feedback",
  },
];

export function LoginScene() {
  const beams = beamSources.map((s) => ({
    path: s.path,
    initial: s.initial,
    animate: s.animate,
    duration: s.duration,
    delay: s.delay,
    connectionPoints: [
      // Origin (data source) — slightly larger so the label feels
      // anchored to a real point.
      { cx: s.origin.x, cy: s.origin.y, r: 4 },
      // Center node (the entity).
      { cx: CENTER_X, cy: CENTER_Y, r: 6 },
    ],
  }));

  return (
    <PulseBeams beams={beams} width={858} height={434}>
      <CenterEntity />
      <SourceLabels sources={beamSources} />
    </PulseBeams>
  );
}

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
      }}
    >
      {/* Brand mark — bigger here than in the topbar, so it carries the
          whole composition. The double-ring makes it look like a node
          with an aura rather than a static logo. */}
      <div
        style={{
          position: "relative",
          width: 64,
          height: 64,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -12,
            borderRadius: 9999,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            animation: "pulse-ring 4.8s ease-out infinite",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: 9999,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            animation: "pulse-ring 4.8s ease-out infinite",
            animationDelay: "1.6s",
          }}
        />
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "#FFFFFF",
            color: "#0A0A0A",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--f-mono)",
            fontSize: 22,
            fontWeight: 600,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.6), 0 0 28px rgba(255,255,255,0.18)",
          }}
        >
          t
        </span>
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: -0.022,
          color: "#FFFFFF",
        }}
      >
        tracebility
      </div>

      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255, 255, 255, 0.55)",
          maxWidth: 280,
        }}
      >
        every run. every span. every eval. one place.
      </div>

      {/* Inline keyframes — only meaningful inside this scene, so we
          colocate. */}
      <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(0.85); opacity: 0; }
          25%  { opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-hidden] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

interface SourceLabelsProps {
  sources: BeamSource[];
}

function SourceLabels({ sources }: SourceLabelsProps) {
  // Labels sit on top of the SVG, positioned in absolute coordinates
  // mapped to the same 858×434 viewBox. Each label is offset so it
  // doesn't overlap the connection dot — the offset direction matches
  // which corner the source is in.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 858 434"
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: "100%",
          maxHeight: "100%",
          overflow: "visible",
        }}
      >
        {sources.map((s) => {
          const isLeft = s.origin.x < 200;
          const isRight = s.origin.x > 600;
          const isTop = s.origin.y < 100;
          // Anchor labels just-outside the dot, in the direction
          // away from centre so the label never crosses a beam.
          const offsetX = isLeft ? -12 : isRight ? 12 : 0;
          const offsetY = isTop ? -14 : 18;
          const textAnchor = isLeft ? "end" : isRight ? "start" : "middle";
          return (
            <g key={s.label}>
              <text
                x={s.origin.x + offsetX}
                y={s.origin.y + offsetY}
                fontFamily="var(--f-mono)"
                fontSize="10"
                fontWeight="500"
                letterSpacing="0.06em"
                fill="rgba(255, 255, 255, 0.42)"
                textAnchor={textAnchor}
                dominantBaseline={isTop ? "auto" : "hanging"}
              >
                {s.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

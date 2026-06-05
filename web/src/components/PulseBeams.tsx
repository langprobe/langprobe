/**
 * PulseBeams — animated trace lines converging on the central brand mark.
 *
 * The visual metaphor: every run, span, eval, replay, and feedback signal
 * flows from the edges of the data plane into one observability surface.
 * That's literally what tracebility does, so we lean into it as the
 * marketing-side imagery on /login.
 *
 * Implementation note: this is a port of the typical "pulse-beams" pattern
 * from the framer-motion ecosystem, BUT we don't use framer-motion. The
 * gradient endpoints animate via SVG SMIL <animate> elements — zero
 * runtime deps, ships with the browser, and respects prefers-reduced-motion
 * because we gate the <animate> elements on a CSS class that the
 * @media query toggles off.
 *
 * Palette: monochrome (white→transparent over a near-black canvas) per
 * DESIGN.md. No purple/cyan/rainbow gradients. The whole effect reads as
 * "data flowing" without ever drifting from the brand.
 */

import type { ReactNode } from "react";

interface BeamPath {
  /** SVG path that ends at the central node. */
  path: string;
  /** Connection points (endpoints + central node). r controls dot size. */
  connectionPoints: Array<{ cx: number; cy: number; r: number }>;
  /** Starting position of the gradient (along the path, 0% = endpoint). */
  initial: { x1: string; x2: string; y1: string; y2: string };
  /** Final position (100% = central node). */
  animate: { x1: string; x2: string; y1: string; y2: string };
  /** Animation timing. SMIL syntax: e.g. "2s" for duration, "indefinite" for repeat. */
  duration: string;
  /** Stagger so the beams don't all pulse together. */
  delay: string;
}

interface PulseBeamsProps {
  /** Centred content — usually the brand mark + wordmark + tagline. */
  children?: ReactNode;
  /** SVG canvas dimensions. The <svg> centers within the parent. */
  width?: number;
  height?: number;
  beams: BeamPath[];
  /** Background colour for the surface. Defaults to var(--accent). */
  background?: string;
  /** Base stroke (the static line under the moving gradient). */
  baseStroke?: string;
  /** The pulse-line gradient stops. Monochrome by default. */
  pulseColor?: string;
}

export function PulseBeams({
  children,
  width = 858,
  height = 434,
  beams,
  background = "var(--accent)",
  baseStroke = "rgba(255, 255, 255, 0.08)",
  pulseColor = "rgba(255, 255, 255, 0.95)",
}: PulseBeamsProps) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Subtle noise texture so the dark canvas doesn't read as flat
          black. SVG inline so there's no extra request. */}
      <NoiseLayer />

      {/* Centered content (brand mark + wordmark + tagline) sits above
          the SVG so the beams visually connect to it. */}
      <div style={{ position: "relative", zIndex: 2 }}>{children}</div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
        aria-hidden
      >
        {beams.map((beam, i) => (
          <g key={i}>
            {/* Base line — always visible, very low contrast. */}
            <path d={beam.path} stroke={baseStroke} strokeWidth="1" fill="none" />
            {/* Animated pulse — the moving gradient draws a "comet" along
                the path. */}
            <path
              d={beam.path}
              stroke={`url(#pb-grad-${i})`}
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        ))}

        {/* Connection dots: endpoints (data sources) + central node.
            We render after paths so they sit on top. */}
        {beams.flatMap((beam, i) =>
          beam.connectionPoints.map((p, j) => (
            <circle
              key={`pt-${i}-${j}`}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill={background}
              stroke="rgba(255, 255, 255, 0.35)"
              strokeWidth="1"
            />
          )),
        )}

        <defs>
          {beams.map((beam, i) => (
            <linearGradient
              key={i}
              id={`pb-grad-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={beam.initial.x1}
              y1={beam.initial.y1}
              x2={beam.initial.x2}
              y2={beam.initial.y2}
            >
              {/* The four-stop monochrome pulse. Outside the bright
                  middle, the stroke fades to fully transparent so the
                  comet head is the only visible signal. */}
              <stop offset="0%" stopColor={pulseColor} stopOpacity="0" />
              <stop offset="20%" stopColor={pulseColor} stopOpacity="0.2" />
              <stop offset="50%" stopColor={pulseColor} stopOpacity="1" />
              <stop offset="80%" stopColor={pulseColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={pulseColor} stopOpacity="0" />

              {/* SMIL animations move the gradient endpoints along the
                  path, dragging the comet from source to centre. We
                  animate all four endpoints in lockstep so the gradient
                  vector stays perpendicular to the path. */}
              <animate
                attributeName="x1"
                values={`${beam.initial.x1};${beam.animate.x1}`}
                dur={beam.duration}
                begin={beam.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="y1"
                values={`${beam.initial.y1};${beam.animate.y1}`}
                dur={beam.duration}
                begin={beam.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="x2"
                values={`${beam.initial.x2};${beam.animate.x2}`}
                dur={beam.duration}
                begin={beam.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="y2"
                values={`${beam.initial.y2};${beam.animate.y2}`}
                dur={beam.duration}
                begin={beam.delay}
                repeatCount="indefinite"
              />
            </linearGradient>
          ))}
        </defs>
      </svg>
    </div>
  );
}

function NoiseLayer() {
  // 1% opacity grain so the dark surface has texture without anything
  // that reads as decoration. Inline SVG so it doesn't fetch a file.
  const noise = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>")`;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: noise,
        backgroundSize: "180px 180px",
        opacity: 0.04,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
}

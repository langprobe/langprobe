/**
 * PulseBeams — animated trace lines converging on the central brand mark.
 *
 * v2: bright glowing beams + data-packet circles physically traversing
 * each path. Visibility was the v1 problem — gradient pulses on a noisy
 * dark canvas read as printer-toner streaks. This version fixes that.
 *
 * Tools (all native SVG, zero JS deps):
 *  - <filter><feGaussianBlur> for the soft glow on every line
 *  - <animateMotion> for the data-packet dots that traverse each path
 *  - <animate> for fade-in/-out cycling on the packets
 *
 * Palette: monochrome (white over near-black). DESIGN.md compliance.
 */

import type { ReactNode } from "react";

interface BeamPath {
  /** SVG path that ends at the central node. */
  path: string;
  /** Connection points (endpoints + central node). r controls dot size. */
  connectionPoints: Array<{ cx: number; cy: number; r: number }>;
  /** SMIL duration string (e.g. "3.6s"). */
  duration: string;
  /** SMIL begin offset for stagger (e.g. "0.6s"). */
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
}

export function PulseBeams({
  children,
  width = 858,
  height = 434,
  beams,
  background = "var(--accent)",
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
      {/* Decorative radial glow behind the centre — gives the entity
          a literal aura that anchors the composition. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: "60%",
          height: "60%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 35%, transparent 65%)",
          pointerEvents: "none",
          filter: "blur(20px)",
        }}
      />

      {/* Subtle dotted grid texture so the dark canvas reads as
          a "data plane" rather than just a dark rectangle. */}
      <GridLayer />

      {/* Centred content (brand mark + wordmark + tagline) sits above
          the SVG so the beams visually connect to it. */}
      <div style={{ position: "relative", zIndex: 3 }}>{children}</div>

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
        aria-hidden
      >
        <defs>
          {/* Glow filter — the secret sauce. Wraps any <path> or
              <circle> that references it in a soft halo. We render
              the glow underneath the original element by using a
              separate <use> reference. */}
          <filter id="pb-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="pb-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Each beam renders three layers, bottom to top:
            (1) faint static line so the path is always visible
            (2) the data-packet circle that travels the path
            (3) source/target connection dots with their own glow */}
        {beams.map((beam, i) => (
          <g key={i}>
            {/* (1) static base line — bright enough to be visible
                without the moving packet. */}
            <path
              d={beam.path}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth="1"
              fill="none"
              strokeLinecap="round"
            />

            {/* (2) data packet — a glowing circle that physically
                traverses the path via <animateMotion>. The fade-in/-out
                <animate> on opacity makes it feel like a packet
                "appearing" at the source and "absorbed" at the centre
                rather than just looping. */}
            <g filter="url(#pb-glow-strong)">
              <circle r="2.5" fill="rgba(255, 255, 255, 1)">
                <animateMotion
                  dur={beam.duration}
                  begin={beam.delay}
                  repeatCount="indefinite"
                  rotate="auto"
                  path={beam.path}
                />
                <animate
                  attributeName="opacity"
                  values="0; 1; 1; 0.6; 0"
                  keyTimes="0; 0.05; 0.85; 0.95; 1"
                  dur={beam.duration}
                  begin={beam.delay}
                  repeatCount="indefinite"
                />
              </circle>
            </g>

            {/* Smaller trailing packet — a "second wave" so each beam
                has two packets on the wire at once, reading more like
                continuous flow than a one-shot pulse. Offset by half
                the duration. */}
            <g filter="url(#pb-glow)">
              <circle r="1.6" fill="rgba(255, 255, 255, 0.7)">
                <animateMotion
                  dur={beam.duration}
                  begin={`${parseFloat(beam.delay) + parseFloat(beam.duration) / 2}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                  path={beam.path}
                />
                <animate
                  attributeName="opacity"
                  values="0; 0.7; 0.7; 0.4; 0"
                  keyTimes="0; 0.05; 0.85; 0.95; 1"
                  dur={beam.duration}
                  begin={`${parseFloat(beam.delay) + parseFloat(beam.duration) / 2}s`}
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          </g>
        ))}

        {/* Connection dots — drawn LAST so they sit on top of the
            beams, and given a glowing halo so the source feels like
            a real broadcasting node. The dots are split into source
            (the labelled corner) and centre — the centre dot is
            implicitly drawn by the brand mark React content above,
            so we only need source dots here. */}
        {beams.flatMap((beam, i) => {
          const source = beam.connectionPoints[0];
          if (!source) return [];
          return [
            <g key={`pt-${i}`} filter="url(#pb-glow-strong)">
              {/* Outer halo — a faint pulse around each source. */}
              <circle
                cx={source.cx}
                cy={source.cy}
                r={source.r + 6}
                fill="none"
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth="1"
              >
                <animate
                  attributeName="r"
                  values={`${source.r + 6}; ${source.r + 12}; ${source.r + 6}`}
                  dur={beam.duration}
                  begin={beam.delay}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.4; 0; 0.4"
                  dur={beam.duration}
                  begin={beam.delay}
                  repeatCount="indefinite"
                />
              </circle>
              {/* Inner solid dot. */}
              <circle
                cx={source.cx}
                cy={source.cy}
                r={source.r}
                fill="rgba(255, 255, 255, 0.95)"
              />
            </g>,
          ];
        })}
      </svg>
    </div>
  );
}

function GridLayer() {
  // Dotted grid 24px on a side at 4% opacity. Reads as "data plane"
  // without being decorative or distracting.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        backgroundPosition: "center center",
        opacity: 0.5,
        maskImage:
          "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        WebkitMaskImage:
          "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        pointerEvents: "none",
      }}
    />
  );
}

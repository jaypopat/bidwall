"use client";

import { DEPTH, NO_ROUTE, OBSERVED_AT, SALE_SIZES } from "@/app/lib/story/data";
import { useInView } from "./motion";

const X = [70, 390, 710];
const TOP = 24;
const HEIGHT = 300;
const y = (impact: number) => TOP + (Math.max(0, -impact) / 100) * HEIGHT;

/** Price impact of selling Kamino collateral on Jupiter, by sale size. */
export function DepthChart() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.35 });
  const description = DEPTH.map(
    (s) =>
      `${s.label}: ${s.impact.map((v, i) => `${v}% at ${SALE_SIZES[i]}`).join(", ")}`
  ).join(". ");
  return (
    <figure ref={ref} className={`depth-chart ${inView ? "is-in" : ""}`}>
      <figcaption>
        <div>
          <strong>Cost to sell, by size</strong>
          <span>Jupiter sell quotes for Kamino collateral · {OBSERVED_AT}</span>
        </div>
        <ul className="depth-legend">
          <li className="tone-focus">ONyc</li>
          <li className="tone-muted">AUTO · USDe</li>
          <li className="tone-funded">Issuer-funded exits</li>
        </ul>
      </figcaption>
      <svg
        viewBox="0 0 1000 360"
        role="img"
        aria-label={`${description}. ${NO_ROUTE.label}: no route at any size.`}
      >
        {[0, -25, -50, -75, -100].map((tick) => (
          <g key={tick} className="depth-grid">
            <line x1={40} x2={740} y1={y(tick)} y2={y(tick)} />
            <text x={30} y={y(tick) + 4} textAnchor="end">
              {tick}%
            </text>
          </g>
        ))}
        {SALE_SIZES.map((size, i) => (
          <text
            key={size}
            className="depth-size"
            x={X[i]}
            y={350}
            textAnchor="middle"
          >
            {size}
          </text>
        ))}
        {DEPTH.map((series, index) => {
          const points = series.impact.map((v, i) => `${X[i]},${y(v ?? 0)}`);
          const last = series.impact[2] ?? 0;
          return (
            <g
              key={series.id}
              className={`depth-series tone-${series.tone}`}
              style={{ ["--delay" as string]: `${300 + index * 180}ms` }}
            >
              <polyline points={points.join(" ")} pathLength={1} />
              {series.impact.map((v, i) => (
                <circle key={i} cx={X[i]} cy={y(v ?? 0)} r={4} />
              ))}
              <text x={X[2] + 14} y={y(last) + 5}>
                {series.label}{" "}
                <tspan>
                  {series.tone === "funded" ? "≤ −0.2%" : `${last}%`}
                </tspan>
              </text>
            </g>
          );
        })}
        <g className="depth-noroute">
          <rect x={860} y={TOP} width={130} height={HEIGHT} rx={6} />
          <text x={925} y={TOP + HEIGHT / 2 - 8} textAnchor="middle">
            {NO_ROUTE.label}
          </text>
          <text
            x={925}
            y={TOP + HEIGHT / 2 + 12}
            textAnchor="middle"
            className="small"
          >
            no route at any size
          </text>
          <text
            x={925}
            y={TOP + HEIGHT / 2 + 30}
            textAnchor="middle"
            className="small"
          >
            {NO_ROUTE.collateral} collateral
          </text>
        </g>
      </svg>
    </figure>
  );
}

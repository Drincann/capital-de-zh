"use client";

import type { AnalyticsSummary } from "@/lib/analytics";
import { useMemo, useState } from "react";

const ranges = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 },
  { label: "全部", value: 0 },
];

export function AnalyticsDashboard({
  summary,
  owner,
}: {
  summary: AnalyticsSummary;
  owner: string;
}) {
  const [range, setRange] = useState(30);
  const days = useMemo(
    () => (range ? summary.days.slice(-range) : summary.days),
    [range, summary.days],
  );
  const chart = chartGeometry(days);

  return (
    <main className="analytics-page">
      <header className="analytics-header">
        <div>
          <p>《资本论》第一卷</p>
          <h1>访问概况</h1>
        </div>
        <div className="analytics-account">
          <span>{owner}</span>
          <a href="/signout-with-chatgpt?return_to=%2F">退出</a>
        </div>
      </header>

      <section className="metric-grid" aria-label="累计与今日访问">
        <Metric label="累计访客" value={summary.totalVisitors} />
        <Metric label="累计浏览" value={summary.totalPageViews} />
        <Metric label="今日访客" value={summary.today.uniqueVisitors} />
        <Metric label="今日浏览" value={summary.today.pageViews} />
      </section>

      <section className="chart-card">
        <div className="chart-head">
          <div>
            <h2>UV / PV 趋势</h2>
            <p>按北京时间统计；只保存聚合数量。</p>
          </div>
          <div className="range-switch" aria-label="选择时间范围">
            {ranges.map((item) => (
              <button
                type="button"
                key={item.label}
                className={range === item.value ? "active" : ""}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {days.length ? (
          <>
            <div className="chart-legend">
              <span className="legend-uv">UV 访客</span>
              <span className="legend-pv">PV 浏览</span>
            </div>
            <div className="chart-wrap">
              <svg
                viewBox="0 0 900 320"
                role="img"
                aria-label="每日访客和浏览量折线图"
              >
                {[0, 1, 2, 3, 4].map((row) => {
                  const y = 24 + row * 64;
                  return (
                    <line
                      key={row}
                      x1="54"
                      y1={y}
                      x2="878"
                      y2={y}
                      className="grid-line"
                    />
                  );
                })}
                <polyline points={chart.pvPoints} className="line line-pv" />
                <polyline points={chart.uvPoints} className="line line-uv" />
                {chart.points.map((point) => (
                  <g key={point.day}>
                    <circle
                      cx={point.x}
                      cy={point.pvY}
                      r="4"
                      className="point point-pv"
                    >
                      <title>{`${point.day} · PV ${point.pageViews}`}</title>
                    </circle>
                    <circle
                      cx={point.x}
                      cy={point.uvY}
                      r="4"
                      className="point point-uv"
                    >
                      <title>{`${point.day} · UV ${point.uniqueVisitors}`}</title>
                    </circle>
                  </g>
                ))}
                <text x="54" y="311" className="axis-label">
                  {days[0]?.day}
                </text>
                <text x="878" y="311" textAnchor="end" className="axis-label">
                  {days.at(-1)?.day}
                </text>
                <text x="44" y="28" textAnchor="end" className="axis-label">
                  {chart.maxValue}
                </text>
                <text x="44" y="284" textAnchor="end" className="axis-label">
                  0
                </text>
              </svg>
            </div>
          </>
        ) : (
          <div className="analytics-empty">还没有访问数据。</div>
        )}
      </section>

      <section className="recent-table">
        <h2>最近日期</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>UV</th>
                <th>PV</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().slice(0, 14).map((day) => (
                <tr key={day.day}>
                  <td>{day.day}</td>
                  <td>{formatNumber(day.uniqueVisitors)}</td>
                  <td>{formatNumber(day.pageViews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </article>
  );
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function chartGeometry(days: AnalyticsSummary["days"]) {
  const width = 824;
  const height = 256;
  const left = 54;
  const top = 24;
  const maxValue = Math.max(
    1,
    ...days.flatMap((day) => [day.pageViews, day.uniqueVisitors]),
  );
  const denominator = Math.max(1, days.length - 1);
  const points = days.map((day, index) => {
    const x = left + (index / denominator) * width;
    const pvY = top + height - (day.pageViews / maxValue) * height;
    const uvY = top + height - (day.uniqueVisitors / maxValue) * height;
    return { ...day, x, pvY, uvY };
  });
  return {
    maxValue,
    points,
    pvPoints: points.map((point) => `${point.x},${point.pvY}`).join(" "),
    uvPoints: points.map((point) => `${point.x},${point.uvY}`).join(" "),
  };
}

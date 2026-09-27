"use client";

import {
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import type { ChartOptions } from "chart.js";
import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import { getObservations, type Observation } from "@/lib/sta";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip);

const temperatureId = Number(process.env.NEXT_PUBLIC_TEMPERATURE_DATASTREAM_ID);
const humidityId = Number(process.env.NEXT_PUBLIC_HUMIDITY_DATASTREAM_ID);
const refreshMs = Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 5000);
const staleMs = 15_000;
const historySize = 900; // 2초 간격 기준 30분

// 실내 쾌적 범위. ponytail: 일반적인 권장치 고정값, 계절별 기준이 필요하면 설정으로 뺀다.
const COMFORT = { tMin: 20, tMax: 26, hMin: 40, hMax: 60 };
// 쾌적도 차트 축 범위
const AXIS = { tMin: 14, tMax: 32, hMin: 20, hMax: 80 };

type Colors = { temp: string; hum: string; rule: string; muted: string };

function cssColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { temp: read("--temp"), hum: read("--hum"), rule: read("--rule"), muted: read("--muted") };
}

function verdict(t: number, h: number): string {
  const temp = t < COMFORT.tMin ? ["서늘하고", "서늘합니다"] : t > COMFORT.tMax ? ["덥고", "덥습니다"] : undefined;
  const hum = h < COMFORT.hMin ? "건조합니다" : h > COMFORT.hMax ? "습합니다" : undefined;
  const text = temp && hum ? `${temp[0]} ${hum}` : temp?.[1] ?? hum ?? "쾌적합니다";
  return `지금 방은 ${text}.`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초 전`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`;
}

function range(items: Observation[]) {
  if (items.length === 0) return undefined;
  const values = items.map((item) => item.result);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function seriesOptions(colors: Colors, unit: string, items: Observation[]): ChartOptions<"line"> {
  const first = items[0], last = items.at(-1);
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    scales: {
      x: {
        type: "linear",
        // 축을 실제 데이터 구간에 맞춘다 (자동 눈금이 빈 구간을 만드는 것 방지).
        min: first ? Date.parse(first.phenomenonTime) : undefined,
        max: last ? Date.parse(last.phenomenonTime) : undefined,
        grid: { display: false },
        border: { color: colors.rule },
        ticks: {
          color: colors.muted,
          maxTicksLimit: 5,
          callback: (value) => new Date(Number(value)).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }),
        },
      },
      y: {
        grid: { color: colors.rule },
        border: { display: false },
        ticks: { color: colors.muted, maxTicksLimit: 5, callback: (value) => `${value}${unit}` },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => {
            const time = items[0]?.parsed.x;
            return time == null ? "" : new Date(time).toLocaleTimeString("ko-KR");
          },
          label: (item) => `${item.parsed.y}${unit}`,
        },
      },
    },
  };
}

function seriesData(items: Observation[], color: string) {
  return {
    datasets: [{
      data: items.map((item) => ({ x: Date.parse(item.phenomenonTime), y: item.result })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 6,
      stepped: true as const, // DHT11은 0.1°C / 1% 단위라 계단형이 실제 측정에 맞다.
    }],
  };
}

function ComfortChart({ temperature, humidity }: { temperature: Observation[]; humidity: Observation[] }) {
  const W = 420, H = 300, P = { l: 36, r: 12, t: 12, b: 28 };
  const x = (t: number) => P.l + ((Math.min(AXIS.tMax, Math.max(AXIS.tMin, t)) - AXIS.tMin) / (AXIS.tMax - AXIS.tMin)) * (W - P.l - P.r);
  const y = (h: number) => H - P.b - ((Math.min(AXIS.hMax, Math.max(AXIS.hMin, h)) - AXIS.hMin) / (AXIS.hMax - AXIS.hMin)) * (H - P.t - P.b);

  // ESP32는 온도·습도를 같은 phenomenonTime으로 보낸다. 시각이 같은 것끼리 짝짓는다.
  const hByTime = new Map(humidity.map((item) => [item.phenomenonTime, item.result]));
  const pairs = temperature.flatMap((item) => {
    const h = hByTime.get(item.phenomenonTime);
    return h === undefined ? [] : [[item.result, h] as const];
  });
  const current = pairs.at(-1);
  const trail = pairs.map(([t, h]) => `${x(t).toFixed(1)},${y(h).toFixed(1)}`).join(" ");

  return (
    <figure className="comfort">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={current ? `현재 ${current[0]}°C, ${current[1]}%. 최근 30분 변화 경로 포함` : "데이터 없음"}>
        {[14, 17, 20, 23, 26, 29, 32].map((t) => (
          <g key={`t${t}`}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={P.t} y2={H - P.b} />
            <text x={x(t)} y={H - 8} textAnchor="middle">{t}°</text>
          </g>
        ))}
        {[20, 30, 40, 50, 60, 70, 80].map((h) => (
          <g key={`h${h}`}>
            <line className="grid" x1={P.l} x2={W - P.r} y1={y(h)} y2={y(h)} />
            <text x={P.l - 6} y={y(h) + 4} textAnchor="end">{h}%</text>
          </g>
        ))}
        <rect className="zone" x={x(COMFORT.tMin)} y={y(COMFORT.hMax)}
          width={x(COMFORT.tMax) - x(COMFORT.tMin)} height={y(COMFORT.hMin) - y(COMFORT.hMax)} />
        <text className="zone-label" x={x(COMFORT.tMin) + 6} y={y(COMFORT.hMax) + 16}>쾌적</text>
        {pairs.length > 1 && <polyline className="trail" points={trail} />}
        {current && (
          <>
            <circle className="halo" cx={x(current[0])} cy={y(current[1])} r={14} />
            <circle className="dot" cx={x(current[0])} cy={y(current[1])} r={5} />
          </>
        )}
      </svg>
      <figcaption>가로 온도, 세로 습도. 선은 최근 30분 동안 방 상태가 움직인 경로입니다.</figcaption>
    </figure>
  );
}

export default function Dashboard() {
  const [temperature, setTemperature] = useState<Observation[]>([]);
  const [humidity, setHumidity] = useState<Observation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [colors, setColors] = useState<Colors>();

  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    // 캔버스는 CSS 폰트를 상속하지 않으므로 페이지 폰트를 Chart.js에 넘긴다.
    ChartJS.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const update = () => setColors(cssColors());
    update();
    scheme.addEventListener("change", update);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { scheme.removeEventListener("change", update); clearInterval(clock); };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function load() {
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10_000);
      try {
        if (!Number.isFinite(refreshMs) || refreshMs < 1000 || temperatureId === humidityId) {
          throw new Error("설정 오류: Datastream ID가 서로 달라야 하고 갱신 주기는 1000ms 이상이어야 합니다.");
        }
        const [nextTemperature, nextHumidity] = await Promise.all([
          getObservations(temperatureId, historySize, request.signal),
          getObservations(humidityId, historySize, request.signal),
        ]);
        if (!stopped) {
          setTemperature(nextTemperature);
          setHumidity(nextHumidity);
          setError("");
        }
      } catch (cause) {
        request.abort();
        if (!stopped) setError(cause instanceof Error ? cause.message : "알 수 없는 오류");
      } finally {
        clearTimeout(timeout);
        if (!stopped) {
          setLoading(false);
          setNow(Date.now());
          timer = setTimeout(() => void load(), Number.isFinite(refreshMs) ? Math.max(1000, refreshMs) : 5000);
        }
      }
    }

    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  if (loading || !colors) return <main><p className="freshness">센서 값을 불러오는 중…</p></main>;

  const t = temperature.at(-1);
  const h = humidity.at(-1);
  const measuredAt = t ? Date.parse(t.phenomenonTime) : undefined;
  const age = measuredAt === undefined ? Infinity : now - measuredAt;
  const freshness = measuredAt === undefined ? "아직 측정값이 없습니다. ESP32 전원과 Wi-Fi를 확인하세요."
    : age < -10_000 ? "측정 시각이 현재보다 미래입니다. ESP32의 NTP 시간 동기화를 확인하세요."
    : age > staleMs ? `${ago(age)} 측정 이후 새 값이 없습니다. ESP32 전원과 Wi-Fi를 확인하세요.`
    : `${ago(age)} 측정`;
  const bad = measuredAt === undefined || age > staleMs || age < -10_000;
  const tRange = range(temperature);
  const hRange = range(humidity);

  return (
    <main>
      <header className="top">
        <h1>Lab Desk 온습도</h1>
        <p className={bad ? "freshness bad" : "freshness"} role="status">{freshness}</p>
      </header>

      {error && <p className="error" role="alert">최신 값을 가져오지 못해 마지막으로 받은 값을 보여줍니다. ({error})</p>}

      <section className="now" aria-label="현재 상태">
        <div>
          {t && h && <p className="verdict">{verdict(t.result, h.result)}</p>}
          <dl className="readings">
            <div className="t">
              <dt>온도</dt>
              <dd>{t ? t.result.toFixed(1) : "–"}<small>°C</small></dd>
              {tRange && <p className="range">30분 {tRange.min.toFixed(1)}–{tRange.max.toFixed(1)}°C</p>}
            </div>
            <div className="h">
              <dt>습도</dt>
              <dd>{h ? Math.round(h.result) : "–"}<small>%</small></dd>
              {hRange && <p className="range">30분 {hRange.min}–{hRange.max}%</p>}
            </div>
          </dl>
        </div>
        <ComfortChart temperature={temperature} humidity={humidity} />
      </section>

      <section className="history" aria-label="최근 30분 기록">
        <h2>최근 30분</h2>
        <div className="series">
          <div>
            <h3>온도</h3>
            <div className="plot">
              <Line options={seriesOptions(colors, "°", temperature)} data={seriesData(temperature, colors.temp)} role="img" aria-label="최근 30분 온도 그래프" />
            </div>
          </div>
          <div>
            <h3>습도</h3>
            <div className="plot">
              <Line options={seriesOptions(colors, "%", humidity)} data={seriesData(humidity, colors.hum)} role="img" aria-label="최근 30분 습도 그래프" />
            </div>
          </div>
        </div>
      </section>

      <footer>ESP32 + DHT11, 2초마다 측정. 데이터: OGC SensorThings API (FROST-Server).</footer>
    </main>
  );
}

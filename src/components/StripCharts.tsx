import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { useSimStore } from '../state/store';
import { CHANNELS, CHANNEL_META } from '../sim/constants';
import type { ChannelId } from '../sim/types';

const AXIS = {
  axisLine: { lineStyle: { color: '#232A33' } },
  axisLabel: { color: '#93A0B0', fontFamily: 'IBM Plex Mono', fontSize: 10 },
  splitLine: { lineStyle: { color: '#161B21' } },
};

const GRID = { left: 52, right: 14, top: 22, bottom: 22 };

function useChart(ref: React.RefObject<HTMLDivElement>) {
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    let c: echarts.ECharts | null = null;
    const ensure = () => {
      if (!ref.current || ref.current.clientWidth === 0 || ref.current.clientHeight === 0)
        return;
      if (!c) {
        c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
        chart.current = c;
      }
      c.resize();
    };
    ensure();
    const ro = new ResizeObserver(ensure);
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c?.dispose();
      chart.current = null;
    };
  }, [ref]);
  return chart;
}

export default function StripCharts() {
  const history = useSimStore((s) => s.history);
  const selected = useSimStore((s) => s.selectedChannel);
  const setSelected = useSimStore((s) => s.setSelectedChannel);
  const snapshot = useSimStore((s) => s.snapshot);

  const div1 = useRef<HTMLDivElement>(null);
  const div2 = useRef<HTMLDivElement>(null);
  const c1 = useChart(div1);
  const c2 = useChart(div2);

  const meta = CHANNEL_META[selected];
  const series = useMemo(() => {
    const m: [number, number | null][] = [];
    const tw: [number, number | null][] = [];
    const z: [number, number | null][] = [];
    for (const r of history) {
      m.push([r.t, r.m[selected] ?? null]);
      tw.push([r.t, r.tw[selected] ?? null]);
      z.push([r.t, r.z[selected] ?? null]);
    }
    return { m, tw, z };
  }, [history, selected]);

  const tEnd = snapshot?.t ?? history[history.length - 1]?.t ?? 10;
  const tStart = Math.max(0, tEnd - 120);

  useEffect(() => {
    c1.current?.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: GRID,
      textStyle: { fontFamily: 'IBM Plex Mono' },
      legend: {
        data: ['measured', 'twin'],
        textStyle: { color: '#93A0B0', fontSize: 10 },
        top: 2,
        right: 8,
        icon: 'rect',
        itemWidth: 10,
        itemHeight: 2,
      },
      xAxis: { type: 'value', min: tStart, max: tEnd, ...AXIS },
      yAxis: { type: 'value', scale: true, ...AXIS },
      series: [
        {
          name: 'measured',
          type: 'line',
          data: series.m,
          showSymbol: false,
          lineStyle: { color: '#5B8DB8', width: 1 },
        },
        {
          name: 'twin',
          type: 'line',
          data: series.tw,
          showSymbol: false,
          lineStyle: { color: '#D7DEE7', width: 1, type: 'dashed' },
        },
      ],
    });
  }, [series, tStart, tEnd, c1]);

  useEffect(() => {
    const th = (v: number, color: string) => ({
      yAxis: v,
      lineStyle: { color, type: 'dashed' as const, width: 1 },
      label: { color, fontSize: 9, formatter: `${v > 0 ? '+' : ''}${v}σ` },
    });
    c2.current?.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: GRID,
      textStyle: { fontFamily: 'IBM Plex Mono' },
      xAxis: { type: 'value', min: tStart, max: tEnd, ...AXIS },
      yAxis: { type: 'value', scale: true, ...AXIS },
      series: [
        {
          type: 'line',
          data: series.z,
          showSymbol: false,
          lineStyle: { color: '#5B8DB8', width: 1 },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              th(3, '#C9922E'),
              th(-3, '#C9922E'),
              th(5, '#C4443F'),
              th(-5, '#C4443F'),
            ],
          },
        },
      ],
    });
  }, [series, tStart, tEnd, c2]);

  const zNow = snapshot?.readings[selected]?.zEwma ?? 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="min-h-8 shrink-0 border-b border-edge flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
        <span className="font-mono text-dim uppercase tracking-wide">Channel</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value as ChannelId)}>
          {CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.unit ? ` [${c.unit}]` : ''}
            </option>
          ))}
        </select>
        <span className="num font-mono whitespace-nowrap">
          MEAS {snapshot ? snapshot.readings[selected].measured.toFixed(1) : '--'}
          {meta.unit ? ` ${meta.unit}` : ''} &middot; TWIN{' '}
          {snapshot ? snapshot.readings[selected].twin.toFixed(1) : '--'} &middot; Z_EWMA{' '}
          <span style={{ color: Math.abs(zNow) >= 5 ? '#C4443F' : Math.abs(zNow) >= 3 ? '#C9922E' : '#93A0B0' }}>
            {zNow >= 0 ? '+' : ''}
            {zNow.toFixed(1)}
          </span>
        </span>
      </div>
      <div className="flex-1 min-h-0 border-b border-edge relative">
        <div className="absolute top-1 left-3 text-dim font-mono uppercase tracking-wide">
          measured vs twin - last 120 s
        </div>
        <div ref={div1} className="w-full h-full" />
      </div>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute top-1 left-3 text-dim font-mono uppercase tracking-wide z-10">
          residual z-score (EWMA) - thresholds ±3σ ±5σ
        </div>
        <div ref={div2} className="w-full h-full" />
      </div>
    </div>
  );
}

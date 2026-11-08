import React, { useState, useEffect } from 'react';
import { HudFrame, GaugeCircle, StatusCard } from '@/components/hud';

export function Dashboard() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (date: Date) => 
    date.toTimeString().split(' ')[0];

  return (
    <div style={{ 
      minHeight: '100vh', 
      padding: '20px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '16px',
      maxWidth: '1600px',
      margin: '0 auto',
    }}>
      {/* Left Column - Status Cards + GPU Gauge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <HudFrame title="SYSTEM MONITOR // v4.0.1.16" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <StatusCard 
            label="SYS STATUS" 
            value="ONLINE" 
            sub="NOMINAL" 
            status="online" 
          />
          <StatusCard 
            label="UPTIME" 
            value={formatTime(time)} 
            sub="NOMINAL" 
            status="online" 
          />
          <StatusCard 
            label="KERNEL" 
            value="5.15.0" 
            sub="SECURE // NOMINAL" 
            status="online" 
          />
        </HudFrame>

        <HudFrame title="GPU // NVIDIA GeForce 940MX" style={{ minHeight: '320px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '260px' }}>
            <GaugeCircle
              label="GPU"
              value="64%"
              sub="TEMP 58C • VRAM 2.0/4.0 GB"
              percent={64}
              size={280}
            />
          </div>
        </HudFrame>
      </div>

      {/* Right Column - 3 Gauges diagonal layout */}
      <div style={{ 
        display: 'grid', 
        gridTemplateRows: 'repeat(3, 1fr)', 
        gap: '16px',
        transform: 'translateY(-20px)',
      }}>
        <HudFrame title="CPU LOAD" style={{ minHeight: '240px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px' }}>
            <GaugeCircle
              label="CPU"
              value="42%"
              sub="3.4GHz"
              percent={42}
              size={200}
            />
          </div>
        </HudFrame>

        <HudFrame title="MEMORY" style={{ minHeight: '240px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px' }}>
            <GaugeCircle
              label="MEMORY"
              value="6.2/8GB"
              sub="78%"
              percent={78}
              size={200}
            />
          </div>
        </HudFrame>

        <HudFrame title="FPS" style={{ minHeight: '240px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px' }}>
            <GaugeCircle
              label="FPS"
              value="60"
              sub="STABLE"
              percent={100}
              size={200}
            />
          </div>
        </HudFrame>
      </div>

      {/* Footer */}
      <div style={{ 
        gridColumn: '1 / -1',
        textAlign: 'right',
        padding: '12px 24px',
        fontSize: '11px',
        letterSpacing: '3px',
        color: 'var(--text-dim)',
        fontFamily: 'Rajdhani, monospace',
        textTransform: 'uppercase',
      }}>
        PERFORMANCE // REALTIME / LATENCY: 6ms | POWER: 22W
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';

interface StatusInfo {
  configured: boolean;
  booted: boolean;
  state: string;
  authorized: boolean;
  connected: boolean;
  user?: {
    first_name: string;
    last_name: string;
    username: string;
    phone_number: string;
    id: string;
    is_premium: boolean;
  };
  proxy: any;
}

export default function DashboardStatus() {
  const [status, setStatus] = useState<StatusInfo | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      const res = await fetch('/api/telegram/status');
      if (res.ok) setStatus(await res.json());
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const color = status.connected ? 'var(--krynara-green)' : 'var(--krynara-amber)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="status-dot" style={{ color, background: color }} />
      {status.connected ? 'Telegram Connected' : 'Telegram Disconnected'}
    </div>
  );
}

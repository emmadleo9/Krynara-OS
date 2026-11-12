import { useState, useCallback, useEffect } from 'react';
import type { TgStatus } from '@/features/social/TelegramLive';

/**
 * Shared hook that fetches Telegram bridge status and keeps it up‑to‑date.
 * Returns the status object, a manual refresh function, and any bridge error.
 */
export const useTelegramStatus = () => {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [bridgeError, setBridgeError] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      const data = (await res.json()) as TgStatus;
      setStatus(data);
      if (!res.ok) {
        setBridgeError(data.error || `Bridge offline (HTTP ${res.status})`);
      } else {
        setBridgeError('');
      }
      return data;
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  // Initial load + periodic refresh (6 s)
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 6000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  return { status, refreshStatus, bridgeError };
};

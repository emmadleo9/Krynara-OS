import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { restartSwarm } from './swarmRebuildCore';
import './swarm.css';

declare global {
  interface Window {
    __swarmRebuild?: {
      toggle: () => void;
      start: () => void;
      stop: (reveal?: boolean) => void;
      restart: () => void;
      app: unknown;
      isRunning: boolean;
      setSpeed: (val: number) => void;
      setSound: (val: boolean) => void;
      toggleTour: () => void;
    };
    __swarmShowFloatingHud?: boolean;
    __swarmShot?: string | null;
    __swarmHidden?: boolean;
    __swarmUnhide?: () => void;
  }
}

export function SwarmOverlay() {
  const { pathname } = useLocation();

  // Route change handler: when navigating across views, rebuild the new view with the full fleet
  useEffect(() => {
    const autoNav = localStorage.getItem('krynara_swarm_auto_nav') !== 'false';
    if (!autoNav) return;

    // Small delay to allow React to render the new route's DOM before snapshot
    const timer = setTimeout(() => {
      if (window.__swarmRebuild) {
        window.__swarmRebuild.restart();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [pathname]);

  // Touch & shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+Shift+S shortcut to toggle rebuild
      if (e.altKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        window.__swarmRebuild?.toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}

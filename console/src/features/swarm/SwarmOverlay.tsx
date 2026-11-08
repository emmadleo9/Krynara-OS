import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { restartSwarm, triggerScrollSwarm } from './swarmRebuildCore';
import './swarm.css';

declare global {
  interface Window {
    __swarmRebuild?: {
      toggle: () => void;
      start: () => void;
      stop: (reveal?: boolean) => void;
      restart: () => void;
      triggerScrollRebuild: () => void;
      updateConfig?: (patch: Record<string, unknown>) => void;
      getConfig?: () => Record<string, unknown>;
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
  const navTimerRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<number | null>(null);

  // Menu navigation & route change:
  // When user opens any new part of website via menu or link, arrow agents fly in from top-right corner,
  // rebuild the view's components, and when rebuild is done navigate from middle to top-right corner and vanish.
  useEffect(() => {
    const autoNav = localStorage.getItem('krynara_swarm_auto_nav') !== 'false';
    if (!autoNav) return;

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    if (navTimerRef.current !== null) {
      window.clearTimeout(navTimerRef.current);
    }

    navTimerRef.current = window.setTimeout(() => {
      restartSwarm();
    }, 180);

    return () => {
      if (navTimerRef.current !== null) {
        window.clearTimeout(navTimerRef.current);
      }
    };
  }, [pathname]);

  // Scroll handler:
  // If user scrolls in any part, arrow agents come back in vice versa from top-right corner,
  // develop the in-view components, and leave/vanish to the top-right corner again.
  useEffect(() => {
    const handleScroll = () => {
      const autoScroll = localStorage.getItem('krynara_swarm_auto_scroll') !== 'false';
      if (!autoScroll) return;

      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }

      scrollTimerRef.current = window.setTimeout(() => {
        triggerScrollSwarm();
      }, 220);
    };

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, []);

  // Shortcut listener: Alt+Shift+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        window.__swarmRebuild?.toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Touch / click trigger:
  // If autoTouch is enabled in settings, any click/tap anywhere restarts the swarm.
  // Uses a cooldown so rapid clicks don't spam restarts.
  useEffect(() => {
    let lastTrigger = 0;
    const handlePointerDown = () => {
      const autoTouch = localStorage.getItem('krynara_swarm_auto_touch') === 'true';
      if (!autoTouch) return;
      const now = Date.now();
      // 3-second cooldown between touch-triggered rebuilds
      if (now - lastTrigger < 3000) return;
      lastTrigger = now;
      window.__swarmRebuild?.restart();
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, []);

  return null;
}

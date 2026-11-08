import { useEffect, useRef } from 'react';
import { swarmEngine } from './swarmEngine';
import './swarm.css';

export function SwarmOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorsRef = useRef<HTMLDivElement>(null);
  const ovSvgRef = useRef<SVGSVGElement>(null);
  const badgesRef = useRef<HTMLDivElement>(null);
  const rulersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      containerRef.current &&
      cursorsRef.current &&
      ovSvgRef.current &&
      badgesRef.current &&
      rulersRef.current
    ) {
      swarmEngine.mount(
        containerRef.current,
        cursorsRef.current,
        ovSvgRef.current,
        badgesRef.current,
        rulersRef.current,
      );
    }

    return () => {
      swarmEngine.unmount();
    };
  }, []);

  return (
    <div className="swarm-overlay-root" ref={containerRef}>
      <svg className="swarm-svg-layer" ref={ovSvgRef} />
      <div className="swarm-badges-layer" ref={badgesRef} />
      <div className="swarm-cursors-layer" ref={cursorsRef} />
      <div className="swarm-rulers-layer" ref={rulersRef} />
    </div>
  );
}


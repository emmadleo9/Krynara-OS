export interface SwarmRebuildController {
  toggle: () => void;
  start: () => void;
  stop: (reveal?: boolean) => void;
  restart: () => void;
  app: unknown;
  isRunning: boolean;
  setSpeed: (val: number) => void;
  setSound: (val: boolean) => void;
  toggleTour: () => void;
}

export declare const swarmController: SwarmRebuildController | null;
export declare function startSwarm(): void;
export declare function stopSwarm(reveal?: boolean): void;
export declare function restartSwarm(): void;
export default swarmController;


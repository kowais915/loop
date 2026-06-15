import type { RingStage, Stage } from "./types";

export interface StageMeta {
  key: RingStage;
  label: string;
  blurb: string;
  color: string; // hex for SVG
  tw: string; // tailwind text color
}

// The orb is the one colorful element — each stage has its own hue. (The rest of
// the app stays restrained zinc + emerald.)
export const STAGE_META: Record<RingStage, StageMeta> = {
  detect: {
    key: "detect",
    label: "Detect",
    blurb: "Confirm the anomaly & onset",
    color: "#38bdf8",
    tw: "text-sky-400",
  },
  diagnose: {
    key: "diagnose",
    label: "Diagnose",
    blurb: "Correlate latency ↔ deploy",
    color: "#a855f7",
    tw: "text-purple-400",
  },
  remediate: {
    key: "remediate",
    label: "Remediate",
    blurb: "Propose the fix — human approves",
    color: "#f59e0b",
    tw: "text-amber-400",
  },
  verify: {
    key: "verify",
    label: "Verify",
    blurb: "Prove recovery on live data",
    color: "#10b981",
    tw: "text-emerald-400",
  },
  learn: {
    key: "learn",
    label: "Learn",
    blurb: "Remember the signature",
    color: "#f472b6",
    tw: "text-pink-400",
  },
};

export const RING_ORDER: RingStage[] = [
  "detect",
  "diagnose",
  "remediate",
  "verify",
  "learn",
];

// How far the loop has progressed, as an index into RING_ORDER.
// awaiting_approval sits between remediate and verify (the open arc).
export function stageProgress(stage: Stage): {
  activeIndex: number;
  atGate: boolean;
  done: boolean;
  rejected: boolean;
} {
  switch (stage) {
    case "detect":
      return { activeIndex: 0, atGate: false, done: false, rejected: false };
    case "diagnose":
      return { activeIndex: 1, atGate: false, done: false, rejected: false };
    case "remediate":
      return { activeIndex: 2, atGate: false, done: false, rejected: false };
    case "awaiting_approval":
      return { activeIndex: 2, atGate: true, done: false, rejected: false };
    case "verify":
      return { activeIndex: 3, atGate: false, done: false, rejected: false };
    case "learn":
      return { activeIndex: 4, atGate: false, done: false, rejected: false };
    case "resolved":
      return { activeIndex: 4, atGate: false, done: true, rejected: false };
    case "rejected":
      return { activeIndex: 2, atGate: false, done: false, rejected: true };
    default:
      return { activeIndex: 0, atGate: false, done: false, rejected: false };
  }
}

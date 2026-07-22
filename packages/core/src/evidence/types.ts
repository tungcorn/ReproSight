export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EnvironmentInfo = {
  browserName: string;
  browserVersion: string;
  userAgent: string;
  os: string;
  platform: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  theme: string;
  colorScheme: string;
  readyUrl: string;
  capturedAt: string;
};

export type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
  timestamp: string;
};

export type FailedRequest = {
  url: string;
  method: string;
  status?: number;
  failureText?: string;
  timestamp: string;
};

export type OverflowFinding = {
  id: string;
  kind: "horizontalOverflow";
  selector: string;
  domPath: string;
  rect: Rect;
  parentRect: Rect | null;
  overflowAmount: number;
  position: string;
  transform: string;
  width: string;
  minWidth: string;
  maxWidth: string;
  whiteSpace: string;
  flexOrGrid: string;
  ignored: boolean;
  decorativeLikely: boolean;
};

export type OverlapFinding = {
  id: string;
  kind: "overlap";
  selectorA: string;
  selectorB: string;
  intersection: Rect;
  overlapRatioA: number;
  overlapRatioB: number;
  zIndexA: string;
  zIndexB: string;
  positionA: string;
  positionB: string;
  interactionObstructed: boolean;
  ignored: boolean;
};

export type ClippingFinding = {
  id: string;
  kind: "textClipping";
  selector: string;
  domPath: string;
  rect: Rect;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  whiteSpace: string;
  lineClamp: string;
  ignored: boolean;
};

export type StickyOcclusionFinding = {
  id: string;
  kind: "stickyOcclusion";
  targetSelector: string;
  headerSelector: string;
  targetRect: Rect;
  headerRect: Rect;
  scrollY: number;
  scrollMarginTop: string;
  obscuredPx: number;
};

export type AxeViolationSummary = {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
};

export type DetectorEvidence = {
  horizontalOverflow: OverflowFinding[];
  overlap: OverlapFinding[];
  textClipping: ClippingFinding[];
  stickyOcclusion: StickyOcclusionFinding[];
  accessibility: {
    violations: AxeViolationSummary[];
    incomplete: number;
    passes: number;
    note: string;
  };
  documentMetrics: {
    clientWidth: number;
    scrollWidth: number;
    bodyClientWidth: number;
    bodyScrollWidth: number;
    clientHeight: number;
    scrollHeight: number;
  };
};

export type SourceCandidate = {
  elementSelector: string;
  file: string | null;
  line: number | null;
  lineEnd: number | null;
  selector: string;
  media: string | null;
  property: string;
  value: string;
  computedValue: string;
  reason: string;
  rank: number;
  score: number;
  stylesheetUrl: string | null;
};

export type EvidencePack = {
  environment: EnvironmentInfo;
  detectors: DetectorEvidence;
  sourceCandidates: SourceCandidate[];
  console: ConsoleEntry[];
  failedRequests: FailedRequest[];
  screenshots: {
    before: string | null;
    beforeAnnotated: string | null;
  };
  traces: {
    before: string | null;
  };
  notes: string[];
};

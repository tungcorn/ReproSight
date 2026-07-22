export type BenchCase = {
  id: string;
  fixture: string;
  port: number;
  title: string;
  detector:
    | "horizontalOverflow"
    | "overlap"
    | "textClipping"
    | "stickyOcclusion"
    | "accessibility";
  issue: {
    id: string;
    title: string;
    description: string;
    route: string;
    state: {
      viewport: { width: number; height: number };
      locale: string;
      theme: "dark" | "light";
    };
    actions: Array<Record<string, unknown>>;
    assertions: Array<Record<string, unknown>>;
    expected?: Record<string, unknown>;
  };
  localization?: {
    sourceFile: string;
    property?: string;
    selectorIncludes?: string;
  };
  e2eMock?: boolean;
  difficulty: "easy" | "medium" | "hard";
};

export const BENCH_CASES: BenchCase[] = [
  {
    id: "container-stretch",
    fixture: "container-stretch",
    port: 4173,
    title: "Hero container max-width override",
    detector: "horizontalOverflow",
    difficulty: "medium",
    localization: {
      sourceFile: "styles.css",
      property: "max-width",
      selectorIncludes: ".hero",
    },
    e2eMock: true,
    issue: {
      id: "container-stretch",
      title: "Hero becomes edge-to-edge at desktop",
      description:
        "At 1440px, a Hero section that also has a .container class becomes edge-to-edge because a later .hero { max-width: 100%; } rule overrides the shared .container { max-width: 1080px; margin: 0 auto; } rule.",
      route: "/",
      state: {
        viewport: { width: 1440, height: 900 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [
        { type: "noHorizontalOverflow" },
        { type: "selectorWithinViewport", selector: "#hero" },
      ],
      expected: {
        detector: "horizontalOverflow",
        culpritSelector: ".hero",
        sourceFile: "styles.css",
        property: "max-width",
        difficulty: "medium",
      },
    },
  },
  {
    id: "locale-overflow-vi-768",
    fixture: "locale-overflow",
    port: 4174,
    title: "Vietnamese tablet overflow",
    detector: "horizontalOverflow",
    difficulty: "hard",
    localization: {
      sourceFile: "styles.css",
      property: "white-space",
      selectorIncludes: "about__highlights",
    },
    e2eMock: true,
    issue: {
      id: "locale-overflow-vi-768",
      title: "Vietnamese About highlights overflow at tablet width",
      description:
        "At 768px in Vietnamese, the highlight rows extend outside the viewport because white-space:nowrap and a late grid override raise min-content width.",
      route: "/",
      state: {
        viewport: { width: 768, height: 1024 },
        locale: "vi",
        theme: "dark",
      },
      actions: [
        { type: "click", selector: "[data-language-toggle]" },
        { type: "scrollIntoView", selector: "#about" },
      ],
      assertions: [
        { type: "noHorizontalOverflow" },
        { type: "selectorWithinViewport", selector: "#about" },
      ],
      expected: {
        detector: "horizontalOverflow",
        culpritSelector: ".about__highlights strong",
        sourceFile: "styles.css",
        property: "white-space",
        difficulty: "hard",
      },
    },
  },
  {
    id: "overlap-cta-badge",
    fixture: "overlap",
    port: 4175,
    title: "CTA covered by absolute badge",
    detector: "overlap",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "position",
      selectorIncludes: "badge",
    },
    e2eMock: true,
    issue: {
      id: "overlap-cta-badge",
      title: "CTA covered by absolute element",
      description: "A NEW badge overlaps the primary CTA.",
      route: "/",
      state: {
        viewport: { width: 390, height: 844 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noOverlap", a: "#cta", b: "#badge" }],
      expected: {
        detector: "overlap",
        culpritSelector: "#badge",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
  {
    id: "clipping-vi-paragraph",
    fixture: "clipping",
    port: 4176,
    title: "Fixed-height paragraph clips translation",
    detector: "textClipping",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "overflow",
      selectorIncludes: "clip",
    },
    e2eMock: true,
    issue: {
      id: "clipping-vi-paragraph",
      title: "Fixed-height paragraph clips translated content",
      description: "Vietnamese paragraph is clipped by fixed height + overflow hidden.",
      route: "/",
      state: {
        viewport: { width: 390, height: 844 },
        locale: "vi",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noTextClipping", selector: "#clip" }],
      expected: {
        detector: "textClipping",
        culpritSelector: "#clip",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
  {
    id: "sticky-heading-occlusion",
    fixture: "sticky-anchor",
    port: 4177,
    title: "Anchor heading hidden under sticky nav",
    detector: "stickyOcclusion",
    difficulty: "medium",
    localization: {
      sourceFile: "styles.css",
      property: "scroll-margin-top",
      selectorIncludes: "section",
    },
    e2eMock: true,
    issue: {
      id: "sticky-heading-occlusion",
      title: "Anchor heading hidden below sticky navigation",
      description: "Scrolling to #section places the heading under sticky nav.",
      route: "/",
      state: {
        viewport: { width: 1440, height: 900 },
        locale: "en",
        theme: "dark",
      },
      actions: [{ type: "scrollIntoView", selector: "#section" }],
      assertions: [{ type: "noStickyOcclusion", selector: "#section" }],
      expected: {
        detector: "stickyOcclusion",
        culpritSelector: "#section",
        sourceFile: "styles.css",
        difficulty: "medium",
      },
    },
  },
  {
    id: "contrast-light",
    fixture: "contrast",
    port: 4178,
    title: "Light-theme contrast regression",
    detector: "accessibility",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "color",
      selectorIncludes: "ghost",
    },
    issue: {
      id: "contrast-light",
      title: "Light-theme contrast regression",
      description: "Ghost button text is nearly invisible on light background.",
      route: "/",
      state: {
        viewport: { width: 1280, height: 800 },
        locale: "en",
        theme: "light",
      },
      actions: [],
      assertions: [{ type: "noHorizontalOverflow" }],
      expected: {
        detector: "accessibility",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
  {
    id: "grid-mincontent-overflow",
    fixture: "grid-mincontent",
    port: 4179,
    title: "Grid min-content overflow",
    detector: "horizontalOverflow",
    difficulty: "medium",
    localization: {
      sourceFile: "styles.css",
      property: "white-space",
      selectorIncludes: "long",
    },
    e2eMock: true,
    issue: {
      id: "grid-mincontent-overflow",
      title: "Grid min-content overflow",
      description: "Unbreakable token in grid cell expands page width.",
      route: "/",
      state: {
        viewport: { width: 390, height: 844 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noHorizontalOverflow" }],
      expected: {
        detector: "horizontalOverflow",
        culpritSelector: "#long",
        sourceFile: "styles.css",
        difficulty: "medium",
      },
    },
  },
  {
    id: "mobile-nav-overflow",
    fixture: "mobile-nav-overflow",
    port: 4180,
    title: "Mobile navigation overflow",
    detector: "horizontalOverflow",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "white-space",
      selectorIncludes: "nav",
    },
    issue: {
      id: "mobile-nav-overflow",
      title: "Mobile navigation overflow",
      description: "Top nav links overflow the mobile viewport.",
      route: "/",
      state: {
        viewport: { width: 390, height: 844 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noHorizontalOverflow" }],
      expected: {
        detector: "horizontalOverflow",
        culpritSelector: "#nav",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
  {
    id: "cards-overlap-breakpoint",
    fixture: "cards-overlap",
    port: 4181,
    title: "Cards overlap at breakpoint",
    detector: "overlap",
    difficulty: "medium",
    localization: {
      sourceFile: "styles.css",
      property: "left",
      selectorIncludes: "card-b",
    },
    issue: {
      id: "cards-overlap-breakpoint",
      title: "Cards overlap at a breakpoint",
      description: "Two absolutely positioned cards intersect at 768px.",
      route: "/",
      state: {
        viewport: { width: 768, height: 1024 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noOverlap", a: "#card-a", b: "#card-b" }],
      expected: {
        detector: "overlap",
        culpritSelector: "#card-b",
        sourceFile: "styles.css",
        difficulty: "medium",
      },
    },
  },
  {
    id: "fixed-badge-blocks-control",
    fixture: "fixed-badge",
    port: 4182,
    title: "Fixed badge blocks interactive control",
    detector: "overlap",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "z-index",
      selectorIncludes: "promo",
    },
    issue: {
      id: "fixed-badge-blocks-control",
      title: "Fixed badge blocks an interactive control",
      description: "Promo badge covers the save button.",
      route: "/",
      state: {
        viewport: { width: 390, height: 844 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noOverlap", a: "#save", b: "#promo" }],
      expected: {
        detector: "overlap",
        culpritSelector: "#promo",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
  {
    id: "desktop-container-maxwidth",
    fixture: "desktop-maxwidth",
    port: 4183,
    title: "Desktop container max-width accidentally overridden",
    detector: "horizontalOverflow",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "max-width",
      selectorIncludes: "panel",
    },
    issue: {
      id: "desktop-container-maxwidth",
      title: "Desktop container max-width accidentally overridden",
      description: "Shared container max-width is overridden by later panel rule.",
      route: "/",
      state: {
        viewport: { width: 1440, height: 900 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noHorizontalOverflow" }],
      expected: {
        detector: "horizontalOverflow",
        culpritSelector: "#panel",
        sourceFile: "styles.css",
        property: "max-width",
        difficulty: "easy",
      },
    },
  },
  {
    id: "focus-indicator-removed",
    fixture: "focus-lost",
    port: 4184,
    title: "Focus indicator visually removed",
    detector: "accessibility",
    difficulty: "easy",
    localization: {
      sourceFile: "styles.css",
      property: "outline",
      selectorIncludes: "focus-link",
    },
    issue: {
      id: "focus-indicator-removed",
      title: "Focus indicator visually removed",
      description: "Link focus styles are forcibly removed.",
      route: "/",
      state: {
        viewport: { width: 1280, height: 800 },
        locale: "en",
        theme: "dark",
      },
      actions: [],
      assertions: [{ type: "noHorizontalOverflow" }],
      expected: {
        detector: "accessibility",
        culpritSelector: "#focus-link",
        sourceFile: "styles.css",
        difficulty: "easy",
      },
    },
  },
];

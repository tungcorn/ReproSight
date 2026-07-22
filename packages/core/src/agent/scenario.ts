import type { AgentRequest } from "./request.js";
import type { IssueSpec } from "../scenario/issue.js";
import { parseIssue } from "../scenario/issue.js";
import type { InferredField } from "./response.js";

export type ScenarioInference = {
  issue: IssueSpec;
  fields: Record<string, InferredField<unknown>>;
  unresolved: string[];
};

function inferViewport(
  description: string,
  hint?: { width: number; height: number },
): InferredField<{ width: number; height: number }> {
  if (hint) {
    return {
      value: hint,
      source: "external-agent",
      confidence: 0.95,
      reason: "stateHints.viewport",
    };
  }
  const dim = description.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/i);
  if (dim) {
    return {
      value: { width: Number(dim[1]), height: Number(dim[2]) },
      source: "user-description",
      confidence: 0.9,
      reason: "explicit WxH in description",
    };
  }
  if (/\b390\b/.test(description) || /\bmobile\b/i.test(description)) {
    return {
      value: { width: 390, height: 844 },
      source: "user-description",
      confidence: 0.75,
      reason: "mobile keyword",
    };
  }
  if (/\b768\b/.test(description) || /\btablet\b/i.test(description)) {
    return {
      value: { width: 768, height: 1024 },
      source: "user-description",
      confidence: 0.75,
      reason: "tablet keyword",
    };
  }
  if (/\b1440\b/.test(description) || /\bdesktop\b/i.test(description)) {
    return {
      value: { width: 1440, height: 900 },
      source: "user-description",
      confidence: 0.7,
      reason: "desktop keyword",
    };
  }
  return {
    value: { width: 1280, height: 800 },
    source: "framework-default",
    confidence: 0.4,
    requiresConfirmation: true,
    reason: "default desktop-ish viewport",
  };
}

function inferLocale(description: string, hint?: string): InferredField<string> {
  if (hint) {
    return {
      value: hint,
      source: "external-agent",
      confidence: 0.95,
    };
  }
  if (/vietnamese|tiếng việt|\bvi\b/i.test(description)) {
    return {
      value: "vi",
      source: "user-description",
      confidence: 0.85,
      reason: "Vietnamese mentioned",
    };
  }
  if (/english|\ben\b/i.test(description)) {
    return {
      value: "en",
      source: "user-description",
      confidence: 0.8,
    };
  }
  return {
    value: "en",
    source: "framework-default",
    confidence: 0.5,
    reason: "default locale",
  };
}

function inferTheme(
  description: string,
  hint?: "dark" | "light",
): InferredField<"dark" | "light"> {
  if (hint) {
    return { value: hint, source: "external-agent", confidence: 0.95 };
  }
  if (/dark mode|theme:\s*dark|\bdark\b/i.test(description)) {
    return {
      value: "dark",
      source: "user-description",
      confidence: 0.75,
    };
  }
  if (/light mode|theme:\s*light|\blight\b/i.test(description)) {
    return {
      value: "light",
      source: "user-description",
      confidence: 0.75,
    };
  }
  return {
    value: "dark",
    source: "framework-default",
    confidence: 0.45,
    reason: "default theme",
  };
}

function inferRoute(description: string, hint?: string): InferredField<string> {
  if (hint) {
    return { value: hint, source: "external-agent", confidence: 0.95 };
  }
  const path = description.match(/(\/[A-Za-z0-9_\-./]+)/);
  if (path?.[1] && path[1].length > 1) {
    return {
      value: path[1],
      source: "user-description",
      confidence: 0.8,
      reason: "path-like token in description",
    };
  }
  if (/checkout/i.test(description)) {
    return {
      value: "/checkout",
      source: "user-description",
      confidence: 0.55,
      requiresConfirmation: true,
      reason: "checkout keyword",
    };
  }
  return {
    value: "/",
    source: "framework-default",
    confidence: 0.5,
    reason: "default route",
  };
}

function inferCategory(
  description: string,
  hint?: string,
): InferredField<string> {
  if (hint) {
    return { value: hint, source: "external-agent", confidence: 0.9 };
  }
  if (/overlap|cover|obstruct|blocks?/i.test(description)) {
    return {
      value: "overlap",
      source: "user-description",
      confidence: 0.8,
    };
  }
  if (/clip|truncat|cut off/i.test(description)) {
    return {
      value: "textClipping",
      source: "user-description",
      confidence: 0.8,
    };
  }
  if (/sticky|under (the )?header|hidden under/i.test(description)) {
    return {
      value: "stickyOcclusion",
      source: "user-description",
      confidence: 0.75,
    };
  }
  if (/overflow|scroll horizontally|tràn/i.test(description)) {
    return {
      value: "horizontalOverflow",
      source: "user-description",
      confidence: 0.8,
    };
  }
  return {
    value: "horizontalOverflow",
    source: "framework-default",
    confidence: 0.4,
    requiresConfirmation: true,
    reason: "default detector family",
  };
}

function assertionsForCategory(
  category: string,
  selectors: string[],
): IssueSpec["assertions"] {
  switch (category) {
    case "overlap":
      if (selectors.length >= 2) {
        return [
          {
            type: "noOverlap",
            a: selectors[0]!,
            b: selectors[1]!,
          },
        ];
      }
      return [{ type: "noHorizontalOverflow" }];
    case "textClipping":
      return [
        {
          type: "noTextClipping",
          selector: selectors[0],
        },
      ];
    case "stickyOcclusion":
      return [
        {
          type: "noStickyOcclusion",
          selector: selectors[0] ?? "h1,h2,h3",
        },
      ];
    default:
      return [{ type: "noHorizontalOverflow" }];
  }
}

export function inferScenario(request: AgentRequest): ScenarioInference {
  const description = request.task.description;
  const viewport = inferViewport(description, request.stateHints?.viewport);
  const locale = inferLocale(description, request.stateHints?.locale);
  const theme = inferTheme(description, request.stateHints?.theme);
  const route = inferRoute(description, request.stateHints?.route);
  const category = inferCategory(
    description,
    request.reproductionHints?.category,
  );
  const selectors = request.reproductionHints?.suspectedSelectors ?? [];
  const actions =
    request.reproductionHints?.actions ??
    (category.value === "stickyOcclusion" && selectors[0]
      ? [{ type: "scrollIntoView" as const, selector: selectors[0] }]
      : []);

  const idBase = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const issue = parseIssue({
    id: idBase || "agent-issue",
    title: description.slice(0, 120),
    description,
    route: route.value,
    state: {
      viewport: viewport.value,
      locale: locale.value,
      theme: theme.value,
    },
    actions,
    assertions: assertionsForCategory(String(category.value), selectors),
    screenshot: request.task.screenshot ?? null,
  });

  const fields: Record<string, InferredField<unknown>> = {
    "state.viewport": viewport,
    "state.locale": locale,
    "state.theme": theme,
    route,
    category,
  };

  const unresolved = Object.entries(fields)
    .filter(([, f]) => f.requiresConfirmation || f.confidence < 0.5)
    .map(([k]) => k);

  return { issue, fields, unresolved };
}

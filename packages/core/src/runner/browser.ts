import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
} from "playwright";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueAction, IssueSpec } from "../scenario/issue.js";
import type {
  ConsoleEntry,
  EnvironmentInfo,
  FailedRequest,
} from "../evidence/types.js";
import { redactSecrets } from "../security/redact.js";
import { assertSafeSelector } from "../security/paths.js";
import os from "node:os";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleEntries: ConsoleEntry[];
  failedRequests: FailedRequest[];
  close: () => Promise<void>;
};

export async function launchSession(opts: {
  config: ReproSightConfig;
  issue: IssueSpec;
  headless?: boolean;
  recordTraceDir?: string;
}): Promise<BrowserSession> {
  const headless = opts.headless ?? opts.config.browser.headless;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: {
      width: opts.issue.state.viewport.width,
      height: opts.issue.state.viewport.height,
    },
    deviceScaleFactor: opts.config.browser.deviceScaleFactor,
    colorScheme: opts.issue.state.theme === "light" ? "light" : "dark",
    locale: opts.issue.state.locale,
  });

  if (opts.recordTraceDir) {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
  }

  const page = await context.newPage();
  const consoleEntries: ConsoleEntry[] = [];
  const failedRequests: FailedRequest[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleEntries.push({
        type: msg.type(),
        text: redactSecrets(msg.text()),
        location: msg.location().url,
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on("pageerror", (err) => {
    consoleEntries.push({
      type: "pageerror",
      text: redactSecrets(err.message),
      timestamp: new Date().toISOString(),
    });
  });

  page.on("requestfailed", (req: Request) => {
    failedRequests.push({
      url: redactSecrets(req.url()),
      method: req.method(),
      failureText: req.failure()?.errorText,
      timestamp: new Date().toISOString(),
    });
  });

  const close = async () => {
    if (opts.recordTraceDir) {
      try {
        await context.tracing.stop({
          path: `${opts.recordTraceDir}/trace-temp.zip`,
        });
      } catch {
        // ignore
      }
    }
    await context.close();
    await browser.close();
  };

  return { browser, context, page, consoleEntries, failedRequests, close };
}

export async function applyLocaleAndTheme(
  page: Page,
  config: ReproSightConfig,
  issue: IssueSpec,
): Promise<void> {
  if (
    config.setup.locale.strategy === "selector" &&
    config.setup.locale.selector
  ) {
    assertSafeSelector(config.setup.locale.selector);
    const loc = page.locator(config.setup.locale.selector);
    if (await loc.count()) {
      // Toggle until data-locale or text matches when possible
      const current = await page.locator("html").getAttribute("lang");
      if (current !== issue.state.locale) {
        await loc.first().click({ timeout: 5000 }).catch(() => undefined);
        // second click if multi-state toggle and still mismatched
        const after = await page.locator("html").getAttribute("lang");
        if (after !== issue.state.locale) {
          await loc.first().click({ timeout: 2000 }).catch(() => undefined);
        }
      }
    }
  }

  if (
    config.setup.theme.strategy === "selector" &&
    config.setup.theme.selector
  ) {
    assertSafeSelector(config.setup.theme.selector);
    const themeToggle = page.locator(config.setup.theme.selector);
    if (await themeToggle.count()) {
      const dataTheme = await page.locator("html").getAttribute("data-theme");
      if (dataTheme !== issue.state.theme) {
        await themeToggle.first().click({ timeout: 5000 }).catch(() => undefined);
        const after = await page.locator("html").getAttribute("data-theme");
        if (after !== issue.state.theme) {
          await themeToggle
            .first()
            .click({ timeout: 2000 })
            .catch(() => undefined);
        }
      }
    }
  }
}

export async function replayActions(
  page: Page,
  actions: IssueAction[],
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "goto":
        await page.goto(action.url, { waitUntil: "domcontentloaded" });
        break;
      case "click":
        assertSafeSelector(action.selector);
        await page.click(action.selector, { timeout: 10_000 });
        break;
      case "fill":
        assertSafeSelector(action.selector);
        await page.fill(action.selector, action.value, { timeout: 10_000 });
        break;
      case "press":
        await page.keyboard.press(action.key);
        break;
      case "hover":
        assertSafeSelector(action.selector);
        await page.hover(action.selector, { timeout: 10_000 });
        break;
      case "scrollIntoView":
        assertSafeSelector(action.selector);
        await page.locator(action.selector).first().scrollIntoViewIfNeeded();
        break;
      case "waitForSelector":
        assertSafeSelector(action.selector);
        await page.waitForSelector(action.selector, {
          state: action.state ?? "visible",
          timeout: 10_000,
        });
        break;
      default:
        throw new Error(`Unsupported action`);
    }
  }
}

export async function stabilizePage(
  page: Page,
  config: ReproSightConfig,
): Promise<void> {
  const timeout = config.stabilization.timeoutMs;

  if (config.stabilization.waitForFonts) {
    await page
      .evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      })
      .catch(() => undefined);
  }

  if (config.stabilization.waitForImages) {
    await page
      .evaluate(async () => {
        const imgs = Array.from(document.images);
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.addEventListener("load", () => resolve(), { once: true });
                  img.addEventListener("error", () => resolve(), { once: true });
                }),
          ),
        );
      })
      .catch(() => undefined);
  }

  if (config.stabilization.disableAnimations) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `,
    });
  }

  // Hide configured volatile selectors temporarily via CSS only
  if (config.ignores.selectors.length) {
    const rules = config.ignores.selectors
      .map((s) => `${s}{visibility:hidden !important;}`)
      .join("\n");
    await page.addStyleTag({ content: rules });
  }

  const frames = config.stabilization.settleFrames;
  await page
    .evaluate(async ({ frames, timeout }) => {
      const sleepFrame = () =>
        new Promise<void>((r) => requestAnimationFrame(() => r()));
      const start = performance.now();
      let last = "";
      let stable = 0;
      while (performance.now() - start < timeout) {
        const sig = [
          document.documentElement.scrollWidth,
          document.documentElement.scrollHeight,
          document.documentElement.clientWidth,
          document.body?.scrollWidth ?? 0,
        ].join("|");
        if (sig === last) stable += 1;
        else {
          stable = 0;
          last = sig;
        }
        if (stable >= frames) return;
        await sleepFrame();
      }
    }, { frames, timeout })
    .catch(() => undefined);
}

export async function navigateAndPrepare(opts: {
  page: Page;
  config: ReproSightConfig;
  issue: IssueSpec;
}): Promise<void> {
  const base = opts.config.server.readyUrl.replace(/\/$/, "");
  const route = opts.issue.route.startsWith("http")
    ? opts.issue.route
    : `${base}${opts.issue.route.startsWith("/") ? "" : "/"}${opts.issue.route}`;
  await opts.page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await applyLocaleAndTheme(opts.page, opts.config, opts.issue);
  await replayActions(opts.page, opts.issue.actions);
  await stabilizePage(opts.page, opts.config);
}

export async function captureEnvironment(
  page: Page,
  config: ReproSightConfig,
  issue: IssueSpec,
): Promise<EnvironmentInfo> {
  const browserVersion = await page.context().browser()?.version() ?? "unknown";
  const userAgent = await page.evaluate(() => navigator.userAgent);
  return {
    browserName: config.browser.name,
    browserVersion,
    userAgent,
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    viewport: {
      width: issue.state.viewport.width,
      height: issue.state.viewport.height,
    },
    deviceScaleFactor: config.browser.deviceScaleFactor,
    locale: issue.state.locale,
    theme: issue.state.theme,
    colorScheme: issue.state.theme,
    readyUrl: config.server.readyUrl,
    capturedAt: new Date().toISOString(),
  };
}

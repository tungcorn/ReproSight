import { describe, expect, it } from "vitest";
import { validateUnifiedDiff } from "./policy.js";

const policy = {
  allowedGlobs: ["**/*.{css,html,js,ts,tsx}"],
  deniedGlobs: [".env*", "**/node_modules/**", "**/.git/**"],
  maxFiles: 3,
  maxAddedLines: 120,
  maxDeletedLines: 120,
};

describe("patch policy", () => {
  it("accepts a minimal css fix", () => {
    const diff = `--- a/styles.css
+++ b/styles.css
@@ -1,3 +1,2 @@
 .hero {
-  max-width: 100%;
 }
`;
    const r = validateUnifiedDiff(diff, policy);
    expect(r.accepted).toBe(true);
    expect(r.files).toContain("styles.css");
  });

  it("rejects path traversal", () => {
    const diff = `--- a/../../.env
+++ b/../../.env
@@ -1 +1 @@
-a
+b
`;
    const r = validateUnifiedDiff(diff, policy);
    expect(r.accepted).toBe(false);
  });

  it("rejects global overflow hiding", () => {
    const diff = `--- a/styles.css
+++ b/styles.css
@@ -1,1 +1,4 @@
 body{}
+html, body {
+  overflow-x: hidden;
+}
`;
    const r = validateUnifiedDiff(diff, policy);
    expect(r.accepted).toBe(false);
    expect(r.forbiddenPatterns).toContain("global-overflow-hidden");
  });
});

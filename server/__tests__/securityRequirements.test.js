import { test } from "node:test";
import assert from "node:assert/strict";

// Deliberately failing release gates, NOT behavior coverage. The production
// retention/quota mechanisms and their policy are not implemented yet.
// Replace each blocker with executable HTTP/filesystem tests when they land;
// do not turn these back into skip/todo or remove them to make QA green.
// This is the review's alternative to implementing those later work packages
// inside a QA-only PR. See docs/QA_SECURITY_SUITE.md.

test("release gate: expired custom-order files are denied and cleaned", () => {
  assert.fail("Upload retention is unimplemented. Define the policy, implement expiry/cleanup, and replace this blocker with HTTP download-denial and filesystem-cleanup assertions.");
});

test("release gate: concurrent custom-order uploads cannot overbook storage quota", () => {
  assert.fail("Atomic upload quota reservation is unimplemented. Replace this blocker with concurrent HTTP uploads proving the shared quota cannot be exceeded.");
});

test("release gate: aborted multipart uploads release quota and remove partial files", () => {
  assert.fail("Upload quota release on abort is unimplemented. Replace this blocker with an interrupted multipart request, filesystem cleanup, and a subsequent upload proving quota recovery.");
});

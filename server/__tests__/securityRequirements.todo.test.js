import { test } from "node:test";

// These are explicit security release-gates for requirements that do not yet
// have a production mechanism to exercise. Keeping them in the test runner
// prevents the gaps from disappearing from QA output while avoiding fake
// green tests that only test mocks.

test.todo("expired custom-order files should be denied and cleaned according to the retention policy");

test.todo("concurrent custom-order uploads should reserve storage quota atomically and prevent overbooking");

test.todo("aborted multipart uploads should release quota reservations and remove partial files");

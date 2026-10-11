import { afterEach } from "vitest";
import { yieldToEventLoop } from "./eventLoop";

// Every test file (TEST-STABILITY1): one event-loop turn after each test, so the
// longest stretch without one is a single test, not a file of synchronous tests.
afterEach(yieldToEventLoop);

/**
 * Inngest client singleton (JOBS-01)
 *
 * A single module-level export consumed by:
 *   - app/api/inngest/route.ts  (the Inngest serve handler)
 *   - app/api/inngest/trigger/route.ts  (the event trigger route — plan 05-04)
 *
 * The id "quickbrain" identifies this application in the Inngest dashboard.
 * INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are read automatically by the
 * Inngest SDK from process.env when the client is used in production.
 * For local dev, INNGEST_DEV=1 must be set (see .env.example).
 */
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "quickbrain" });

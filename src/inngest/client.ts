import { Inngest } from "inngest";

export const INNGEST_DEFAULT_APP_ID = "manuscript-intelligence-app";

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID || INNGEST_DEFAULT_APP_ID,
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY
});

const endpoint = process.argv[2] ?? "run-next";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const manuscriptId = process.env.MANUSCRIPT_ID;
const payload = {
  manuscriptId,
  corpusBookId: process.env.CORPUS_BOOK_ID,
  maxJobs: process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : undefined,
  maxSeconds: process.env.MAX_SECONDS ? Number(process.env.MAX_SECONDS) : undefined,
  maxItemsPerStep: process.env.MAX_ITEMS_PER_STEP
    ? Number(process.env.MAX_ITEMS_PER_STEP)
    : undefined
};
const headers = { "Content-Type": "application/json" };

if (process.env.ADMIN_JOB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.ADMIN_JOB_TOKEN}`;
}

if (endpoint === "diagnose-manuscript" && !manuscriptId) {
  console.error("MANUSCRIPT_ID is required for diagnose-manuscript.");
  process.exit(1);
}

const url =
  endpoint === "diagnose-manuscript"
    ? `${appUrl}/api/admin/manuscripts/${manuscriptId}/diagnostics`
    : `${appUrl}/api/jobs/${endpoint}`;
const response = await fetch(url, {
  method: endpoint === "diagnose-manuscript" ? "GET" : "POST",
  headers,
  body: endpoint === "diagnose-manuscript" ? undefined : JSON.stringify(payload)
});
const text = await response.text();

console.log(text);

if (!response.ok) {
  process.exitCode = 1;
}

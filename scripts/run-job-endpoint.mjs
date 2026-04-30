const endpoint = process.argv[2] ?? "run-next";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const payload = {
  manuscriptId: process.env.MANUSCRIPT_ID,
  corpusBookId: process.env.CORPUS_BOOK_ID,
  maxJobs: process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : undefined,
  maxSeconds: process.env.MAX_SECONDS ? Number(process.env.MAX_SECONDS) : undefined
};
const headers = { "Content-Type": "application/json" };

if (process.env.ADMIN_JOB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.ADMIN_JOB_TOKEN}`;
}

const response = await fetch(`${appUrl}/api/jobs/${endpoint}`, {
  method: "POST",
  headers,
  body: JSON.stringify(payload)
});
const text = await response.text();

console.log(text);

if (!response.ok) {
  process.exitCode = 1;
}

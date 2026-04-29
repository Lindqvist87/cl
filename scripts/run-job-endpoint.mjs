const endpoint = process.argv[2] ?? "run-next";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const payload = {
  manuscriptId: process.env.MANUSCRIPT_ID,
  maxJobs: process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : undefined,
  maxSeconds: process.env.MAX_SECONDS ? Number(process.env.MAX_SECONDS) : undefined
};

const response = await fetch(`${appUrl}/api/jobs/${endpoint}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
const text = await response.text();

console.log(text);

if (!response.ok) {
  process.exitCode = 1;
}

// A test reporter for GitHub Actions. Each failing test becomes an error note on the run's page, with the test's name
// and the first lines of the reason, so a failure can be read without opening the full log. Outside GitHub Actions it
// prints nothing. Used alongside the usual reporter: see .github/workflows/labeling-site-checks.yml.
const clean = s => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const cleanTitle = s => clean(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== "test:fail" || !process.env.GITHUB_ACTIONS) continue;
    const { name, details } = event.data;
    if (details && details.type === "suite") continue;
    const error = details && details.error;
    const cause = (error && error.cause) || error;
    const reason = (cause && cause.message ? cause.message : "failed") + (cause && cause.cause && cause.cause.message ? ` (${cause.cause.message})` : "");
    const where = event.data.file ? event.data.file.split("/labeling-site/").pop() : "";
    yield `::error title=${cleanTitle(name)}::${clean((where ? where + ": " : "") + String(reason).split("\n").slice(0, 8).join("\n"))}\n`;
  }
}

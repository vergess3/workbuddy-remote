const port = process.argv[2] || "9222";
const host = process.argv[3] || "127.0.0.1";
const url = `http://${host}:${port}/json/list`;

async function main() {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }

  const targets = await res.json();
  const interesting = targets.filter((target) => {
    const haystack = `${target.title || ""} ${target.url || ""}`.toLowerCase();
    return (
      haystack.includes("workbuddy") ||
      haystack.includes("codebuddy") ||
      haystack.includes("agent") ||
      haystack.includes("claw") ||
      haystack.includes("vscode-webview")
    );
  });

  const output = interesting.length > 0 ? interesting : targets;

  for (const target of output) {
    console.log("-----");
    console.log(`id: ${target.id}`);
    console.log(`type: ${target.type}`);
    console.log(`title: ${target.title || ""}`);
    console.log(`url: ${target.url || ""}`);
    console.log(`ws: ${target.webSocketDebuggerUrl || ""}`);
  }

  if (output.length === 0) {
    console.log("No targets returned.");
  }
}

main().catch((error) => {
  console.error(`Failed to list CDP targets: ${error.message}`);
  process.exitCode = 1;
});

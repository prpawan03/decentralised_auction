// Health probe for the development chain.
//
// The node:alpine image does not contain curl. This script replaces curl. It
// sends one JSON-RPC request and it checks the answer.
//
// Exit code 0: the node answered with a block number. The node is healthy.
// Exit code 1: any other result. The node is not healthy.

const port = Number(process.env.CHAIN_PORT ?? 8545);
const body = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "eth_blockNumber",
  params: [],
});

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);

try {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  });

  if (!response.ok) {
    console.error(`chain: HTTP ${response.status}`);
    process.exit(1);
  }

  const payload = await response.json();
  if (typeof payload.result !== "string" || !payload.result.startsWith("0x")) {
    console.error(`chain: bad result ${JSON.stringify(payload)}`);
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  console.error(`chain: ${error.message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

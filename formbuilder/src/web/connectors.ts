/* Connectors: the Claude connector and API tokens. */
import { $, api, copy, el, iconButton, initShell, toast, when } from "./lib/ui.ts";

interface TokenItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Connection {
  id: string;
  name: string;
  connectedAt: string;
  lastUsedAt: string | null;
}

const mcpUrl = location.origin + "/mcp";
$("mcp-url").textContent = mcpUrl;
$("mcp-copy").replaceWith(iconButton("copy", "Copy URL", () => copy(mcpUrl, "URL copied")));

/** A row with a name, quiet meta and one action. Confirms inline: the first click arms, the second acts. */
function row(name: string, meta: string, action: string, run: () => Promise<void>, prefix?: string): HTMLElement {
  const r = el("div", "item-row");
  if (prefix) r.append(el("code", "mono", prefix));
  r.append(el("span", "grow", name), el("span", "muted num", meta));
  const b = el("button", "text-btn danger", action);
  b.type = "button";
  let armed = false;
  b.onclick = async () => {
    if (!armed) {
      armed = true;
      b.textContent = "Confirm";
      setTimeout(() => {
        armed = false;
        b.textContent = action;
      }, 3000);
      return;
    }
    b.disabled = true;
    try {
      await run();
    } catch (e) {
      toast((e as Error).message);
      b.disabled = false;
    }
  };
  r.append(b);
  return r;
}

async function loadConnections() {
  const r = await api<{ connections: Connection[] }>("GET", "/api/connections");
  const box = $("connections");
  box.textContent = "";
  for (const c of r.connections)
    box.append(
      row(c.name, c.lastUsedAt ? "Used " + when(c.lastUsedAt) : "Connected " + when(c.connectedAt), "Disconnect", async () => {
        await api("DELETE", "/api/connections/" + c.id);
        toast(c.name + " disconnected");
        loadConnections();
      }),
    );
  if (!r.connections.length) box.append(el("div", "muted", "Not connected yet"));
}

async function loadTokens() {
  const r = await api<{ tokens: TokenItem[] }>("GET", "/api/tokens");
  const box = $("tokens");
  box.textContent = "";
  for (const t of r.tokens)
    box.append(
      row(
        t.name,
        t.lastUsedAt ? "Used " + when(t.lastUsedAt) : "Never used",
        "Revoke",
        async () => {
          await api("DELETE", "/api/tokens/" + t.id);
          toast("Token revoked");
          loadTokens();
        },
        t.prefix + "…",
      ),
    );
}

function renderCurl(token?: string) {
  const body = {
    payload: {
      title: "Std 6 Tense Quiz",
      points: 1,
      items: [{ q: "Which sentence is in the simple present tense?", options: ["A) She is playing", "B) They walk to school"], answer: 1 }],
    },
  };
  $("curl").textContent = [
    `curl -X POST ${location.origin}/api/forms \\`,
    `  -H "Authorization: Bearer ${token || "fbk_your_token"}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");
}

$("token-create").onclick = async () => {
  const input = $<HTMLInputElement>("token-name");
  try {
    const r = await api<{ token: string }>("POST", "/api/tokens", { name: input.value.trim() || "API token" });
    $("secret-value").textContent = r.token;
    $("secret-copy").replaceChildren(iconButton("copy", "Copy token", () => copy(r.token, "Token copied")));
    $("secret").hidden = false;
    input.value = "";
    renderCurl(r.token);
    loadTokens();
  } catch (e) {
    toast((e as Error).message);
  }
};

renderCurl();
initShell()
  .then(() => Promise.all([loadConnections(), loadTokens()]))
  .catch((e) => toast((e as Error).message));

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// Load config from env
const { GITHUB_TOKEN, GITHUB_USER, GITHUB_REPO } = process.env;

if (!GITHUB_TOKEN || !GITHUB_USER || !GITHUB_REPO) {
  console.error("❌ Missing environment variables in .env");
  process.exit(1);
}

// Push file to GitHub
async function pushToGitHub(filePath, content, message) {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filePath}`;

  // Check if file already exists → need SHA for updates
  let sha;
  const existing = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });
  if (existing.ok) {
    const json = await existing.json();
    sha = json.sha;
  }

  // Create or update
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      branch: "main",
      sha,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub push failed: ${response.statusText}\n${errText}`);
  }

  return response.json();
}

// API: approve item
app.post("/approve", async (req, res) => {
  try {
    const { id, name, data } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: "Missing id or name" });
    }

    const filePath = `approved/${id}.json`;
    const content = JSON.stringify({ id, name, ...data }, null, 2);

    const result = await pushToGitHub(filePath, content, `Approve ${name}`);
    res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Error approving:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: reject item (no GitHub, just log)
app.post("/reject", (req, res) => {
  const { id, name } = req.body;
  console.log(`❌ Rejected item: ${id} (${name})`);
  res.json({ success: true });
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ Review system is running!");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Review server running on port ${PORT}`);
});

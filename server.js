
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || "";
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "";
const TIKTOK_REDIRECT_URI =
  process.env.TIKTOK_REDIRECT_URI || `http://localhost:${PORT}/auth/tiktok/callback`;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-local-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { sameSite: "lax" }
}));

app.use(express.static(path.join(__dirname, "public")));

app.get("/control", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "control.html"))
);
app.get("/overlay", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "overlay.html"))
);

/* Local TEST MODE: deliberately simulated, not a TikTok transaction. */
io.on("connection", socket => {
  socket.on("gift", data => {
    const safe = {
      username: String(data.username || "Guest").slice(0, 60),
      gift: String(data.gift || "Gift").slice(0, 60),
      count: Math.max(1, Math.min(999, Number(data.count) || 1)),
      avatar: String(data.avatar || "").slice(0, 500),
      duration: Math.max(0, Math.min(3600, Number(data.duration) || 0)),
      source: "local-test"
    };
    io.emit("gift", safe);
  });
});

/* TikTok Login Kit scaffold.
   This only authenticates a TikTok account with permissions TikTok approves.
   It does NOT claim to provide LIVE gift events. */
app.get("/auth/tiktok", (req, res) => {
  if (!TIKTOK_CLIENT_KEY) {
    return res.status(400).send(`
      <h2>TikTok Login chưa được cấu hình</h2>
      <p>Hãy đặt TIKTOK_CLIENT_KEY và TIKTOK_CLIENT_SECRET trước.</p>
      <p>Redirect URI: ${TIKTOK_REDIRECT_URI}</p>
    `);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  req.session.tiktokState = state;
  req.session.tiktokVerifier = verifier;

  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    response_type: "code",
    scope: "user.info.basic",
    redirect_uri: TIKTOK_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
});

app.get("/auth/tiktok/callback", async (req, res) => {
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    return res.status(400).send("TikTok Login chưa được cấu hình.");
  }
  if (!req.query.code || req.query.state !== req.session.tiktokState) {
    return res.status(400).send("OAuth state/code không hợp lệ.");
  }

  try {
    const body = new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code: req.query.code,
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_REDIRECT_URI,
      code_verifier: req.session.tiktokVerifier
    });

    const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await r.json();

    if (!r.ok || data.error) {
      return res.status(400).send(`<pre>${JSON.stringify(data, null, 2)}</pre>`);
    }

    req.session.tiktokAccessToken = data.access_token;
    res.redirect("/control?tiktok=connected");
  } catch (e) {
    res.status(500).send("TikTok OAuth error: " + e.message);
  }
});

app.get("/api/tiktok/status", (req, res) => {
  res.json({
    connected: Boolean(req.session.tiktokAccessToken),
    live: null,
    liveSupportedByThisLocalBuild: false,
    message: req.session.tiktokAccessToken
      ? "TikTok account connected. LIVE/gift events are not claimed by this build."
      : "TikTok account chưa kết nối."
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("================================");
  console.log(" CUSTOM GIFT OVERLAY V2");
  console.log("================================");
  console.log(`Control: http://localhost:${PORT}/control`);
  console.log(`Overlay: http://localhost:${PORT}/overlay`);
  console.log(`TikTok OAuth callback: ${TIKTOK_REDIRECT_URI}`);
  console.log("Server dang chay...");
});

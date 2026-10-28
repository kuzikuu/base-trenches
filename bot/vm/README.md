# Run the bot on an Oracle Cloud VM (optional)

The live bot runs on Cloudflare (`base-trenches-bot` Worker, webhook). This folder is a
fallback that runs the **same logic** (`../src/core.js`) on any Linux VM with long polling.

**Only one can run at a time.** Telegram sends each update to either the webhook or
`getUpdates`, never both. `poll.mjs` refuses to start while a webhook is set.

## Setup (Oracle Linux / Ubuntu, Always Free shape is plenty)

```bash
# Node 22+ (has built-in node:sqlite); on Node 20 run `npm install` in bot/ for better-sqlite3
sudo mkdir -p /opt/base-trenches && sudo chown $USER /opt/base-trenches
git clone https://github.com/kuzikuu/base-trenches /opt/base-trenches
cd /opt/base-trenches/bot && npm install --omit=dev || true

sudo tee /etc/base-trenches-bot.env >/dev/null <<'ENV'
TELEGRAM_BOT_TOKEN=paste-from-BotFather
ADMIN_KEY=long-random-string
DB_PATH=/opt/base-trenches/bot/vm/bot.sqlite
PORT=8080
ENV
sudo chmod 600 /etc/base-trenches-bot.env
```

## Switch from Cloudflare to the VM

```bash
# 1. stop the webhook (the Cloudflare bot stops getting updates)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
# 2. start the poller
sudo cp vm/base-trenches-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now base-trenches-bot
journalctl -u base-trenches-bot -f
```

The VM starts with its own empty database (Cloudflare's data stays in the Durable Object).
If `PORT` is set it serves the same `/api/*` and `/admin/engagement` endpoints; open the
port in the OCI security list and point `BT_BOT_URL` in `js/config.js` at it (HTTPS needed
for the site, e.g. behind Caddy).

## Switch back to Cloudflare

```bash
sudo systemctl disable --now base-trenches-bot
# then set the webhook again (path + secret are in the box secrets file, see bot/README.md)
```

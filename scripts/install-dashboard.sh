#!/bin/zsh
set -euo pipefail
ROOT="/Users/test/Documents/work/temporal-harness-mvp"
LABEL="org.drunkod.temporal-harness-mvp-dashboard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.state"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/dist/dashboard-server.js</string></array>
<key>WorkingDirectory</key><string>$ROOT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$ROOT/.state/dashboard.log</string>
<key>StandardErrorPath</key><string>$ROOT/.state/dashboard.error.log</string>
</dict></plist>
EOF
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
for i in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then break; fi
  if [[ "$i" == "5" ]]; then echo "Dashboard bootstrap failed" >&2; exit 1; fi
  sleep 2
done
for i in {1..20}; do
  if /usr/bin/curl -fsS --connect-timeout 1 http://127.0.0.1:4319/api/health; then echo; exit 0; fi
  sleep 1
done
echo "Dashboard failed health check; see $ROOT/.state/dashboard.error.log" >&2
exit 1

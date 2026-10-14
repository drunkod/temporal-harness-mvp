#!/bin/zsh
# Demo-only LaunchAgent. Run from the MVP repo to survive closing the ChatGPT tab.
set -euo pipefail
ROOT="/Users/test/Documents/work/temporal-harness-mvp"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/org.drunkod.temporal-harness-mvp-worker.plist"
UID_NUM="$(id -u)"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.state"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.drunkod.temporal-harness-mvp-worker</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$ROOT/dist/worker.js</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>/Users/test</string>
    <key>PATH</key><string>/etc/profiles/per-user/test/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT/.state/worker.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.state/worker.error.log</string>
</dict></plist>
EOF
plutil -lint "$PLIST"
launchctl bootout "gui/$UID_NUM/org.drunkod.temporal-harness-mvp-worker" 2>/dev/null || true
# launchd may still be draining the old worker after bootout.
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then break; fi
  if [ "$attempt" -eq 5 ]; then echo 'Unable to bootstrap Temporal worker' >&2; exit 1; fi
  sleep 2
done
launchctl print "gui/$UID_NUM/org.drunkod.temporal-harness-mvp-worker" | grep -E 'state =|pid =|program ='
echo "MVP_WORKER_LAUNCHAGENT=$PLIST"

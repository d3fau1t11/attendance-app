# Running the Android app

Everything below assumes Windows, PowerShell or Git Bash, and a phone on the
same Wi-Fi as this PC.

---

## 1. Environment

Create or update `.env` in the repo root:

```ini
PORT=5000
DATABASE_URL=postgresql://...        # your Supabase connection string
JWT_SECRET=<at least 32 random characters>
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> Without `JWT_SECRET` the server generates an ephemeral one in development and
> warns — sessions then stop working across restarts.

## 2. Install and push the schema

```bash
pnpm install
pnpm --filter @workspace/db run push
```

## 3. Seed test data at YOUR location

This is the step people skip and then wonder why check-in refuses. The geofence
must be somewhere you can physically stand.

Get your coordinates from Google Maps (right-click → the numbers at the top),
then:

```bash
pnpm --filter @workspace/scripts run seed -- --lat 9.0192 --lng 38.7468 --radius 150
```

It prints the login credentials and the kiosk URL. Re-running is safe and moves
the geofence to whatever coordinates you pass.

## 4. Find your LAN IP

```bash
ipconfig | findstr /i "IPv4"
```

Use the `192.168.x.x` address. Then create
`artifacts/attendance-mobile/.env`:

```ini
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000
```

Substitute your own address. This is only the default — the app lets you change
it at runtime under **Profile → Server address**, which is what to use when your
IP changes.

## 5. Start the API

```bash
pnpm --filter @workspace/api-server run dev
```

It binds to `0.0.0.0:5000` so the phone can reach it. Confirm from the phone's
browser: `http://192.168.1.20:5000/api/healthz` should return JSON.

If it does not, it is almost always Windows Firewall — allow Node.js on private
networks.

## 6. Build the development APK

Background geofencing does **not** work in Expo Go. You need a real build.

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile development
```

Takes about 10 minutes. Install the resulting APK on your phone.

## 7. Run the dev server

```bash
pnpm --filter @workspace/attendance-mobile run start:lan
```

Open the installed app; it connects to the Metro bundler over Wi-Fi. JS changes
hot-reload from here — you only rebuild the APK when native dependencies change.

---

## Test walkthrough

1. **Log in** as `abebe@demo.co`.
2. **Grant permissions.** Allow location, then choose **"Allow all the time"**
   when prompted for background access. Also tap *Battery optimisation* in
   Profile and allow unrestricted activity — Android will otherwise freeze the
   app and silently stop exit detection.
3. **Open the kiosk** on this PC: the URL the seed script printed. Scan it.
   → You should be checked in, and a persistent notification appears.
4. **Screenshot the QR, wait 60 seconds, scan the screenshot.**
   → Rejected as expired. This is the rotating-code protection working.
5. **Walk out** past the radius (150m by default — walk 250m to be certain).
   → Status turns amber, showing a grace-period countdown.
6. **Walk back within 5 minutes.**
   → Session continues; no check-out is recorded.
7. **Walk out and stay out past the grace period.**
   → Automatically checked out. The recorded time is when you *left*, not when
   the server noticed.
8. **Turn off Wi-Fi and mobile data, then scan.**
   → "Saved on this device", pending badge appears. Reconnect → syncs once, with
   no duplicate row.
9. **Force-stop the app while checked in, then leave.**
   → The OS geofence still fires; the exit is recorded.
10. **Revoke location permission and try to check in.**
    → Blocked with an explicit message, and no attendance record is created.

---

## Troubleshooting

**"Cannot reach the server"** — phone and PC on different networks, wrong IP, or
Windows Firewall. Test the health URL in the phone's browser first.

**Check-in says you are outside the workplace** — the seeded coordinates are not
where you are. Re-run the seed with your actual location.

**"GPS signal too weak"** — accuracy is worse than 100m. This is deliberate: a
±300m fix cannot prove presence. Go outdoors and retry.

**Exit is never detected** — almost always battery optimisation. Check
**Profile → Tracking health**; if "Background location" is not green, exits will
be missed. Android geofence callbacks can also lag several minutes by design.

**Cleartext HTTP** — enabled via `expo-build-properties` for LAN testing. This
is a development affordance and must be removed before shipping; production
must be HTTPS.

---

## Useful commands

```bash
pnpm run typecheck                              # whole workspace
pnpm test                                       # engine + auth + QR unit tests
pnpm --filter @workspace/db run push            # apply schema changes
pnpm --filter @workspace/api-server run dev     # API on :5000
```

# Dhaka Tesla Pool — mobile app (Android + iOS)

One React Native codebase (Expo SDK 57, `expo-router`) for passengers and drivers. It talks to the same
`/api/v1` backend as the web app; the app holds no business rules, it renders what the server says.

## Run it

```bash
cd mobile
cp .env.example .env          # set EXPO_PUBLIC_API_URL (and EXPO_PUBLIC_WEB_URL)
npm ci                        # .npmrc sets legacy-peer-deps, which Expo projects need
npx expo start                # scan the QR code with the free Expo Go app
```

| Where it runs | `EXPO_PUBLIC_API_URL` |
|---|---|
| Deployed backend | `https://dhaka-tesla-pool-vkao.onrender.com` |
| iOS simulator | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000` |
| A real phone on your Wi-Fi | `http://<your computer's LAN IP>:4000` |

Demo accounts (only on a demo database): `nusrat@dhakateslapool.test` (passenger), `jashim@dhakateslapool.test`
(driver, verified), all with password `password123`.

## What is in it

- **Passenger:** request a ride with Cash/TeslaPay, scheduling, "how long I can wait", pre-approved sharing,
  women-only rides, meeting points; the driver, vehicle, position and ETA once matched; sharing questions with a
  countdown; receipts; ratings; a "follow my trip" link; repeating commutes.
- **Driver:** verification, earnings, the open board ranked by "fits your pool", no-show handling, cancel pool,
  live location sharing while a pool is running.
- **Everyone:** an Activity inbox plus push notifications, English and Bangla, phone verification, password
  reset by SMS, silent session refresh.

## Checks

```bash
npm test                        # string tables (EN/BN complete + placeholders match) and formatting
npm run test:api                # drives the real API client through the whole flow against a LIVE backend
npx expo export --platform android --platform ios   # proves both bundles compile
```

## Not verified in this repository

The app is bundled and its API client is exercised end to end, but it has not been **run on an emulator or a
phone** here, so the first launch on a device is the first real UI test. Push notifications need a physical
device and an EAS project id; location sharing needs a device with GPS.

## Building store binaries

Development needs only Expo Go (free). Store builds use EAS: `npm i -g eas-cli`, `eas build:configure`, then
`eas build --platform android` (an `.aab`/`.apk`) or `--platform ios` (needs an Apple developer account, $99/yr; a
Google Play developer account is a one-off $25). Change `ios.bundleIdentifier` / `android.package` in `app.json`
(`com.dhakateslapool.app` is a placeholder) before the first build, because it cannot be changed afterwards.

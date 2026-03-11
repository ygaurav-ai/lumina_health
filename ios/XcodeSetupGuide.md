# Lumina Health iOS — Xcode Setup Guide

Follow these steps exactly to get the app running on your iPhone.

---

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Xcode | 15.0+ |
| iPhone | iOS 17.0+ |
| Apple Developer account | Free or paid (free works for personal use) |
| macOS | Sonoma 14.0+ |

---

## Step 1 — Create the Xcode project

1. Open Xcode → **File → New → Project…**
2. Choose **iOS → App** and click **Next**
3. Fill in:
   - **Product Name:** `LuminaHealth`
   - **Team:** select your Apple ID (add one via Xcode → Settings → Accounts if needed)
   - **Organization Identifier:** anything reverse-DNS, e.g. `com.yourname.lumina`
   - **Bundle Identifier:** will auto-fill, e.g. `com.yourname.lumina.LuminaHealth`
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None (uncheck Core Data and CloudKit)
4. Click **Next**, choose a save location (e.g. your Desktop), click **Create**

---

## Step 2 — Copy in the Swift source files

The project root you created contains a folder called **LuminaHealth/** (same name as the project).
Copy all six `.swift` files from `ios/LuminaHealth/` in the backend repo into that folder:

```
LuminaHealth/
  ├── LuminaHealthApp.swift   ← replace the generated one
  ├── ContentView.swift       ← replace the generated one
  ├── Models.swift            ← new
  ├── HealthKitManager.swift  ← new
  ├── APIClient.swift         ← new
  └── DashboardViewModel.swift← new
```

**In Xcode's file navigator (left panel):**

1. Right-click the yellow **LuminaHealth** group (not the blue project root) → **Add Files to "LuminaHealth"…**
2. Select the four new files (`Models.swift`, `HealthKitManager.swift`, `APIClient.swift`, `DashboardViewModel.swift`)
3. Make sure **"Copy items if needed"** is checked and **"Add to target: LuminaHealth"** is ticked
4. Click **Add**
5. For `LuminaHealthApp.swift` and `ContentView.swift`: select all the generated code and paste in the new code (or delete the existing files and re-add the new ones the same way)

---

## Step 3 — Add the HealthKit capability

1. Click the **blue project icon** at the very top of the navigator
2. Select the **LuminaHealth** target (under TARGETS)
3. Go to the **Signing & Capabilities** tab
4. Click **+ Capability** (top-left of the pane)
5. Type `HealthKit` in the search box and double-click it
6. HealthKit now appears as a capability — no extra settings needed for read-only access

---

## Step 4 — Add the Info.plist usage description

Xcode 13+ manages Info.plist entries through the target settings:

1. Still on the **LuminaHealth** target, go to the **Info** tab
2. Hover over any existing row and click the **+** button that appears
3. Type `NSHealthShareUsageDescription` (it will autocomplete to "Privacy - Health Share Usage Description")
4. Set the value to:
   ```
   Lumina Health reads your Apple Health data to compute your daily Recovery Score.
   ```

If your project has a physical `Info.plist` file visible in the navigator, you can add it there directly:
```xml
<key>NSHealthShareUsageDescription</key>
<string>Lumina Health reads your Apple Health data to compute your daily Recovery Score.</string>
```

---

## Step 5 — Verify the bundle identifier & signing

1. **Signing & Capabilities** tab → make sure **Automatically manage signing** is checked
2. Your **Team** should be selected
3. The **Bundle Identifier** must be unique — if you see a signing error, append something random (e.g. `com.yourname.lumina.LuminaHealth.dev123`)

---

## Step 6 — Connect your iPhone

1. Plug your iPhone into your Mac via USB
2. Unlock the iPhone
3. If prompted on the iPhone: tap **Trust This Computer** and enter your passcode
4. In Xcode's toolbar (top centre), click the device picker and select your iPhone

---

## Step 7 — Run the app

1. Press **⌘R** (or the ▶ button in the toolbar)
2. Xcode will build, install, and launch the app on your iPhone
3. On first run you will see the HealthKit permission sheet — tap **Allow All** or select specific types

> **Build error?** The most common cause is a signing issue. Go to Signing & Capabilities, make sure your Apple ID is selected, and resolve any "No account for team" warnings.

---

## Step 8 — Trust the developer certificate on iPhone (free accounts only)

If you are using a free Apple ID (not a paid Developer Program account), iOS will block the app with "Untrusted Developer":

1. On your iPhone: **Settings → General → VPN & Device Management**
2. Under **Developer App**, tap your Apple ID email
3. Tap **Trust "[your Apple ID]"** → confirm

You only have to do this once per 7 days (free account limit). Paid developer accounts do not hit this restriction.

---

## Step 9 — First launch walkthrough

1. The app opens and immediately requests HealthKit access
2. Grant access to all listed types (HRV, Resting Heart Rate, Sleep, Active Energy, Body Mass)
3. The app fetches the last 7 days of data and uploads to your Replit backend
4. The dashboard loads — if your Replit is asleep, tap **Try Again** after ~10 seconds (Replit free tier cold-starts in ~5–10s)

> **No data shown / score is 0?** This is expected if your Apple Watch hasn't recorded HRV or resting HR data. Connect an Apple Watch or manually log data in the Health app for the dashboard to populate meaningful scores.

---

## Updating the backend URL

If you redeploy your Replit or switch to a different server, update the single constant in `Models.swift`:

```swift
enum Config {
    static let baseURL = "https://YOUR-REPLIT-URL.replit.dev"
    ...
}
```

---

## File reference

| File | Purpose |
|---|---|
| `LuminaHealthApp.swift` | App entry point (`@main`) |
| `Models.swift` | All `Codable` types + `Config` constants |
| `HealthKitManager.swift` | HealthKit auth, incremental fetch, HK→API mapping |
| `APIClient.swift` | URLSession wrapper for all backend calls |
| `DashboardViewModel.swift` | `@MainActor ObservableObject` state machine |
| `ContentView.swift` | All SwiftUI views (dashboard, sleep card, evidence, explain sheet) |

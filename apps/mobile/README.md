# mobile

React Native Android app for supermarket supervisors. Receives authorization requests in real time via SSE from the BFF, displays them in a scrollable card list, and allows the supervisor to approve or reject each request.

## Stack

| Component | Technology |
|---|---|
| Framework | React Native 0.76 (Android) |
| Language | TypeScript |
| UI system | `@gluestack-ui/themed` v1 |
| SSE client | `react-native-sse` |
| HTTP client | Centralized `bffClient` |
| Config | `react-native-config` |
| Testing | Jest + `@testing-library/react-native` + Detox (E2E) |

## Architecture

```
App.tsx                              # Entry point: GluestackUIProvider → SessionProvider → SupervisorApp

src/
  api/
    bffClient.ts                     # Centralized HTTP client (BFF_BASE_URL)

  context/
    SessionContext.tsx               # Provides storeId, supervisorId

  hooks/
    useSSERequests.ts                # GET /pending + EventSource SSE
    useDecision.ts                   # POST /authorization/:id/resolve

  components/
    AuthorizationCard.tsx            # Request card: type, POS ID, date, status badge
    AuthorizationList.tsx            # Scrollable card list + loading/empty states

  screens/
    AuthorizationDetailScreen.tsx    # Request detail + Approve/Reject buttons
```

## Layer separation

| Layer | Can do | Cannot do |
|---|---|---|
| **API adapter** (`bffClient`) | Centralize BASE_URL, headers, HTTP error handling | Business logic, local state |
| **Hooks** | Data logic (fetch, SSE, decisions), state | Render JSX |
| **Components** | Render props, fire callbacks | Call `bffClient` directly, know URLs |
| **Screens** | Compose hooks + components, orchestrate layout | Business logic, direct HTTP calls |

## Gluestack UI components

| Component | Usage |
|---|---|
| `Box` | Generic container with inline styles |
| `HStack` / `VStack` | Horizontal / vertical layouts |
| `Pressable` | Replaces `TouchableOpacity` |
| `Text` | All app text |
| `Badge` + `BadgeText` | Status badge (Pending / Approved / Rejected) |
| `Center` | Center `Spinner` and empty state |
| `Spinner` | Loading state |
| `ScrollView` | Card list |
| `Button` + `ButtonText` | Approve / Reject buttons |
| `ButtonSpinner` | Spinner inside Approve button while loading |

## BFF endpoints consumed

| Operation | Path | Description |
|---|---|---|
| Initial load | `GET /authorization/store/:storeId/pending` | Pending requests on mount |
| SSE stream | `GET /stream/store/:storeId` | Real-time `authorization_request` events |
| Submit decision | `POST /authorization/:id/resolve` | Body: `{ decision, supervisor_id }` |

## Running

```bash
# Terminal 1: Metro bundler (must be running before pnpm android)
cd apps/mobile && pnpm start

# Terminal 2: build, install, launch on emulator
cd apps/mobile && pnpm android

# Tests
pnpm --filter mobile test

# Type check
pnpm --filter mobile typecheck

# E2E tests
pnpm --filter mobile detox:test
```

## Environment variables

| Variable | Description |
|---|---|
| `BFF_BASE_URL` | BFF base URL (e.g. `http://10.0.2.2:3000` on Android emulator) |

Configured in `apps/mobile/.env` via `react-native-config`.

## Testing conventions

- Use `renderWithProvider` (from `jest.setup.js`) instead of raw `render` for Gluestack components.
- `jest.config.js` includes `@gluestack-ui|@gluestack-style` in `transformIgnorePatterns` (pure ESM).

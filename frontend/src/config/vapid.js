// Web Push VAPID keys — generate with: npx web-push generate-vapid-keys
// Single source of truth for the frontend VAPID public key.
// Returns an empty string when the env var is not set so callers can
// detect "push disabled" without crashing.
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

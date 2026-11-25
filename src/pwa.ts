import { registerSW } from "virtual:pwa-register";

/** Register the service worker so the app keeps working offline. No-op in dev. */
export function registerOffline() {
  if (import.meta.env.DEV) return;
  registerSW({ immediate: true });
}

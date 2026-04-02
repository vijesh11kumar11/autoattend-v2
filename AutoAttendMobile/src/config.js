/**
 * AutoAttend AI — Mobile runtime config
 *
 * API_BASE_URL   Set EXPO_PUBLIC_API_URL in your .env file for each environment.
 *               Default is the typical LAN IP when running Metro locally.
 *               Change to your server IP before first device test.
 *
 * API_TIMEOUT           Axios request timeout (milliseconds).
 * STARTUP_PING_TIMEOUT  Startup backend health-check timeout (milliseconds).
 */

export const API_BASE_URL         = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.100:8000';
export const API_TIMEOUT          = 15_000;
export const STARTUP_PING_TIMEOUT = 10_000;

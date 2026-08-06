/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_ORIGIN_URL: string;
  readonly VITE_ENV: string;
}

interface Window {
  __VRSS_SERVER_ORIGIN_URL__?: string;
  __VRSS_ENABLED_AUTH_CODE__?: boolean;
}

declare const __APP_VERSION__: string;

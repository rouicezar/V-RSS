export const isProd = import.meta.env.PROD;

export const serverOriginUrl = isProd
  ? window.__VRSS_SERVER_ORIGIN_URL__
  : import.meta.env.VITE_SERVER_ORIGIN_URL;

export const appVersion = __APP_VERSION__;

export const enabledAuthCode =
  window.__VRSS_ENABLED_AUTH_CODE__ === false ? false : true;

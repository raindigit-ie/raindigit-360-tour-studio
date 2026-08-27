import { captureException, init } from "@sentry/browser";

window.__rainDigitSentrySdk = Object.freeze({ captureException, init });

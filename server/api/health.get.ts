import { defineEventHandler, setResponseHeader } from "h3";
import { healthHandler } from "../infra/health";

export default defineEventHandler((event) => {
  // Explicit Content-Type so Render's health check (and any
  // intermediate proxy) can detect the response shape without sniffing.
  setResponseHeader(event, "content-type", "application/json");
  return healthHandler();
});
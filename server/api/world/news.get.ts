import { defineEventHandler, setResponseHeader } from "h3";
import { worldService } from "../../modules/world/service";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "cache-control", "no-store");
  return worldService.news();
});

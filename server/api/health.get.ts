import { defineEventHandler } from "h3";
import { healthHandler } from "../infra/health";

export default defineEventHandler(() => healthHandler());
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { runSweep } from "../services/sweeper";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/cron/sweep", async (_req, res) => {
  try {
    const closed = await runSweep();
    res.json({ status: "ok", closed });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error?.message ?? "Sweep failed" });
  }
});

export default router;

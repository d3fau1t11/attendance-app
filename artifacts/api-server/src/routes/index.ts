import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attendanceRouter from "./attendance";
import authRouter from "./auth";
import workplacesRouter from "./workplaces";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(workplacesRouter);
router.use(attendanceRouter);

export default router;

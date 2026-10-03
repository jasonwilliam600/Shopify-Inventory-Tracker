import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import inventoryGroupsRouter from "./inventory-groups";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(inventoryGroupsRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import inventoryGroupsRouter from "./inventory-groups";
import supplierAvailabilityRouter from "./supplier-availability";
import skuMappingsRouter from "./sku-mappings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(inventoryGroupsRouter);
router.use(supplierAvailabilityRouter);
router.use(skuMappingsRouter);

export default router;

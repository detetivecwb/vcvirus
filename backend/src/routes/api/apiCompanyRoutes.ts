import express from "express";

import * as CompanyController from "../../controllers/api/CompanyController";
import * as PlanController from "../../controllers/api/PlanController";
import * as HelpController from "../../controllers/api/HelpController";
import isAuthCompany from "../../middleware/isAuthCompany";

const apiCompanyRoutes = express.Router();

// PLANS
apiCompanyRoutes.get("/plans", isAuthCompany, PlanController.index);

apiCompanyRoutes.get("/plans/:id", isAuthCompany, PlanController.show);

apiCompanyRoutes.post("/plans", isAuthCompany, PlanController.store);

apiCompanyRoutes.put("/plans/:id", isAuthCompany, PlanController.update);

apiCompanyRoutes.delete("/plans/:id", isAuthCompany, PlanController.remove);

// COMPANY
apiCompanyRoutes.get("/companies", isAuthCompany, CompanyController.index);

apiCompanyRoutes.get("/companies/:id", isAuthCompany, CompanyController.show);

apiCompanyRoutes.post("/companies", isAuthCompany, CompanyController.store);

apiCompanyRoutes.put("/companies/:id", isAuthCompany, CompanyController.update);

apiCompanyRoutes.put(
  "/companies/:id/schedules",
  isAuthCompany,
  CompanyController.updateSchedules
);

apiCompanyRoutes.delete(
  "/companies/:id",
  isAuthCompany,
  CompanyController.remove
);

// HELP
apiCompanyRoutes.get("/helps", isAuthCompany, HelpController.index);

apiCompanyRoutes.get("/helps/:id", isAuthCompany, HelpController.show);

apiCompanyRoutes.post("/helps", isAuthCompany, HelpController.store);

apiCompanyRoutes.put("/helps/:id", isAuthCompany, HelpController.update);

apiCompanyRoutes.delete("/helps/:id", isAuthCompany, HelpController.remove);


export default apiCompanyRoutes;

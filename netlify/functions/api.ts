import serverless from "serverless-http";
// @ts-ignore
import app from "../../artifacts/api-server/dist/app.mjs";

export const handler = serverless(app);

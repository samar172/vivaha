import { app } from "./app";
import { env } from "./env";
import { startHoldSweeper } from "./jobs/holdSweeper";
import { startBackInStockSweeper } from "./jobs/backInStock";

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Vivaha API listening on http://localhost:${env.PORT}`);
  startHoldSweeper();
  startBackInStockSweeper();
});

#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  approvedProductionOrigins,
  productionOriginsFromEnvironment,
} from "./lib/tour-monitoring-contract.mjs";

const approved = {
  schema: "raindigit-tour-monitoring-origins/v1",
  defaults: ["https://cdn.raindigit.ie"],
  tours: {
    "customer-tour": ["https://tour.customer.example"],
  },
};

assert.deepEqual(approvedProductionOrigins("customer-tour", approved), [
  "https://cdn.raindigit.ie",
  "https://tour.customer.example",
]);
assert.deepEqual(
  productionOriginsFromEnvironment(
    { RAINDIGIT_TOUR_SENTRY_ORIGINS: "https://tour.customer.example" },
    "customer-tour",
    approved,
  ),
  ["https://tour.customer.example"],
);
assert.throws(
  () =>
    productionOriginsFromEnvironment(
      { RAINDIGIT_TOUR_SENTRY_ORIGINS: "https://unapproved.example" },
      "customer-tour",
      approved,
    ),
  /not explicitly approved/,
);
assert.throws(
  () => approvedProductionOrigins("customer-tour", { ...approved, defaults: ["https://*.example"] }),
  /exact HTTPS origin/,
);

console.log("Tour monitoring contract passed: generated packages accept only explicit checked-in customer origins.");

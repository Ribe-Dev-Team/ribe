import { Meteor } from "meteor/meteor";
import { WebApp } from "meteor/webapp";

Meteor.startup(() => {
  console.log("Ribe Meteor backend started");
});

WebApp.connectHandlers.use("/api/health", (req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, app: "Ribe" }));
});

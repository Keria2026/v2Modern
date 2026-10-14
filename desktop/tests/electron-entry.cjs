// Isolate automated desktop tests from a developer's real application data.
const { app } = require("electron");
const path = require("node:path");
if (!process.env.V2MODERN_TEST_USER_DATA)
  throw new Error("V2MODERN_TEST_USER_DATA is required");
app.setPath("userData", process.env.V2MODERN_TEST_USER_DATA);
app.setAppPath(path.resolve(__dirname, ".."));
require("../dist/main/main.js");

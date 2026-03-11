#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { HonoMcpStack } from "./stack.js";

const app = new cdk.App();

new HonoMcpStack(app, "HonoMcpStack", {
  description: "Hono × MCP server on AWS Lambda",
});

#!/usr/bin/env node
/**
 * Production entry point: `pnpm --filter @slipstream/server start`. Configuration comes from
 * `SLIPSTREAM_*` environment variables (see the README).
 */
import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { ServerConfig } from "./config.ts";
import { makeServer } from "./server.ts";

Layer.launch(makeServer().pipe(Layer.provide(ServerConfig.layer))).pipe(NodeRuntime.runMain);

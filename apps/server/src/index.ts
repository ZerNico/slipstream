/**
 * `@slipstream/server` for embedding: the server layer, its configuration, the database and the
 * `Recorder` capture engine service.
 */
export { ServerConfig, type RecorderTuning, type ServerSettings } from "./config.ts";
export { Db, type Database, type DbShape } from "./db/client.ts";
export * as schema from "./db/schema.ts";
export { EventBus } from "./events.ts";
export { Recorder, RecorderFailed, type RangeRecording } from "./recorder/engine.ts";
export { makeServer } from "./server.ts";

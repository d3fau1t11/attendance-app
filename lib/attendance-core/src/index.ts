/**
 * Framework-free attendance logic shared by the API server and the mobile app.
 *
 * Nothing in this package performs I/O, reads the clock, or imports a runtime
 * dependency — which is why the same geofence maths can run inside an Android
 * background task and inside an Express handler without drifting apart.
 */
export * from "./geofence";
export * from "./engine";
export * from "./anomaly";

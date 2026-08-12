export * from "./types.js";
export * from "./packet.js";
export * from "./broker.js";

/** Adapt the durable MissionStore surface without exposing SQLite to the broker. */
export const missionStoreContextRepository = (store: {
	getMission: (id: string) => unknown;
	getTask: (id: string) => unknown;
	listCanonicalItems?: (id: string) => readonly unknown[];
}): import("./types.js").ContextRepository => ({
	getMission: (id) => store.getMission(id) as import("./types.js").ContextMissionRecord | undefined,
	getTask: (id) => store.getTask(id) as import("./types.js").ContextTaskRecord | undefined,
	listCanonicalItems: (id) => (store.listCanonicalItems?.(id) ?? []) as readonly import("./types.js").ContextCanonicalItem[],
});

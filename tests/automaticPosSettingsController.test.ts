import { expect, it, vi } from "vitest";
import { AutomaticPosSettingsController, type AutomaticPosSettingsTicket, type AutomaticPosTransactionHost } from "../src/settings/AutomaticPosSettingsController";
import { DEFAULT_AUTOMATIC_POS } from "../src/settings/automaticPosSettings";
const off = Object.freeze({ noun: false, verb: false, iAdjective: false, adverb: false });
function setup() {
	const prepare = vi.fn<AutomaticPosTransactionHost["prepare"]>(async () => true), commit = vi.fn<AutomaticPosTransactionHost["commit"]>(async () => true);
	const controller = new AutomaticPosSettingsController({ prepare, commit });
	return { controller, port: controller.toolbarPort(), prepare, commit };
}
function deferred() { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(r => { resolve = r; }); return { promise, resolve }; }
it("keeps draft toggles separate from effective and every host callback", () => {
	const { controller, port, prepare, commit } = setup(), previous = controller.read().effective;
	expect(port.open()).toBe(true); expect(port.change(off)).toBe(true);
	expect(port.read().status).toBe("draft"); expect(port.read().draft).toEqual(off);
	expect(port.read().effective).toBe(previous); expect(prepare).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
	port.close(); expect(port.read().draft).toBeNull(); expect(port.read().status).toBe("cancelled");
	port.open(); expect(port.read().draft).toEqual(DEFAULT_AUTOMATIC_POS);
});
it("orders detached prepare then commit and publishes only after both succeed", async () => {
	const { controller, port, prepare, commit } = setup(), gate = deferred(), saved = deferred();
	prepare.mockReturnValue(gate.promise); commit.mockReturnValue(saved.promise); port.open(); port.change(off);
	const request = port.apply(off);
	expect(port.read().status).toBe("preparing"); expect(commit).not.toHaveBeenCalled();
	expect(await port.apply(off)).toBe("invalid-request"); expect(prepare).toHaveBeenCalledTimes(1);
	gate.resolve(true); await Promise.resolve();
	expect(controller.read().status).toBe("ready"); expect(controller.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
	expect(Object.isFrozen(prepare.mock.calls[0]?.[0])).toBe(true);
	saved.resolve(true); expect(await request).toBe("committed"); expect(controller.read().effective).toEqual(off);
	expect(controller.read().status).toBe("committed"); expect(controller.read().draft).toBeNull();
});
it.each(["prepare", "commit"] as const)("keeps effective on %s failure and confines exception text", async stage => {
	const { port, prepare, commit } = setup(); (stage === "prepare" ? prepare : commit).mockRejectedValue(new Error("secret.md reading surface nonce"));
	port.open(); const pending = port.apply(off); expect(await pending).toBe("failed");
	expect(port.read()).toEqual({ status: "failed", effective: DEFAULT_AUTOMATIC_POS, draft: null, error: "failed" });
	if (stage === "prepare") expect(commit).not.toHaveBeenCalled();
});
it.each(["cancel", "markStale", "dispose"] as const)("rejects delayed prepare after %s without invoking commit", async action => {
	const { controller, port, prepare, commit } = setup(), gate = deferred(); prepare.mockReturnValue(gate.promise);
	port.open(); const pending = port.apply(off); controller[action](); gate.resolve(true);
	expect(await pending).toBe(action === "cancel" ? "cancelled" : action === "markStale" ? "stale" : "disposed");
	expect(commit).not.toHaveBeenCalled(); expect(port.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
});
it.each(["cancel", "markStale", "dispose"] as const)("rejects delayed commit after %s", async action => {
	const { controller, port, commit } = setup(), gate = deferred(); commit.mockReturnValue(gate.promise);
	port.open(); const pending = port.apply(off); await Promise.resolve(); expect(port.read().status).toBe("ready");
	controller[action](); gate.resolve(true); expect(await pending).not.toBe("committed"); expect(port.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
});
it("rejects stale completion independently of preparation and persistence", () => {
	const { controller } = setup(), ticket = controller.begin(off)!; expect(controller.prepared(ticket)).toBe(true);
	controller.markStale(); expect(controller.complete(ticket)).toBe("stale"); expect(controller.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
});
it("rejects disposed completion independently of preparation and persistence", () => {
	const { controller } = setup(), ticket = controller.begin(off)!; controller.prepared(ticket);
	controller.dispose(); expect(controller.complete(ticket)).toBe("disposed"); expect(controller.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
});
it("rejects forged cloned foreign and replayed tickets with a positive control", () => {
	const { controller } = setup(), ticket = controller.begin(off)!;
	const other = setup().controller, foreign = other.begin(off)!; other.prepared(foreign);
	expect(controller.complete(ticket)).toBe("invalid-ticket"); controller.prepared(ticket);
	for (const forged of [{}, { ...ticket }, structuredClone(ticket), foreign, new Proxy(ticket, {}), null, 1]) {
		expect(controller.complete(forged as AutomaticPosSettingsTicket)).toBe("invalid-ticket");
	}
	expect(controller.complete(ticket)).toBe("committed"); expect(controller.complete(ticket)).toBe("stale");
	expect(controller.read().effective).toEqual(off);
});
it("supersedes an old request without letting its completion overwrite the new draft", async () => {
	const { controller, port, prepare, commit } = setup(), gate = deferred(); prepare.mockReturnValue(gate.promise);
	port.open(); const old = port.apply(off);
	const next = controller.begin({ ...off, verb: true })!;
	gate.resolve(true); expect(await old).toBe("stale"); expect(commit).not.toHaveBeenCalled();
	expect(controller.read().draft?.verb).toBe(true); controller.prepared(next); expect(controller.complete(next)).toBe("committed");
});
it("can reopen after cancellation while the old completion remains in flight", async () => {
	const { port, prepare } = setup(), gate = deferred(); prepare.mockReturnValueOnce(gate.promise);
	port.open(); const old = port.apply(off); port.close(); port.open(); port.change({ ...off, adverb: true });
	gate.resolve(true); expect(await old).toBe("cancelled"); expect(port.read().draft?.adverb).toBe(true); expect(port.read().status).toBe("draft");
});
it("has a ticket-free frozen presenter facade and validates before preparation", async () => {
	const { port, controller, prepare } = setup(); expect(Object.keys(port)).toEqual(["read", "open", "change", "apply", "close"]);
	expect(Object.isFrozen(port)).toBe(true); port.open(); expect(await port.apply({ ...off, verb: "true" } as never)).toBe("invalid-request");
	expect(prepare).not.toHaveBeenCalled(); expect(controller.begin(new Proxy(off, { ownKeys() { throw Error("private"); } }))).toBeNull();
	controller.dispose(); expect(port.open()).toBe(false); expect(controller.begin(off)).toBeNull();
});
it("keeps runtime private ownership inaccessible through reflection", () => {
	const { controller } = setup(), ticket = controller.begin(off)!;
	expect(Reflect.ownKeys(controller)).toEqual([]); expect(Reflect.ownKeys(ticket)).toEqual([]);
	expect(Object.isFrozen(ticket)).toBe(true); expect(Object.isFrozen(controller.read())).toBe(true);
	expect(Object.isFrozen(controller.read().draft)).toBe(true);
});
it("invalidates host side-effect guards on supersession and preserves independent owners", async () => {
	let current!: () => boolean;
	const gate = deferred();
	const first = new AutomaticPosSettingsController({ prepare: async () => true, commit: async (_options, isCurrent) => { current = isCurrent; return gate.promise; } });
	const port = first.toolbarPort(); port.open(); const pending = port.apply(off); await Promise.resolve(); expect(current()).toBe(true);
	const second = setup().controller, independent = second.begin(off)!; second.prepared(independent);
	const next = first.begin({ ...off, adverb: true })!; expect(current()).toBe(false); gate.resolve(true); expect(await pending).toBe("stale");
	expect(first.read().draft?.adverb).toBe(true); first.prepared(next); expect(first.complete(next)).toBe("committed");
	expect(second.complete(independent)).toBe("committed"); expect(second.read().effective).toEqual(off);
});

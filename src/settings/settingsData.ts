/** Copy own data properties only. No accessor invocation or retained caller object.
 * A Proxy can describe data, but that data is validated just like ordinary input;
 * neither prototype nor descriptor equality ever grants ownership. */
export function settingsData(value: unknown): Record<string, unknown> | null {
	try {
		if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
		const prototype: unknown = Object.getPrototypeOf(value);
		if (prototype !== null && prototype !== Object.prototype) return null;
		const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") return null;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor)) continue;
			result[key] = descriptor.value;
		}
		return result;
	} catch { return null; }
}

/** Format a captured UTC instant as the user's local calendar day, without a time of day. */
export function localCollectionDate(created: string): string {
	const date = new Date(created);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

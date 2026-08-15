export interface CanonicalModelOptionInput {
	readonly value: string;
	readonly remoteModelId?: string | undefined;
	readonly displayName?: string | undefined;
}

export interface CanonicalModelOption {
	readonly value: string;
	readonly displayName: string;
	readonly label: string;
}

export const canonicalModelName = (input: Pick<CanonicalModelOptionInput, "remoteModelId" | "displayName">): string =>
	input.remoteModelId?.trim() || input.displayName?.trim() || "Unknown model";

export const formatCanonicalModelLabel = (input: Pick<CanonicalModelOptionInput, "remoteModelId" | "displayName">): string =>
	canonicalModelName(input);

export const canonicalModelOptions = (inputs: readonly CanonicalModelOptionInput[]): readonly CanonicalModelOption[] => {
	const names = inputs.map(formatCanonicalModelLabel);
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	const occurrences = new Map<string, number>();
	return inputs.map((input, index) => {
		const displayName = names[index] ?? "Unknown model";
		const occurrence = (occurrences.get(displayName) ?? 0) + 1;
		occurrences.set(displayName, occurrence);
		return {
			value: input.value,
			displayName,
			label: (counts.get(displayName) ?? 0) > 1 ? `${displayName} #${occurrence}` : displayName,
		};
	});
};

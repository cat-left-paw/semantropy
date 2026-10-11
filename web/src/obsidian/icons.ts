import {
	Blend,
	BookOpen,
	BrainCircuit,
	CircleCheck,
	CircleQuestionMark,
	CircleX,
	Copy,
	Dices,
	Download,
	Ellipsis,
	FileInput,
	FilePlus,
	GitBranch,
	Gauge,
	GraduationCap,
	Inbox,
	Info,
	Library,
	ListPlus,
	ListChecks,
	MessageSquareWarning,
	RefreshCw,
	Shuffle,
	SlidersHorizontal,
	Sparkles,
	Trash2,
	TriangleAlert,
	WandSparkles,
	X,
	createElement,
	type IconNode,
} from "lucide";

/**
 * The Lucide glyphs Semantropy names, keyed by the ids Obsidian's `setIcon`
 * accepts. Only these are bundled; an unknown id renders an empty glyph rather
 * than fetching anything.
 */
const ICONS: Readonly<Record<string, IconNode>> = Object.freeze({
	"blend": Blend,
	"book-open": BookOpen,
	"brain-circuit": BrainCircuit,
	"circle-check": CircleCheck,
	// Obsidian 1.13.7 still names this glyph `circle-help`; Lucide 1.x calls it CircleQuestionMark.
	"circle-help": CircleQuestionMark,
	"circle-x": CircleX,
	"copy": Copy,
	"dices": Dices,
	"download": Download,
	"ellipsis": Ellipsis,
	"file-input": FileInput,
	"file-plus": FilePlus,
	"git-branch": GitBranch,
	"gauge": Gauge,
	"graduation-cap": GraduationCap,
	"inbox": Inbox,
	"info": Info,
	"library": Library,
	"list-checks": ListChecks,
	"list-plus": ListPlus,
	"message-square-warning": MessageSquareWarning,
	"refresh-cw": RefreshCw,
	"shuffle": Shuffle,
	"sliders-horizontal": SlidersHorizontal,
	"sparkles": Sparkles,
	"trash-2": Trash2,
	"triangle-alert": TriangleAlert,
	"wand-sparkles": WandSparkles,
	"x": X,
});

export function createIcon(iconId: string): SVGElement {
	const node = ICONS[iconId] ?? [];
	const svg = createElement(node, { class: `svg-icon lucide-${iconId}`, "aria-hidden": "true" });
	return svg;
}

/** Obsidian's `setIcon`: the element's content becomes one glyph. */
export function setIcon(parent: HTMLElement, iconId: string): void {
	parent.replaceChildren(createIcon(iconId));
}

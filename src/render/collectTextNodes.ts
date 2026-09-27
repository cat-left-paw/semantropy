const PROTECTED_TAGS = new Set([
	"a",
	"pre",
	"code",
	"script",
	"style",
	"svg",
	"math",
	"input",
	"textarea",
	"button",
	"select",
	"option",
	"mjx-container",
	"img",
	"iframe",
	"audio",
	"video",
	"object",
	"canvas",
	"embed",
	"link",
	"source",
	"track",
	"picture",
]);

const PROTECTED_CLASSES = [
	"frontmatter-container",
	"metadata-container",
	"metadata-properties",
	"tag",
	"internal-embed",
	"markdown-embed",
	"file-embed",
	"media-embed",
	"image-embed",
	"math",
	"math-inline",
	"math-block",
	"MathJax",
];

export function isProtectedElement(element: Element): boolean {
	if (element.localName.includes("-") || element.hasAttribute("is")) return true;
	if (PROTECTED_TAGS.has(element.tagName.toLowerCase())) {
		return true;
	}
	return PROTECTED_CLASSES.some((className) =>
		element.classList.contains(className),
	);
}

function isElement(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE;
}

export function isInsideProtectedSubtree(
	node: Node,
	root: HTMLElement,
): boolean {
	let current: Element | null = isElement(node) ? node : node.parentElement;
	while (current) {
		if (isProtectedElement(current)) {
			return true;
		}
		if (current === root) {
			break;
		}
		current = current.parentElement;
	}
	return false;
}

function isMeaningfulText(node: Text): boolean {
	return node.nodeValue !== null && node.nodeValue.trim() !== "";
}

export function collectTransformableTextNodes(root: HTMLElement): Text[] {
	const documentRef = root.ownerDocument;
	const view = documentRef.defaultView;
	const filter = view?.NodeFilter ?? NodeFilter;
	const walker = documentRef.createTreeWalker(root, filter.SHOW_TEXT, {
		acceptNode: (node: Node) => {
			if (node.nodeType !== Node.TEXT_NODE) {
				return filter.FILTER_REJECT;
			}
			const text = node as Text;
			if (!isMeaningfulText(text)) {
				return filter.FILTER_REJECT;
			}
			if (isInsideProtectedSubtree(text, root)) {
				return filter.FILTER_REJECT;
			}
			return filter.FILTER_ACCEPT;
		},
	});

	const nodes: Text[] = [];
	let current = walker.nextNode();
	while (current) {
		nodes.push(current as Text);
		current = walker.nextNode();
	}
	return nodes;
}

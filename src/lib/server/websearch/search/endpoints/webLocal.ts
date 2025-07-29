import { JSDOM, VirtualConsole } from "jsdom";
import { isURL } from "$lib/utils/isUrl";
import type { WebSearchSource } from "$lib/types/WebSearch";
import { withPage } from "$lib/server/websearch/scrape/playwright";

export default async function searchWebLocal(query: string): Promise<WebSearchSource[]> {
	const htmlString = await withPage(
		"https://www.google.com/search?hl=en&q=" + encodeURIComponent(query),
		(page) => page.content()
	).catch((e) => {
		console.error(e);
		return undefined;
	});

	if (!htmlString) {
		return [];
	}
	console.log("htmlString", htmlString);

	const virtualConsole = new VirtualConsole();
	virtualConsole.on("error", () => {
		// No-op to skip console errors.
	});
	const document = new JSDOM(htmlString, { virtualConsole }).window.document;
	console.log("document", document);
	const links = document.querySelectorAll("a");
	console.log("links", links);

	if (!links.length) {
		console.warn("Webpage has no links");
		return [];
	}

	const linksHref = Array.from(links)
		.map((el) => el.href)
		.filter((link) => link.startsWith("/url?q=") && !link.includes("google.com/"))
		.map((link) => {
			try {
				const url = new URL(link, "https://www.google.com");
				return url.searchParams.get("q");
			} catch {
				return null;
			}
		})
		.filter((link): link is string => !!link)
		.filter(isURL);

	return [...new Set(linksHref)].map((link) => ({ link }));
}

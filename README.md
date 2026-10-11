# Semantropy

[English](README.md) | [日本語](README.ja.md)

Semantropy is a desktop-only Obsidian plugin for creative writing in Japanese. It makes unexpected variations of a Markdown note in a separate view, without changing the source note. The name combines *semantic* and *entropy*.

## What you can do

- **Transform Japanese prose.** Open the current note. Opening reads the note and prepares its vocabulary but does not shuffle anything: the body shows **Generate** until you press it (**Generate text** in the Shuffle tab's own bar and the **Reshuffle text** command do the same). Generating shows the first section; **Reshuffle text** then makes another variation, and **Load next section** adds one section at a time. Changes to the source are marked stale until you choose **Refresh target**; a stale note must be refreshed before it is generated. Opening another note, or the same note again, starts again from **Generate**. A working indicator appears over the body while it is prepared or reshuffled.
- **Choose the target.** The Shuffle tab has its own bar under the tab row: **Choose target note**, the target's name, and **Reshuffle text** (named **Generate text** until the first generation), **Refresh target**, **Copy selection** and **Collect selection**. Its sentences say what state the body is in (not generated yet, the target changed, how many words were replaced, how many words you changed by hand, and whether the selected word can be shuffled). **Choose target note** lists the Vault's Markdown notes by path and opens the one you pick, as **Semantropy: Open** does for the active note; nothing is read until you pick. If **Semantropy: Open** finds no Markdown note to take (for example when it is run from the Semantropy view itself), it does not start over: the view keeps its target, body, vocabulary and Recompose text, and a notice says how to open a note.
- **Two tabs.** The area below the toolbar has two tabs, **Shuffle** and **Recompose**. They are there even when no note is open; then Shuffle only tells you to open one (the **Choose target note** button picks one without opening it), and Recompose and the phrase generators work from the vocabulary you choose (use **Change vocabulary** and select notes). Recompose is a tab only: the toolbar has no Recompose button, and the tab has its own **Generate new**, **Copy** and **Collect**. Each tab keeps its scroll position, and the Recompose text stays until you close the view. The Shuffle bar, the toolbar's word actions and the selected-word sentence belong to the Shuffle tab and are not shown or are off while Recompose is shown; the **Reshuffle text** and **Refresh target** commands switch back to Shuffle first.
- **Choose vocabulary.** Use the current note or explicitly selected notes as Vocabulary Sources. Once a vocabulary is applied, the status line names its notes, for example `Vocabulary: Current Note “Cherry.md” · Draw mode: Uniform`; with several selected notes it names the first one in path order and a ▶ button lists them all. Choose Uniform or Frequency draws. Each selected note can be weighted from ×0.25 to ×4; with every note at ×1, draws are exactly as before. Nouns, independent verbs, i-adjectives and regular adverbs are enabled separately; nouns are enabled by default. Changes in the dialog take effect only after **Apply Vocabulary**.
- **Group words in a Vocabulary Source.** Text written like `{{猫又}}` in a Vocabulary Source is one noun. **Extra term delimiters** in the settings adds up to four more pairs such as `【…】`; `{{…}}` is always on. The Target's display is unchanged.
- **Set Text Semantropy.** Off (0) leaves the text unchanged; Low (25), Medium (50), High (75) and MAX (100) progressively change more text or allow broader candidates. Intermediate whole-number values are also available. Unsupported conjugations retain the original text.
- **Change one word.** Clicking a word in the body opens the **Word actions** menu: **Shuffle this word**, **Restore original**, **Use automatic result** and **Look up in Fake Dictionary**. Manual candidates must be observed in the active vocabulary. A one-word selection shows the number of alternatives or why none is available.
- **Make other text.** Fake Dictionary creates a definition for a word and has its own Semantropy level. The **Fake dictionary** button in the toolbar's Settings group opens a dialog that says how to look a word up, holds the hover key (Alt or Option, or Shift) and shows what the current vocabulary can fill. Collision generates 10, 20 or 50 results from random or chosen patterns, and each row can be regenerated with the same pattern. Click a noun, modifier or predicate in a result to lock it (click again to release); regenerating a row with locked words keeps them, along with the pattern, the connectors and the fixed words between them, and draws only the rest again. Locks last while the dialog is open and are never saved, and Copy and Collect use the text as shown. Fake proverb generates ten proverb-and-explanation pairs. **Recompose** (the second tab) builds new text from how the Vocabulary Sources' sentences join, and can continue it or branch from a chosen place. In that text, hold the hover key over a word Fake Dictionary can define (the dictionary marker underlines such words) to see its definition; the definition belongs to the vocabulary the text came from, not to a note, so it can be copied but not collected, and the keyboard commands do not look up words of the Recompose text. Clicking a word still chooses the branch point. Each result has explicit Copy and Collect actions. **Fake alert** shows an absurd, system-style dialog made from the Vocabulary; its buttons lead to equally absurd results. It is a joke only, has no Copy or Collect, and Escape or the close button always closes it.
- **Choose how it looks.** The toolbar stays visible while the body scrolls. Display settings control the body font, size, theme (Default (Obsidian theme), Light or Dark), text and background colours, ruby readings and interaction markers without changing generated text. The interface is available in Japanese and English, but only Japanese text can be transformed; command palette names remain English.

The analyzer is Lindera WebAssembly with an embedded compact IPADIC dictionary. It works locally and offline after installation. No dictionary directory or runtime download is required.

## Try it in a browser

A web Playground runs Semantropy without installing anything: <https://cat-left-paw.github.io/semantropy/>

Paste Japanese text or pick a preset, then reshuffle it, change the vocabulary or use Recompose. Analysis and generation run entirely in the browser; the text you enter is not sent anywhere, and there is no analytics. The first visit loads about 11 MB of dictionary data. The page is in Japanese, and collected fragments are kept only in that browser.

## Getting started

1. Open a Japanese Markdown note in Obsidian Desktop 1.13.7 or later.
2. Run **Semantropy: Open** from the command palette, or use the Semantropy ribbon icon. With no note open, the view still opens: use **Choose target note** to pick one.
3. Press **Generate** in the Semantropy view to shuffle the note. Then use **Reshuffle text** and **Load next section**. Open the **Recompose** tab to build new text from the vocabulary.
4. Use **Change vocabulary** to choose Current Note or Selected Notes and a draw mode, then select **Apply Vocabulary**. **Automatic parts of speech** has a separate **Apply** action.
5. Select text in the Semantropy view, then use **Copy selection** or **Collect selection**. For one word, click it and choose **Look up in Fake Dictionary**, use **Semantropy: Define selected word**, or hover over it while holding Alt on Windows or Option (⌥) on macOS. The hover modifier can be changed to Shift in the **Fake dictionary** dialog. In the **Recompose** tab the same hover works on the underlined words of the text (a definition made there cannot be collected).

Set the destination under **Settings → Semantropy → Collection file** and select **Save** before collecting. The default is `Semantropy Fragments.md`. New entries contain readable Markdown without metadata comments. Five optional attribution switches can add the generation type, Target note, Vocabulary notes, Text Semantropy level and local collection date; all are off by default. Existing entries are preserved. The Collection file cannot be a Target or Vocabulary Source used to produce the result.

## Privacy and file access

- Analysis, generation and dictionary use run locally. The plugin makes no runtime network requests and contains no telemetry.
- Semantropy reads the active Target and any notes explicitly applied as Vocabulary Sources. The transformed view is built from inert elements; note images and embeds are placeholders rather than network-loaded resources.
- The source note is never overwritten. An explicit **Collect** writes only to the configured Collection Markdown file. An explicit **Copy** writes to the clipboard; an empty or invalid selection does not copy another fragment.
- Plugin settings are stored in Obsidian's plugin `data.json`: the Semantropy levels, Collection path, draw mode, display preferences (including theme and colours), hover modifier, automatic parts of speech, interface language, ribbon visibility, attribution switches and extra term delimiters. Vocabulary weights, note snapshots, tokens, generated text, manual changes and generation state are not persisted.

## Limits and compatibility

- Desktop only; mobile is unsupported. Transformation is designed for Japanese text. Vocabulary can come from the current note or selected notes, not an entire folder or Vault.
- Semantropy displays paragraphs, simple headings, emphasis, line breaks and supported ruby. Links, code, math, tags and unsupported Markdown are protected from transformation. Links are not interactive; images and embeds appear as placeholders. This view is not Obsidian Reading view.
- Manual verb and i-adjective changes use supported forms observed in the vocabulary; unsupported forms stay unchanged. A very large note, especially at MAX, can take several seconds to prepare. A single parser or tokenizer step may delay cancellation.
- Template syntax such as `{{date}}` in a Vocabulary Source is read as a noun (`date`) like any other enclosed term.
- A narrow pane with high zoom can leave little room for the body below the fixed toolbar. Vertical writing, a dedicated Collection view, folder-wide vocabulary and user-editable templates are not included.
- 0.1.0 uses a new settings format. Settings saved by 0.1.0 cannot be read by 0.0.1; going back to 0.0.1 resets the settings to their defaults.

`main.js` is about 14 to 16 MB because it embeds WebAssembly and the dictionary (the macOS 0.0.1 build measured 14,184,815 bytes). The size differs by operating system and version; check the GitHub Release for the size of the asset you install. This exceeds [Obsidian Sync Standard's 5 MB per-file limit](https://obsidian.md/help/sync/plans). Standard users should install or update the plugin on each device rather than rely on the plugin file to sync. Sync Plus allows files up to 200 MB.

## Installation

Install Semantropy from Obsidian's Community Plugins browser. To install from a GitHub Release manually, place that release's `main.js`, `manifest.json` and `styles.css` in:

```text
<vault>/.obsidian/plugins/semantropy/
```

Reload Obsidian, then enable Semantropy under **Settings → Community plugins**. Use all three files from the same version.

## Build from source

```bash
npm ci
npm run build
```

On a clean checkout, the first `npm run build` verifies or prepares the compact dictionary. If no verified cache exists, it downloads the Lindera IPADIC 6.0.0 archive from one pinned URL, checks its size and SHA-256, derives the compact dictionary and checks the resulting hashes before publishing it. `npm run build:distribution` performs the same preparation and produces only the three release files under `dist/semantropy/`. Later builds reuse a verified cache. A failed or unverified preparation stops the build without replacing an existing artifact. `npm ci`, tests, `npm run dev` and the plugin runtime do not download the dictionary.

After building, the source checkout can run `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify:distribution` and `npm run verify:reproducible`. The distribution tests also require the extracted archive; the first build or `npm run prepare:dictionary` prepares it.

`npm run verify:reproducible` checks byte-for-byte reproducibility within one build environment. macOS and Windows builds may differ in compressed payload bytes and short minified identifiers; the distribution tests pin the production code after masking those payloads and normalizing those identifiers.

## License and notices

Semantropy's original source is [MIT licensed](LICENSE). The distribution includes lindera-wasm and dictionary data under their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE). The generated `main.js` includes the applicable license and notice text in its banner so it remains available in the three-file installation.

Author: Cat Left Paw / 猫乃 左手.

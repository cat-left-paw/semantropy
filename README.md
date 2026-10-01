# Semantropy

[English](README.md) | [日本語](README.ja.md)

Semantropy is a desktop-only Obsidian plugin for creative writing in Japanese. It makes unexpected variations of a Markdown note in a separate view, without changing the source note. The name combines *semantic* and *entropy*.

## What you can do

- **Transform Japanese prose.** Open the current note, then use **Reshuffle text** for another variation. The first section appears initially; **Load next section** adds one section at a time. Changes to the source are marked stale until you choose **Refresh target**. A working indicator appears over the body while it is prepared or reshuffled.
- **Choose vocabulary.** Use the current note or explicitly selected notes as Vocabulary Sources. Choose Uniform or Frequency draws. Each selected note can be weighted from ×0.25 to ×4; with every note at ×1, draws are exactly as before. Nouns, independent verbs, i-adjectives and regular adverbs are enabled separately; nouns are enabled by default. Changes in the dialog take effect only after **Apply Vocabulary**.
- **Group words in a Vocabulary Source.** Text written like `{{猫又}}` in a Vocabulary Source is one noun. **Extra term delimiters** in the settings adds up to four more pairs such as `【…】`; `{{…}}` is always on. The Target's display is unchanged.
- **Set Text Semantropy.** Off (0) leaves the text unchanged; Low (25), Medium (50), High (75) and MAX (100) progressively change more text or allow broader candidates. Intermediate whole-number values are also available. Unsupported conjugations retain the original text.
- **Change one word.** Clicking a word in the body opens the **Word actions** menu: **Shuffle this word**, **Restore original**, **Use automatic result** and **Look up in Fake Dictionary**. Manual candidates must be observed in the active vocabulary. A one-word selection shows the number of alternatives or why none is available.
- **Make other text.** Fake Dictionary creates a definition for a word and has its own Semantropy level. Collision generates 10, 20 or 50 results from random or chosen patterns, and each row can be regenerated with the same pattern. Fake proverb generates ten proverb-and-explanation pairs. **Recompose** builds new text from how the Vocabulary Sources' sentences join, and can continue it or branch from a chosen place. Each result has explicit Copy and Collect actions.
- **Choose how it looks.** The toolbar stays visible while the body scrolls. Display settings control the body font, size, theme (Default (Obsidian theme), Light or Dark), text and background colours, ruby readings and interaction markers without changing generated text. The interface is available in Japanese and English, but only Japanese text can be transformed; command palette names remain English.

The analyzer is Lindera WebAssembly with an embedded compact IPADIC dictionary. It works locally and offline after installation. No dictionary directory or runtime download is required.

## Try it in a browser

A web Playground runs Semantropy without installing anything: <https://cat-left-paw.github.io/semantropy/>

Paste Japanese text or pick a preset, then reshuffle it, change the vocabulary or use Recompose. Analysis and generation run entirely in the browser; the text you enter is not sent anywhere, and there is no analytics. The first visit loads about 11 MB of dictionary data. The page is in Japanese, and collected fragments are kept only in that browser.

## Getting started

1. Open a Japanese Markdown note in Obsidian Desktop 1.13.7 or later.
2. Run **Semantropy: Open** from the command palette, or use the Semantropy ribbon icon.
3. Use **Load next section** and **Reshuffle text** in the Semantropy view.
4. Use **Change vocabulary** to choose Current Note or Selected Notes and a draw mode, then select **Apply Vocabulary**. **Automatic parts of speech** has a separate **Apply** action.
5. Select text in the Semantropy view, then use **Copy selection** or **Collect selection**. For one word, click it and choose **Look up in Fake Dictionary**, use **Semantropy: Define selected word**, or hover over it while holding Alt on Windows or Option (⌥) on macOS. The hover modifier can be changed to Shift in the view.

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

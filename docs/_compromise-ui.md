# The browser compromises behind the UI

The UI's source comments cite this page when they say "measured, not assumed". It collects the
measurements behind four decisions that span several files, so each comment can point at one
place instead of restating them. **The register stays authoritative**: the decisions and their
costs are owned by `docs/COMPROMISES.md` entry [#8](COMPROMISES.md) ("The runtime is delivered
from an origin, not from a folder you were handed") and entry #10 ("'It is simply a folder' is
Chromium-only"). This page is the cross-reference those comments cite, not a second register.

Cited by: `index.html`, `serve.mjs`, `runtime/ui/boot.js`, `runtime/ui/storage.js`,
`runtime/ui/forms.js`, `runtime/ui/shell-files.js`, `runtime/ui/viewmodel.js`.
Guarded by `test/site-citations.test.js`, which fails if any of those citations dangles.

---

## 1. The runtime is delivered from an origin, not from a folder

The manifesto's day-one promise (Appendix X) has Sarah double-clicking the HTML. That was tested
rather than reasoned about — Chrome 148 and Safari 26.5 on macOS, same probe page, both schemes,
headless over the DevTools Protocol (Safari driven in the real browser, results out by image
beacon). The full table lives in register entry #8. What it found:

- **External module scripts are blocked on `file://` in both engines.** An inline classic script
  runs; an inline module with zero imports runs; one `import` statement and both engines refuse.
  The module graph — which is the whole runtime — cannot load from a folder. This is why
  `index.html` carries an inline classic boot script whose only job is to explain the blank page,
  and why `serve.mjs` exists at all.
- **Secure context was never the problem.** `file://` *is* a secure context in both engines. The
  blocker is CORS on the module graph, plus Chrome's own rule about the file scheme.
- **OPFS on `file://`: Safari allows it, Chrome refuses it** with `SecurityError`. So even a
  single-file build could not rely on it.
- **`showDirectoryPicker` does not exist in Safari at all**, on any scheme (register entry #10).
  The "company as a real folder" promise is Chromium-only today.

The answer shipped is a PWA served from an origin: `index.html`, `manifest.webmanifest`,
`service-worker.js`, and the ES modules already in the repository. `serve.mjs` is the smallest
possible origin — loopback only, a file reader with no opinions — so self-hosting is one command
and neodonkey.eu is a convenience, never an authority (Principle 9).

**Origin-independence is absolute, and enforced.** Not one leading slash anywhere in the app:
every href, every icon, the manifest's `start_url`/`scope`/`id`, the service-worker registration —
all relative. The same bytes run from `https://neodonkey.eu/`, from
`https://erp.somecompany.de/neodonkey/` and from `http://localhost:8080/`. A company self-hosts by
copying the folder. `test/g-ui.test.js` fails the build on a leading slash or any `https?://`
reference in `index.html`, so this cannot rot.

## 2. Capability detection tries; it never feature-sniffs

On Chrome `file://`, `typeof navigator.storage.getDirectory === 'function'` is **true**, and
calling it still throws `SecurityError`. Any check that trusts `typeof` reports a working private
file system on a page that has none. `runtime/ui/storage.js` therefore performs a real
write/read/delete round-trip before claiming OPFS works, and `capabilities()` reports what the
browser can actually do — established by trying, not by sniffing.

This is also why the onboarding flow offers a choice of where the folder lives
(`runtime/ui/boot.js`): a browser cannot pick a folder without being asked, and the fallback
(OPFS) is invisible but always there where the picker exists.

## 3. Two deliberate form decisions

Both taken so the operating model stays the teacher (`runtime/ui/forms.js`,
`runtime/ui/viewmodel.js`):

1. **The form does not set the HTML `required` attribute.** A missing required field is submitted,
   refused by the operating model, and shown as the company's own sentence with its file and line.
   Letting the browser say "Please fill out this field" would replace the best explanation in the
   product with the worst one.
2. **Nothing is written on keystroke.** The Live Layer exists, but a form that commits per
   keystroke would put two hundred CRDT ops where one fact belongs. What lands in Git is every
   fact, not every change (Appendix III).

---

*Measured values were true for the engines named in register entry #8 on the date measured there.
When a new engine generation changes one of these answers, update the register first and this page
after.*

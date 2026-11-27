# You did print it, right?

Turn recovery codes into a printable backup page: QR code(s), a text copy, and instructions for getting it back. Optionally encrypted with a passphrase first. Works offline once loaded; nothing leaves the tab.

## Features

- QR encoding with selectable error correction (L / M / Q / H). Data too large for one code is split into numbered codes (`YDPR:i/n:` prefix).
- Optional encryption in the standard [age](https://age-encryption.org) format (scrypt passphrase, ChaCha20-Poly1305), ASCII-armored. Recovery works with `age -d` even without this app.
- A4, A5 and A6 layouts with a true-size preview and page-overflow warning.
- Several cards per print job, each with its own title, secret and note. Print each card on its own page, or tile them onto a bigger sheet with cut lines: 2 × A5 or 4 × A6 on A4, 2 × A6 on A5. Empty spots can be filled with copies.
- Self-check before printing: every QR is scanned back from its matrix, and ciphertext is decrypted back and compared to the input.
- Recover page: scan with the camera, read a photo, or paste text; joins multi-code sets and decrypts.
- Installable PWA, fully offline. Strict CSP, no network calls, no storage of secrets (the form is wiped on reload).

## Develop

```sh
bun install
bun run dev        # http://localhost:5173
bun run test
bun run build && bun run preview
bun scripts/icons.ts   # regenerate PNG icons from the icon geometry
```

## Supply chain

- `bunfig.toml` pins exact versions and only installs releases at least 7 days old (`minimumReleaseAge`). A security fix that is newer than that goes in `minimumReleaseAgeExcludes`, with its advisory ID in a comment.
- Dependabot (bun + GitHub Actions) uses the same 7-day cooldown and groups security updates.
- Workflow actions are pinned to commit SHAs. CI runs `bun audit --audit-level=high`.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions). `BASE_PATH` is set to `/<repo>/` by the workflow.

## Credits

Departure Mono by Helena Zhang, SIL Open Font License 1.1 (`public/fonts/DepartureMono-LICENSE.txt`).

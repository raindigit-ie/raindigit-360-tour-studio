# RainDigit 360 Tour Studio

Canonical source worktree: `/Users/mk/Documents/Personal/Code/raindigit-360-tour-studio`.

Source of truth:
- Product page: `/Users/mk/MEMO/Kimi Base/01-projects/raindigit-ie/360-tour-studio-product.md`
- Dev roadmap: `/Users/mk/MEMO/Kimi Base/01-projects/raindigit-ie/360-tour-studio-dev-roadmap.md`
- Code-only snapshot: `/Users/mk/MEMO/Kimi Base/01-projects/raindigit-ie/360-tour-studio-source`

Rules:
- Do not use Desktop as the canonical Studio source.
- Keep customer media, source panoramas, QA evidence, workspaces, releases and ZIPs out of Git.
- Store only code/docs/tests in Git and in the Kimi Base code-only snapshot.
- Concrete tour bundles waiting for the external storage live temporarily under `/Users/mk/Documents/Personal/Pending Storage Archive/RainDigit 3D Tours`.
- When the real storage volume is connected, archive concrete tour originals/results there, then remove the pending local bundle only after hash verification and explicit cleanup permission.

Default checks:
- `npm run check`
- `npm run test:product`

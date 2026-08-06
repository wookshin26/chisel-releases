# Chisel — Releases

[Chisel](https://chisel-site-mu.vercel.app) is an AI-native, LaTeX-based research tool for macOS: manuscripts, numerics, figures, literature, and referee review in one project, with an AI that always has your whole project as context.

This repository hosts **downloadable releases** and the **public issue tracker**. The application source lives in a private repository.

## Download

Grab the latest build from the [Releases page](https://github.com/wookshin26/chisel-releases/releases/latest), or use the download page: **https://chisel-site-mu.vercel.app**

## Alpha status

Current builds are an **early alpha for invited testers**:

- Builds are **not yet notarized** (Developer ID signing arrives with the public beta).
- On first launch, **right-click `Chisel.app` → Open**.
- If macOS reports the app as *damaged*, clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Chisel.app
```

## Requirements

- macOS (Apple Silicon; Intel builds to follow)
- [TeX Live](https://www.tug.org/texlive/) with `latexmk` — required for compilation
- Python 3.11+ — for the Numerics workspace
- Git — for snapshots and review diffs

Chisel does not bundle these tools.

## Bug reports

Please open an [issue](https://github.com/wookshin26/chisel-releases/issues). The in-app **Report bug** button also lands here.

# MJIC Embroidery Engine Research

Time-boxed research performed via GitHub repository search plus upstream README/LICENSE files.

## License rule used for this project

- **GPL/AGPL projects may not be copied** into this proprietary repository. They are useful only for learning high-level algorithms, UX, and format behavior.
- **Permissive projects (MIT / BSD / Apache / zlib)** may be ported carefully with attribution comments in the new TypeScript files.

## Findings

| Project | URL | License | Stars | Last push | What is reusable for MJIC |
| --- | --- | --- | ---: | --- | --- |
| pyembroidery | https://github.com/EmbroidePy/pyembroidery | MIT | 312 | 2024-05-24 | Best permissive reference for real-world embroidery file writers/readers. Safe source for small ports of DST/EXP/PEC/PES/JEF encoding behavior and excellent round-trip verification target. |
| Ink/Stitch | https://github.com/inkstitch/inkstitch | GPL-3.0 | 1,360 | 2026-10-02 | Strong reference for digitizing concepts: pull compensation, underlay, satin columns, tatami fills, routing, and review heuristics. **Do not copy code**; only learn algorithms/spec behavior. |
| libembroidery | https://github.com/Embroidermodder/libembroidery | zlib | 82 | 2026-07-11 | Permissive low-level multi-format library. Useful for format/header expectations, bounds handling, and broad machine-format support ideas. |
| Embroidermodder 2 | https://github.com/Embroidermodder/Embroidermodder | zlib | 632 | 2026-10-07 | Permissive desktop app using libembroidery. Useful for QA/report ideas (time/thread estimates), conversion workflows, and format interoperability expectations. |

## Source notes

### pyembroidery

- Search/API summary: MIT-licensed Python library for reading/writing many embroidery formats.
- README says it is a Python library for reading and writing embroidery files.
- License file is MIT, so format-writer behavior can be ported with attribution.
- Most valuable reusable pieces:
  - DST record bit packing
  - EXP command bytes
  - Minimal PES/PEC container behavior
  - JEF header/layout expectations
  - Cross-format round-trip testing with `pyembroidery`

### Ink/Stitch

- README describes it as a full open-source machine embroidery design platform built on Inkscape.
- License file is GPL-3.0, so this repo **must not copy any code**.
- Still valuable for concept learning:
  - satin vs fill decisions
  - underlay strategy
  - pull compensation and density heuristics
  - warnings for tiny text / dense designs / manual review triggers

### libembroidery

- README describes it as a low-level C library for reading, writing, and altering digital embroidery files, covering 45+ formats.
- README explicitly states the project is under the **permissive zlib licence**.
- Reusable ideas:
  - conservative format support strategy centered on industrial interchange formats
  - keeping format logic separate from digitizing logic
  - treating conversion and validation as separate concerns

### Embroidermodder 2

- README describes it as a GUI for editing machine embroidery files that can estimate thread and machine time and convert between formats.
- Repo metadata reports **zlib** licensing.
- Reusable ideas:
  - QA reporting fields such as machine time / thread estimates
  - user-facing preview/approval workflow expectations
  - broad-machine-brand mindset via common interchange formats

## Practical conclusion for MJIC

1. **Use pyembroidery as the permissive behavioral reference** for writing valid DST/EXP/PES/JEF buffers and for verification during development.
2. **Use Ink/Stitch only as a conceptual guide** for digitizing heuristics; keep all implementation original in TypeScript.
3. **Center compatibility on DST + PES + JEF + EXP first** because they cover industrial Tajima interchange plus major home/semi-pro brands (Brother/Babylock/Janome/Melco-style ecosystems).
4. **Always surface manual-review warnings** for small text, very dense artwork, too many tiny regions, or unusually high stitch density; fully automatic digitizing is not honest for every logo.

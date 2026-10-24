# Security policy

## Scope

This is a static browser demo plus generated artifacts. There is no server-side
code, no user accounts and no database. The realistic security surface is:

1. **Third-party execution.** MuJoCo WASM is loaded from `vendor/mujoco/` when
   present, otherwise from `cdn.jsdelivr.net` at a pinned version. A compromised
   dependency is the main risk. Vendoring is the recommended deployment.
2. **Untrusted model files.** This repository does not parse user-supplied MJCF
   or URDF. If you add an import path, treat MuJoCo, GLTF and XML parsers as
   attack surface and isolate them.
3. **Exported files.** JSONL, JSON, ZIP, URDF and MJCF exports contain whatever
   was in the scene. They are downloaded locally and never uploaded.
4. **Device APIs.** WebXR and camera/image capture require explicit permission
   from the browser; nothing is transmitted.

## Reporting

Please do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting on this repository, or contact the maintainer through
the private channel on their GitHub profile. Include the version or commit, the
browser, reproduction steps, and what an attacker gains.

Expect an acknowledgement within seven days. This is a volunteer project, so
fix timelines are best-effort; a clear reproduction speeds things up.

## Supported versions

| Version | Supported |
| :--- | :--- |
| `main` | yes |
| tagged releases | best-effort |
| anything older | no |

## Deployment notes

- Serve over HTTPS; WebXR and some device APIs require a secure context.
- Set a Content-Security-Policy that allows your own origin and, if you rely on
  the CDN fallback, `cdn.jsdelivr.net`. Vendoring removes that need.
- The included dev server sends `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Embedder-Policy: credentialless` for the optional
  multi-threaded MuJoCo build. Tighten or remove them for production.

# Flowdeck hand-in evidence — 2026-10-16

This sheet accompanies `FLOWDECK_HANDIN_BRIEF_2026-10-16.md`. All counts below were obtained during local testing on Tests-MacBook-Air; they do not establish a complete live B cycle.

| Check | Outcome | Evidence log on original Mac |
| --- | --- | --- |
| TypeScript build + full repository tests on original Mac | 304 tests: **301 pass, 0 fail, 3 skip**; exit 0; depends on private historical fixtures | `/tmp/flowdeck-handin-p1-final-20261016.log` |
| Source-package portable Flowdeck test selection | 165 tests: **164 pass, 0 fail, 1 skip** on original Mac; packaging recheck uses this command | `/tmp/flowdeck-handin-portable-original-20261016.log` |
| Real local Temporal worker + synthetic activities | Workflow completed, `approved_cycle_finished`, `implementation_done_review_pending`; six signals, clean worker shutdown, **zero real browser sends** | `/tmp/flowdeck-handin-smoke-20261016.log` |
| Real Helium Profile 4 browser, no Send | Ten consecutive owned Project tabs staged Probe RemoteMCP2 full draft, **10/10 matched**, **10/10 closed**, **0 submissions**, **0 failures** | `/tmp/flowdeck-repeat-nosend-20261016.log` |
| Cooperative cancellation/deadline guard | Four new regression tests passed; guards before staging and browser click; preserves uncertain click journal; **in-flight CDP cancellation not certified** | `docs/FLOWDECK_P1_SEND_GUARD_2026-10-16.md` |
| Production B successor recovery preview | `lineageEligible:false`, `predecessorTabPresent:false`, `predecessorEvidenceVerified:false`, `readyForExecution:false`, `writes:false` | `docs/FLOWDECK_FORWARD_SEAL_HANDOFF_2026-10-16.md` |
| Live state | Task A artifact present, Task B artifact absent; no sender; immutable state digest unchanged | `docs/FLOWDECK_B_ONLY_ATTENDED_DEMO_2026-10-16.md` |

**Relevant hashes**
- Immutable live supervisor store (recursive aggregate): `31aac9fd409fbfa6a5fba847812f535ef7ed76dde49c34b4b94f2a03d449d70f`.
- Browser TS SHA256: `ce9db1411433d76bc5faafff6bde7cef7297c26faee750ae54439b420a8118bb`.
- Browser compiled SHA256: `83ab93a6d679a6b99728e484f18b540d6c1fdf0d946a54a49504dbcb2a38b7e3`.
- Latest supervisor activities TS SHA256: `da6f5f3632751eeea8fbb46692e87a345fc4971194aa05b80c4c11ec3362b2b1`.
- Latest supervisor compiled SHA256: `2a24b348c700681b53007bd5c073bf85b726c30630de0fcb454f38ec919f6a72`.

**Limitations:** Full `npm test` was also run against an extracted snapshot without the private `.state` fixtures; **9 legacy fixture-dependent tests failed**. That is why the package now provides `npm run test:portable` for reviewers. Logs are local to the original Mac and not included in the source archive; this sheet preserves verified summaries. This engineering snapshot is not a clean HEAD-based checkout or public security audit. Task B was not completed in a real Project chat, and no additional B retry is authorized.

Aegishider 3.2.0 - delivery folder
=================================
Aegishider-3.2.0.jar   server plugin (shaded, relocated FastUtil)
sha256                f2ca7a488d358d5b5db32394b9ebb787af27dd4938dcb3019dee9431e35baf79
size                  6,797,780 bytes

Requirements: Paper 1.21.4, Java 21, PacketEvents plugin 2.14.0+ installed separately.
Source:       D:\Aegishider\aegishider-integrated
Docs:         D:\Aegishider\docs (audit, architecture, test plan, dependencies,
              final report, 3.2.0 follow-up improvements)
Evidence:     D:\Aegishider\docs\evidence (packet-test reports, benchmarks, load tests,
              jar inspection)
Integration : D:\Aegishider\itest (reproducible Paper 1.21.4 + headless-client harness)
Benchmarks  : D:\Aegishider\bench (run-bench.js, mspt-bench.js, load-bench.js + JSON evidence;
              load server dir/ports 25601/25600, separate from itest)

Verification:
  mvn -B clean verify                 -> BUILD SUCCESS, 75 tests, 0 failures
  itest (baseline v3 jar)             -> PASS in baseline mode (A/C LEAK detected)
  itest (this jar)                    -> PASS all scenarios (A hidden 0 packets, B visible,
                                         9 ms reveal, C chest absent from decoded chunk data)
  load tiers                          -> 10/200 ok, 50/1000 ok (TPS 19.1),
                                         200/2000 survived (TPS 16.2-17.3 on desktop),
                                         120 s soak 6/6 churn ok
  /aegishider export                   -> async diagnostics.json snapshot (non-security work)

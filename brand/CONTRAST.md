# Slate contrast audit

Calculated with WCAG relative luminance, opaque sRGB values. Rounded ratios are informational; acceptance uses unrounded values. No alpha, photo or disabled-state assumptions.

| Foreground | Background | Ratio | Normal text ≥4.5 | Non-text ≥3 |
|---|---|---:|---|---|
| text | background | 13.46:1 | Pass | Pass |
| text | surface | 10.82:1 | Pass | Pass |
| text | navigation | 15.43:1 | Pass | Pass |
| muted | background | 6.91:1 | Pass | Pass |
| muted | surface | 5.56:1 | Pass | Pass |
| muted | navigation | 7.93:1 | Pass | Pass |
| muted | text | 1.95:1 | Fail | Fail |
| background | surface | 1.24:1 | Fail | Fail |
| background | navigation | 1.15:1 | Fail | Fail |
| background | text | 13.46:1 | Pass | Pass |
| surface | background | 1.24:1 | Fail | Fail |
| surface | navigation | 1.43:1 | Fail | Fail |
| surface | text | 10.82:1 | Pass | Pass |

Surface/background and surface/navigation differences are insufficient as sole control boundaries. Use a contrasting border. Focus must also be visible beside porcelain controls: keep the Slate gap. This is a palette calculation, not an accessibility certification.

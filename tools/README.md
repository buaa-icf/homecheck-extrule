# Offline cloc

The performance test selects the bundled cloc files before any environment or system installation:

- Windows: `cloc-2.10.exe`
- macOS/Linux: `cloc-2.10.pl`, launched with `/usr/bin/perl` (or `perl` from `PATH`)

If the matching bundled file is absent, the script falls back to `CLOC_PATH`, then to `cloc`
from `PATH`.

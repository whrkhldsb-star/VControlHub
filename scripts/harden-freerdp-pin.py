#!/usr/bin/env python3
"""Run the FreeRDP pin hardener shipped in the guacd Docker build context."""
from pathlib import Path
from runpy import run_path


if __name__ == "__main__":
    script = Path(__file__).resolve().parents[1] / "docker/guacd-pin/harden-freerdp-pin.py"
    run_path(str(script), run_name="__main__")

import argparse
import os
import sys

# Ensure parent directory is in sys.path when invoked directly as a script,
# so `scale_agent` is always importable.
if not getattr(sys, "frozen", False):
    _pkg_dir = os.path.dirname(os.path.abspath(__file__))
    _parent_dir = os.path.dirname(_pkg_dir)
    if _parent_dir not in sys.path:
        sys.path.insert(0, _parent_dir)

from scale_agent import __version__
from scale_agent.config import load_config
from scale_agent.logger import setup_logging
from scale_agent.agent_manager import run_agent


def main():
    try:
        return _run()
    except SystemExit:
        raise
    except Exception:
        # A frozen windowed EXE has nowhere to show a traceback except a file.
        # Log startup failures so they never disappear silently.
        _capture_startup_error()
        raise


def _capture_startup_error():
    import traceback

    if not getattr(sys, "frozen", False):
        return
    log_dir = os.path.join(
        os.environ.get("APPDATA", os.path.dirname(sys.executable)),
        "Scale Agent",
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        with open(
            os.path.join(log_dir, "startup_error.log"), "a", encoding="utf-8"
        ) as f:
            traceback.print_exc(file=f)
    except Exception:
        pass


def _run():
    parser = argparse.ArgumentParser(description="Scale Agent - physical scale hardware gateway")
    parser.add_argument(
        "-c", "--config",
        default=None,
        help="Path to config.json (default: ./config.json next to the agent)",
    )
    parser.add_argument(
        "--version", action="store_true", help="Print version and exit",
    )
    args = parser.parse_args()

    if args.version:
        print(f"Scale Agent v{__version__}")
        return 0

    config = load_config(args.config)
    setup_logging(
        log_level=config.log_level,
        log_max_bytes=config.log_max_bytes,
        log_backup_count=config.log_backup_count,
    )

    agent = run_agent(config_path=args.config)
    return 0


if __name__ == "__main__":
    sys.exit(main())
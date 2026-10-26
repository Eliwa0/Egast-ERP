import logging
import logging.handlers
import os
import sys


def setup_logging(
    log_level: str = "INFO",
    log_file: str = "scale_agent.log",
    log_max_bytes: int = 5 * 1024 * 1024,
    log_backup_count: int = 3,
    log_dir: str = None,
) -> logging.Logger:
    """Configure rotating file + console logging for the Scale Agent."""
    if log_dir is None:
        if getattr(sys, "frozen", False):
            # PyInstaller onefile: `__file__` points into the temp dir. Write
            # logs to a per-user AppData location instead - Program Files is
            # read-only for non-admin users and the temp dir is wiped on exit.
            log_dir = os.path.join(
                os.environ.get("APPDATA", os.path.dirname(sys.executable)),
                "Scale Agent",
            )
        else:
            log_dir = os.path.dirname(os.path.abspath(__file__))

    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, log_file)

    level = getattr(logging, log_level.upper(), logging.INFO)

    logger = logging.getLogger("scale_agent")
    logger.setLevel(level)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s.%(funcName)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=log_max_bytes, backupCount=log_backup_count, encoding="utf-8"
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    # Only attach a console handler when there IS a console. A frozen
    # windowed EXE (PyInstaller --windowed) has sys.stdout = None.
    if sys.stdout is not None:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(fmt)
        logger.addHandler(console_handler)

    logger.info("Logging initialized (level=%s, file=%s)", log_level, log_path)
    return logger

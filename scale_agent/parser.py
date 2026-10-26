import re
from decimal import Decimal, InvalidOperation
from typing import Optional, Callable, List

WEIGHT_REGEX = re.compile(r"[-+]?\d*\.?\d+")
SUPPORTED_SCALE_LINE_REGEX = re.compile(
    r"^\s*(?:"
    r"[-+]?\s*\d+(?:\.\d+)?\s*(?:kg|g|lb)?"
    r"|ST\s*,\s*(?:GS|NT)\s*,\s*[-+]?\s*\d+(?:\.\d+)?\s*(?:kg|g|lb)?"
    r"|WN\s*:\s*[-+]?\s*\d+(?:\.\d+)?\s*(?:kg|g|lb)?"
    r")\s*$",
    re.IGNORECASE,
)


def parse_weight(raw_line: str) -> Optional[float]:
    """Extract a numeric weight from raw serial ASCII data.

    Handles common scale formats:
      '1250.40'
      '1250.40 kg'
      'ST,GS,+012540.00kg'
      '+001250.40'
      'WN: 5420.0 kg'

    Returns float or None if no valid number found.
    """
    if not raw_line or not isinstance(raw_line, str):
        return None
    cleaned = raw_line.strip()
    if not cleaned:
        return None
    if not is_valid_scale_line(cleaned):
        return None

    match = WEIGHT_REGEX.search(cleaned)
    if not match:
        return None

    try:
        val = Decimal(match.group(0))
        if val.is_finite():
            if val.is_zero() and val.is_signed():
                return None
            return float(val)
    except (InvalidOperation, ValueError, TypeError):
        pass
    return None


def is_valid_scale_line(raw_line: str) -> bool:
    """Quick check if a serial line likely contains weight data."""
    if not raw_line or not isinstance(raw_line, str):
        return False
    stripped = raw_line.strip()
    if not stripped:
        return False
    return SUPPORTED_SCALE_LINE_REGEX.match(stripped) is not None


class SerialParser:
    """Pluggable parser for serial weight data.

    Supports multiple format strategies. Additional parsers can be registered.
    """

    def __init__(self):
        self._parsers: List[Callable[[str], Optional[float]]] = [parse_weight]

    def add_parser(self, parser_fn: Callable[[str], Optional[float]]):
        """Register an additional parser function."""
        self._parsers.append(parser_fn)

    def parse(self, raw_line: str) -> Optional[float]:
        """Try each registered parser in order, return first successful parse.

        Negative values are rejected: a scale does not produce meaningful
        negative gross readings to forward to the ERP.
        """
        for parser_fn in self._parsers:
            try:
                result = parser_fn(raw_line)
                if result is not None and result >= 0:
                    return result
            except Exception:
                continue
        return None

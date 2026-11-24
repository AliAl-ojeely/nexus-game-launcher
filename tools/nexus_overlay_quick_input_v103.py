"""Pure XInput Start-release disambiguation, shared by the live input bridge."""
START = 0x0010
BACK = 0x0020


def start_release_edge(previous, current, pending, cancelled, enabled):
    """Return (toggle, pending, cancelled) without Start+Back double-toggle.

    Start-only is emitted on RELEASE, never on key-down, so pressing Start and
    then Back has time to resolve as the pre-existing combo instead.
    """
    if not enabled:
        return False, False, False
    was_start, is_start = bool(previous & START), bool(current & START)
    if is_start and not was_start:
        pending, cancelled = not bool(current & BACK), bool(current & BACK)
    if is_start and (current & BACK):
        cancelled = True
    tapped = was_start and not is_start and pending and not cancelled and not (current & BACK)
    if not is_start:
        pending, cancelled = False, False
    return bool(tapped), pending, cancelled

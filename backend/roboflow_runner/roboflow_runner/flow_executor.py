"""Traverse RoboFlow JSON (same rules as js/flow-executor.js)."""

from __future__ import annotations

from typing import Callable, Dict, List, Optional

MAX_STEPS = 5000


class FlowExecutionError(Exception):
    pass


def get_next(connections: List[dict], block_id: str, port: int) -> Optional[str]:
    for c in connections:
        if c.get('sourceId') == block_id and int(c.get('sourcePort', 0)) == port:
            return c.get('targetId')
    return None


def find_start_block(blocks: List[dict]) -> Optional[dict]:
    for b in blocks:
        if b.get('type') == 'start':
            return b
    return None


def index_blocks(blocks: List[dict]) -> Dict[str, dict]:
    return {b['id']: b for b in blocks if b.get('id')}


def run_flow(
    flow: dict,
    execute_block: Callable[[str, dict], None],
    *,
    should_stop: Callable[[], bool],
    log: Callable[[str], None],
) -> None:
    blocks_list = flow.get('blocks') or []
    connections = flow.get('connections') or []
    blocks = index_blocks(blocks_list)
    start = find_start_block(blocks_list)
    if not start:
        raise FlowExecutionError('Flow has no START block')

    loop_counters: Dict[str, Dict[str, int]] = {}
    current_id: Optional[str] = start['id']
    steps = 0

    while current_id and not should_stop() and steps < MAX_STEPS:
        steps += 1
        block = blocks.get(current_id)
        if not block:
            break

        btype = block.get('type') or ''
        params = block.get('params') or {}

        if btype == 'end':
            execute_block(btype, params)
            break

        if btype == 'loop_start':
            if current_id not in loop_counters:
                raw = params.get('iterations', 3)
                try:
                    iters = int(raw)
                except (TypeError, ValueError):
                    iters = 3
                loop_counters[current_id] = {'current': 0, 'max': max(1, iters)}
            ctr = loop_counters[current_id]
            ctr['current'] += 1
            log(f'Loop {ctr["current"]}/{ctr["max"]}')
            if ctr['current'] <= ctr['max']:
                current_id = get_next(connections, current_id, 0)
            else:
                del loop_counters[current_id]
                current_id = get_next(connections, current_id, 1)
            continue

        if btype == 'loop_end':
            current_id = get_next(connections, current_id, 0)
            continue

        execute_block(btype, params)
        if should_stop():
            break
        current_id = get_next(connections, current_id, 0)

    if steps >= MAX_STEPS:
        raise FlowExecutionError('Max steps exceeded — possible infinite loop')

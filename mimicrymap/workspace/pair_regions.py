"""Compact independent residue unions; coordinates are one-based and inclusive."""
FORMAT = 'merged-residue-ranges/1'


def merge(ranges):
    result = []
    for start, end in sorted(ranges):
        if start < 1 or end < start:
            raise ValueError('Invalid residue range')
        if result and start <= result[-1][1] + 1:
            result[-1][1] = max(end, result[-1][1])
        else:
            result.append([start, end])
    return result


def pack(target, parent):
    output = bytearray()
    def put(n):
        if not isinstance(n, int) or not 0 <= n <= 0xffffffff:
            raise ValueError('Invalid range integer')
        while n >= 128:
            output.append((n & 127) | 128); n >>= 7
        output.append(n)
    for ranges in (target, parent):
        put(len(ranges)); end = 0
        for a, b in ranges:
            if a <= end or b < a:
                raise ValueError('Invalid merged range')
            put(a - end); put(b - a); end = b
    return bytes(output)


def unpack(payload, reverse=False):
    pos = 0
    def get():
        nonlocal pos
        n = shift = 0
        while True:
            if pos >= len(payload) or shift > 28:
                raise ValueError('Invalid range payload')
            b = payload[pos]; pos += 1; n |= (b & 127) << shift
            if n > 0xffffffff:
                raise ValueError('Invalid range integer')
            if not b & 128:
                return n
            shift += 7
    lists = []
    for _ in range(2):
        size = get(); ranges = []; end = 0
        if size > len(payload):
            raise ValueError('Invalid range count')
        for _ in range(size):
            a = end + get(); b = a + get()
            if a <= end:
                raise ValueError('Invalid range order')
            ranges.append([a, b]); end = b
        lists.append(ranges)
    if pos != len(payload):
        raise ValueError('Trailing range data')
    return lists[::-1] if reverse else lists


def text(ranges):
    return ','.join(f'{a}..{b}' for a, b in ranges)


def parse(value, length=None):
    ranges = [list(map(int, item.split('..'))) for item in value.split(',')] if value else []
    if any(len(r) != 2 for r in ranges) or merge(ranges) != ranges:
        raise ValueError('Ranges must be merged and in sequence order')
    if length is not None and any(b > length for _, b in ranges):
        raise ValueError('Range outside sequence')
    return ranges

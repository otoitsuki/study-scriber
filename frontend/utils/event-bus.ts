type Handler = (payload?: unknown) => void
const bus = new Map<string, Set<Handler>>()

export function on(event: string, fn: Handler) {
    (bus.get(event) ?? bus.set(event, new Set()).get(event))!.add(fn)
}
export function off(event: string, fn: Handler) {
    bus.get(event)?.delete(fn)
}
export function emit(event: string, payload?: unknown) {
    bus.get(event)?.forEach(fn => fn(payload))
}

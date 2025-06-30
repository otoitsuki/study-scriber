/* ============================================================
 * 輕量型別安全 EventEmitter（無 Node polyfill）
 * ============================================================
 */
export type Listener<T> = (payload: T) => void

export class TypedEmitter<Events extends Record<string, any>> {
  private listeners: {
    [K in keyof Events]?: Set<Listener<Events[K]>>
  } = {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    (this.listeners[event] ??= new Set()).add(listener)
    return this
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    this.listeners[event]?.delete(listener)
    return this
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    this.listeners[event]?.forEach((l) => l(payload))
    return !!this.listeners[event]?.size
  }

  removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event) this.listeners[event]?.clear()
    else Object.values(this.listeners).forEach((s) => s?.clear())
    return this
  }
}
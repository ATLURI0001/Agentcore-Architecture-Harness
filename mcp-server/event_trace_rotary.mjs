// event_trace_rotary.mjs – bounded ring buffer for event traces
export class EventTraceRotary {
  #buf = [];
  #max;

  constructor(max = 10) {
    this.#max = max;
  }

  push(ev) {
    if (this.#buf.length >= this.#max) this.#buf.shift();
    this.#buf.push(ev);
  }

  count() { return this.#buf.length; }
}

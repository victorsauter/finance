// Collects observed facts and failed expectations for one scenario.
export class Scenario {
  readonly facts: string[] = []
  readonly failures: string[] = []
  readonly data: Record<string, unknown> = {}
  error?: string

  constructor(
    readonly id: string,
    readonly title: string,
  ) {}

  fact(text: string): void {
    this.facts.push(text)
  }

  /** Records a failed expectation (the scenario fails) or a passed one (a fact). */
  expect(condition: unknown, text: string): boolean {
    if (condition) this.facts.push(`ok: ${text}`)
    else this.failures.push(text)
    return Boolean(condition)
  }

  get pass(): boolean {
    return this.failures.length === 0 && !this.error
  }
}

export function ms(value: number): string {
  return `${Math.round(value)} ms`
}

export function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KiB`
}
